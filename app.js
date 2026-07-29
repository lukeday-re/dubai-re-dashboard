(function () {
  var CATEGORY_META = {
    developer_launch: { label: "Developer Launch", color: "#2563eb" },
    infrastructure:   { label: "Infrastructure",    color: "#059669" },
    market_data:      { label: "Market Data",       color: "#d97706" },
    abu_dhabi:        { label: "Abu Dhabi",         color: "#7c3aed" },
    market_drivers:   { label: "Market Drivers",    color: "#db2777" }
  };

  var state = {
    dates: (typeof window.RE_DATES !== "undefined") ? window.RE_DATES.slice() : [],
    loadedCount: 0,
    activeFilter: "all",
    searchTerm: "",
    allLoadedItems: [] // {item, date}
  };

  var PAGE_SIZE = 3; // days per "load more"

  function fmtDayLabel(dateStr) {
    var today = new Date();
    var todayStr = today.toISOString().slice(0, 10);
    var y = new Date(today);
    y.setDate(y.getDate() - 1);
    var yStr = y.toISOString().slice(0, 10);
    if (dateStr === todayStr) return "Today";
    if (dateStr === yStr) return "Yesterday";
    var d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      // Cache-bust every load so the phone/home-screen app always gets the
      // latest daily data instead of a stale cached copy.
      s.src = src + (src.indexOf("?") > -1 ? "&" : "?") + "t=" + Date.now();
      s.onload = resolve;
      s.onerror = function () { reject(new Error("missing " + src)); };
      document.head.appendChild(s);
    });
  }

  // Load the date manifest (data/index.js) fresh, then populate state.dates.
  function loadManifest() {
    return loadScript("data/index.js").then(function () {
      state.dates = (typeof window.RE_DATES !== "undefined") ? window.RE_DATES.slice() : [];
    }).catch(function (e) {
      console.warn(e.message);
    });
  }

  function getDayData(dateStr) {
    if (typeof window.RE_DATA !== "undefined" && window.RE_DATA[dateStr]) {
      return window.RE_DATA[dateStr];
    }
    return null;
  }

  function loadNextBatch() {
    var slice = state.dates.slice(state.loadedCount, state.loadedCount + PAGE_SIZE);
    if (slice.length === 0) return Promise.resolve(false);
    var promises = slice.map(function (dateStr) {
      var existing = getDayData(dateStr);
      if (existing) return Promise.resolve();
      return loadScript("data/" + dateStr + ".js").catch(function (e) {
        console.warn(e.message);
      });
    });
    return Promise.all(promises).then(function () {
      slice.forEach(function (dateStr) {
        var day = getDayData(dateStr);
        if (day && day.items) {
          day.items.forEach(function (item) {
            state.allLoadedItems.push({ item: item, date: dateStr, topPicks: day.top_picks || [] });
          });
        }
      });
      state.loadedCount += slice.length;
      return true;
    });
  }

  // Parse the loosely-formatted published_date into a Date.
  // "YYYY-MM-DD" -> that day; "YYYY-MM" -> last day of that month;
  // "YYYY" -> Dec 31 of that year; anything unrecognised -> null (kept, not hidden).
  function parseItemDate(s) {
    s = String(s || "").trim();
    var m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{4})-(\d{2})$/))) return new Date(+m[1], +m[2], 0);
    if ((m = s.match(/^(\d{4})$/))) return new Date(+m[1], 11, 31);
    return null;
  }

  // Hide anything older than 3 months so the feed stays fresh for content.
  function isFresh(item) {
    var d = parseItemDate(item.published_date);
    if (!d) return true; // unparseable date -> don't hide it
    var cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setMonth(cutoff.getMonth() - 3);
    return d >= cutoff;
  }

  function itemMatchesFilter(item) {
    if (!isFresh(item)) return false;
    if (state.activeFilter !== "all" && item.category !== state.activeFilter) return false;
    if (state.searchTerm) {
      var hay = (item.headline + " " + item.summary + " " + (item.developer_tags || []).join(" ") + " " + (item.location_tags || []).join(" ")).toLowerCase();
      if (hay.indexOf(state.searchTerm.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function renderTopPicks() {
    var container = document.getElementById("top-picks");
    if (state.allLoadedItems.length === 0) { container.style.display = "none"; return; }
    var mostRecentDate = state.allLoadedItems[0].date;
    var todaysGroup = state.allLoadedItems.filter(function (x) { return x.date === mostRecentDate; });
    var pickIds = todaysGroup.length ? todaysGroup[0].topPicks : [];
    var picks = todaysGroup.filter(function (x) { return pickIds.indexOf(x.item.id) !== -1; });
    if (picks.length === 0) { container.style.display = "none"; return; }
    container.style.display = "block";
    container.innerHTML = "<h2>Today's Top Video Picks</h2>" + picks.map(function (x) {
      var it = x.item;
      var hasScript = !!(it.script || (it.bullets && it.bullets.length));
      return '<div class="pick-card' + (hasScript ? ' clickable' : '') + '"' + (hasScript ? ' data-item-id="' + escapeHtml(it.id) + '"' : '') + '>' +
        '<div class="pick-headline">' + escapeHtml(it.headline) + "</div>" +
        (it.hook_angle ? '<div class="hook">🎬 ' + escapeHtml(it.hook_angle) + "</div>" : "") +
        (hasScript ? '<div class="tap-cue">👉 Tap for bullet points &amp; 60-sec script</div>' : "") +
        "</div>";
    }).join("");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function findItemById(id) {
    for (var i = 0; i < state.allLoadedItems.length; i++) {
      if (state.allLoadedItems[i].item.id === id) return state.allLoadedItems[i].item;
    }
    return null;
  }

  // Copy plain text to the clipboard, with a fallback for older browsers, and
  // give quick "Copied!" feedback on the button that was pressed.
  function copyText(text, btn) {
    function done() {
      if (!btn) return;
      var original = btn.getAttribute("data-label") || btn.textContent;
      btn.setAttribute("data-label", original);
      btn.textContent = "✓ Copied!";
      btn.classList.add("copied");
      setTimeout(function () { btn.textContent = original; btn.classList.remove("copied"); }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
  }

  function bulletsToText(bullets) {
    return (bullets || []).map(function (b) { return "• " + b; }).join("\n");
  }

  function openDetail(item) {
    var content = document.getElementById("detail-content");
    var meta = CATEGORY_META[item.category] || { label: item.category, color: "#555" };
    var html = "";
    html += '<span class="badge" style="background:' + meta.color + '">' + meta.label + "</span>";
    html += '<h2 class="detail-headline">' + escapeHtml(item.headline) + "</h2>";
    html += '<div class="detail-meta">' + escapeHtml(item.source_name || "") + (item.published_date ? " · " + escapeHtml(item.published_date) : "") + "</div>";

    if (item.bullets && item.bullets.length) {
      html += '<section class="detail-section">' +
        '<div class="detail-section-head"><h3>📌 Key points</h3>' +
        '<button class="copy-btn" data-copy="bullets">Copy</button></div>' +
        '<ul class="detail-bullets">' +
        item.bullets.map(function (b) { return "<li>" + escapeHtml(b) + "</li>"; }).join("") +
        "</ul></section>";
    }

    if (item.script) {
      html += '<section class="detail-section">' +
        '<div class="detail-section-head"><h3>🎬 60-second script</h3>' +
        '<button class="copy-btn" data-copy="script">Copy</button></div>' +
        '<p class="detail-script">' + escapeHtml(item.script) + "</p></section>";
    }

    if (item.source_url) {
      html += '<a class="detail-article-link" href="' + escapeHtml(item.source_url) + '" target="_blank" rel="noopener">🔗 Read the full article →</a>';
    }

    content.innerHTML = html;

    // Wire the copy buttons to the actual (unescaped) text.
    var bulletBtn = content.querySelector('[data-copy="bullets"]');
    if (bulletBtn) bulletBtn.addEventListener("click", function () { copyText(bulletsToText(item.bullets), bulletBtn); });
    var scriptBtn = content.querySelector('[data-copy="script"]');
    if (scriptBtn) scriptBtn.addEventListener("click", function () { copyText(item.script, scriptBtn); });

    var overlay = document.getElementById("detail-overlay");
    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";
    content.scrollTop = 0;
  }

  function closeDetail() {
    document.getElementById("detail-overlay").style.display = "none";
    document.body.style.overflow = "";
  }

  function renderFeed() {
    var feed = document.getElementById("feed");
    var grouped = {};
    var order = [];
    state.allLoadedItems.forEach(function (x) {
      if (!itemMatchesFilter(x.item)) return;
      if (!grouped[x.date]) { grouped[x.date] = []; order.push(x.date); }
      grouped[x.date].push(x.item);
    });

    // Within each day, order articles most-recent to oldest by published_date.
    // Dates are ISO-ish strings, so descending string compare = newest first;
    // less-specific dates (e.g. "2026-07" or "2026") naturally fall below exact days.
    order.forEach(function (dateStr) {
      grouped[dateStr].sort(function (a, b) {
        return (b.published_date || "").localeCompare(a.published_date || "");
      });
    });

    if (order.length === 0) {
      feed.innerHTML = '<div class="empty">No stories match this filter yet.</div>';
      return;
    }

    var html = "";
    order.forEach(function (dateStr) {
      html += '<div class="day-divider">' + fmtDayLabel(dateStr) + "</div>";
      grouped[dateStr].forEach(function (item) {
        var meta = CATEGORY_META[item.category] || { label: item.category, color: "#555" };
        var hasScript = !!(item.script || (item.bullets && item.bullets.length));
        html += '<div class="card' + (hasScript ? ' clickable' : '') + '"' + (hasScript ? ' data-item-id="' + escapeHtml(item.id) + '"' : '') + '>' +
          '<span class="badge" style="background:' + meta.color + '">' + meta.label + "</span>" +
          '<div class="headline">' + escapeHtml(item.headline) + "</div>" +
          '<div class="summary">' + escapeHtml(item.summary) + "</div>" +
          (item.hook_angle ? '<div class="hook">🎬 ' + escapeHtml(item.hook_angle) + "</div>" : "") +
          (hasScript ? '<div class="tap-cue">👉 Tap for bullet points &amp; 60-sec script</div>' : "") +
          '<div class="meta">' +
          (item.source_url ? '<a href="' + escapeHtml(item.source_url) + '" target="_blank" rel="noopener">' + escapeHtml(item.source_name || "Source") + "</a>" : '<span>' + escapeHtml(item.source_name || "") + "</span>") +
          '<span>' + escapeHtml(item.published_date || "") + "</span>" +
          (item.developer_tags || []).map(function (t) { return '<span class="tag">' + escapeHtml(t) + "</span>"; }).join("") +
          "</div></div>";
      });
    });

    var moreAvailable = state.loadedCount < state.dates.length;
    feed.innerHTML = html;
    if (moreAvailable) {
      var btn = document.createElement("button");
      btn.className = "load-more";
      btn.textContent = "Load older days";
      btn.onclick = function () {
        btn.textContent = "Loading...";
        loadNextBatch().then(function () { renderTopPicks(); renderFeed(); });
      };
      feed.appendChild(btn);
    }
  }

  function setUpdatedLabel() {
    var el = document.getElementById("updated");
    if (state.dates.length === 0) { el.textContent = "No data yet"; return; }
    el.textContent = "Latest pull: " + fmtDayLabel(state.dates[0]) + " (" + state.dates[0] + ")";
  }

  function wireControls() {
    document.querySelectorAll(".pill").forEach(function (pill) {
      pill.addEventListener("click", function () {
        document.querySelectorAll(".pill").forEach(function (p) { p.classList.remove("active"); });
        pill.classList.add("active");
        state.activeFilter = pill.getAttribute("data-cat");
        renderFeed();
      });
    });
    document.getElementById("search").addEventListener("input", function (e) {
      state.searchTerm = e.target.value;
      renderFeed();
    });
    var refreshBtn = document.getElementById("refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () { refreshData(refreshBtn); });
    }

    // Delegated clicks: open the detail view for any card carrying a data-item-id
    // (top picks and any feed item that has a script). Ignore clicks on links.
    function cardClickHandler(e) {
      if (e.target.closest("a")) return;
      var card = e.target.closest("[data-item-id]");
      if (!card) return;
      var item = findItemById(card.getAttribute("data-item-id"));
      if (item) openDetail(item);
    }
    document.getElementById("top-picks").addEventListener("click", cardClickHandler);
    document.getElementById("feed").addEventListener("click", cardClickHandler);

    // Close the detail view: X button, backdrop click, or Escape.
    document.getElementById("detail-close").addEventListener("click", closeDetail);
    document.getElementById("detail-overlay").addEventListener("click", function (e) {
      if (e.target.id === "detail-overlay") closeDetail();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDetail();
    });
  }

  // Re-fetch the manifest and data from scratch (cache-busted) without a full
  // page reload — used by the Refresh button, since standalone/home-screen mode
  // hides the browser's own reload control.
  function refreshData(btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Refreshing…"; }
    window.RE_DATA = {};
    state.loadedCount = 0;
    state.allLoadedItems = [];
    return loadDataAndRender().then(function () {
      if (btn) { btn.disabled = false; btn.textContent = "🔄 Refresh"; }
    });
  }

  function loadDataAndRender() {
    return loadManifest().then(function () {
      if (state.dates.length === 0) {
        document.getElementById("feed").innerHTML = '<div class="empty">No data files found yet. Run a collection pass to populate data/.</div>';
        document.getElementById("updated").textContent = "No data yet";
        return;
      }
      setUpdatedLabel();
      return loadNextBatch().then(function () {
        renderTopPicks();
        renderFeed();
      });
    });
  }

  function init() {
    wireControls();
    loadDataAndRender();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
