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
    view: "feed", // "feed" | "created" | "want"
    allLoadedItems: [] // {item, date}
  };

  var PAGE_SIZE = 3; // days per "load more"

  // ---- Persistent per-item status (localStorage) --------------------------
  // Stores which stories the user has made a video on ("created") or wants to
  // ("want"), plus a full snapshot of the item so its bullets + script survive
  // forever on this device — even after the story ages out of the fresh feed.
  var STORE_KEY = "re_status_v1";
  var store = loadStore();

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }
  function statusOf(id) {
    var e = store[id];
    return { created: !!(e && e.created), want: !!(e && e.want) };
  }
  function snapshotItem(it) {
    return {
      id: it.id, category: it.category, headline: it.headline, summary: it.summary,
      hook_angle: it.hook_angle, bullets: it.bullets, script: it.script,
      source_name: it.source_name, source_url: it.source_url, published_date: it.published_date,
      developer_tags: it.developer_tags || [], location_tags: it.location_tags || []
    };
  }
  function setStatus(id, key, value, item) {
    var e = store[id] || {};
    e[key] = value;
    e.ts = Date.now();
    if (item) e.item = snapshotItem(item); // keep the snapshot fresh whenever flagged
    if (!e.created && !e.want) { delete store[id]; } else { store[id] = e; }
    saveStore();
  }
  function listItems(key) {
    var arr = [];
    for (var id in store) { if (store[id][key] && store[id].item) arr.push(store[id]); }
    arr.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return arr.map(function (e) { return e.item; });
  }

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

  // Load every remaining day file (used by the All Scripts library so it can
  // show scripts from days that have scrolled past the 3-month feed window).
  function loadAllDays() {
    if (state.loadedCount >= state.dates.length) return Promise.resolve();
    return loadNextBatch().then(loadAllDays);
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
    if (state.view !== "feed") { container.style.display = "none"; return; }
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
    // Check the persisted snapshot first: once a story is flagged created/want,
    // its bullets + script are frozen in localStorage forever, independent of
    // whether that day's data file happens to be loaded right now or the story
    // has aged past the 3-month freshness cutoff. Without this, tapping a card
    // in the Created/To-create lists could silently do nothing once the source
    // day scrolled out of the loaded feed.
    var saved = store[id];
    if (saved && saved.item) return saved.item;
    for (var i = 0; i < state.allLoadedItems.length; i++) {
      if (state.allLoadedItems[i].item.id === id) return state.allLoadedItems[i].item;
    }
    return null;
  }

  // Expose the lookup so the Script Studio (studio.js) can resolve a story by id.
  window.MWfindItem = findItemById;

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

    var st = statusOf(item.id);
    html += '<div class="detail-status">' +
      '<label class="status-check' + (st.created ? " on" : "") + '"><input type="checkbox" id="chk-created"' + (st.created ? " checked" : "") + "> ✅ I&#39;ve made a video on this</label>" +
      '<label class="status-check' + (st.want ? " on" : "") + '"><input type="checkbox" id="chk-want"' + (st.want ? " checked" : "") + "> ⭐ I want to make a video on this</label>" +
      "</div>";

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

    // Wire the status tick-boxes. Ticking either one permanently saves this
    // story (with its bullets + script) to that list on this device.
    var chkC = content.querySelector("#chk-created");
    var chkW = content.querySelector("#chk-want");
    if (chkC) chkC.addEventListener("change", function () {
      setStatus(item.id, "created", chkC.checked, item);
      chkC.parentNode.classList.toggle("on", chkC.checked);
      updateViewButtons();
      renderFeed();
    });
    if (chkW) chkW.addEventListener("change", function () {
      setStatus(item.id, "want", chkW.checked, item);
      chkW.parentNode.classList.toggle("on", chkW.checked);
      updateViewButtons();
      renderFeed();
    });

    var overlay = document.getElementById("detail-overlay");
    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";
    content.scrollTop = 0;
  }

  function closeDetail() {
    document.getElementById("detail-overlay").style.display = "none";
    document.body.style.overflow = "";
  }

  function cardHtml(item) {
    var meta = CATEGORY_META[item.category] || { label: item.category, color: "#555" };
    var hasScript = !!(item.script || (item.bullets && item.bullets.length));
    var st = statusOf(item.id);
    var cls = "card" + (hasScript ? " clickable" : "") + (st.created ? " is-created" : "") + (st.want ? " is-want" : "");
    var flag = st.created ? '<span class="status-flag flag-created">✓ Created</span>'
             : (st.want ? '<span class="status-flag flag-want">⭐ To create</span>' : "");
    return '<div class="' + cls + '"' + (hasScript ? ' data-item-id="' + escapeHtml(item.id) + '"' : "") + ">" +
      flag +
      '<span class="badge" style="background:' + meta.color + '">' + meta.label + "</span>" +
      '<div class="headline">' + escapeHtml(item.headline) + "</div>" +
      '<div class="summary">' + escapeHtml(item.summary) + "</div>" +
      (item.hook_angle ? '<div class="hook">🎬 ' + escapeHtml(item.hook_angle) + "</div>" : "") +
      (hasScript ? '<div class="tap-cue">👉 Tap for bullet points &amp; 60-sec script</div>' : "") +
      '<button class="gen-script-btn" type="button" data-gen-id="' + escapeHtml(item.id) + '">🎬 Generate shot list</button>' +
      '<div class="meta">' +
      (item.source_url ? '<a href="' + escapeHtml(item.source_url) + '" target="_blank" rel="noopener">' + escapeHtml(item.source_name || "Source") + "</a>" : '<span>' + escapeHtml(item.source_name || "") + "</span>") +
      '<span>' + escapeHtml(item.published_date || "") + "</span>" +
      (item.developer_tags || []).map(function (t) { return '<span class="tag">' + escapeHtml(t) + "</span>"; }).join("") +
      "</div></div>";
  }

  function renderFeed() {
    var feed = document.getElementById("feed");

    // All Scripts library: every item that has a script, across all days,
    // straight from the repo — ignores the 3-month filter and does not depend
    // on local storage, so no script we've made is ever lost from view.
    if (state.view === "scripts") {
      var seen = {};
      var scripted = [];
      state.allLoadedItems.forEach(function (x) {
        if (x.item.script && !seen[x.item.id]) { seen[x.item.id] = 1; scripted.push(x); }
      });
      scripted.sort(function (a, b) { return b.date.localeCompare(a.date); });
      if (scripted.length === 0) {
        feed.innerHTML = '<div class="list-head">📚 All scripts</div><div class="empty">No scripts found yet.</div>';
        return;
      }
      feed.innerHTML = '<div class="list-head">📚 Every script we\'ve created (' + scripted.length + ')</div>' +
        scripted.map(function (x) { return cardHtml(x.item); }).join("");
      return;
    }

    // Saved-list views ("Created" / "To create") render from the persistent
    // store, ignoring the 3-month freshness filter so nothing is ever lost.
    if (state.view === "created" || state.view === "want") {
      var items = listItems(state.view);
      var title = state.view === "created" ? "✅ Videos you've created" : "⭐ Videos to create";
      if (items.length === 0) {
        feed.innerHTML = '<div class="list-head">' + title + '</div>' +
          '<div class="empty">Nothing here yet. Open a top pick, then tick the box inside to add it here.</div>';
        return;
      }
      feed.innerHTML = '<div class="list-head">' + title + " (" + items.length + ")</div>" +
        items.map(cardHtml).join("");
      return;
    }

    // Normal feed view, grouped by day.
    var grouped = {};
    var order = [];
    state.allLoadedItems.forEach(function (x) {
      if (!itemMatchesFilter(x.item)) return;
      if (!grouped[x.date]) { grouped[x.date] = []; order.push(x.date); }
      grouped[x.date].push(x.item);
    });

    // Within each day, order articles most-recent to oldest by published_date.
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
      grouped[dateStr].forEach(function (item) { html += cardHtml(item); });
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

  function updateViewButtons() {
    var c = 0, w = 0;
    for (var id in store) { if (store[id].created) c++; if (store[id].want) w++; }
    var cb = document.getElementById("btn-created");
    var wb = document.getElementById("btn-want");
    var sb = document.getElementById("btn-scripts");
    if (cb) { cb.textContent = "✅ Created (" + c + ")"; cb.classList.toggle("active", state.view === "created"); }
    if (wb) { wb.textContent = "⭐ To create (" + w + ")"; wb.classList.toggle("active", state.view === "want"); }
    if (sb) { sb.classList.toggle("active", state.view === "scripts"); }
  }

  function setView(v) {
    state.view = v;
    renderTopPicks();
    renderFeed();
    updateViewButtons();
    window.scrollTo(0, 0);
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
        if (state.view !== "feed") { setView("feed"); } else { renderFeed(); }
      });
    });
    document.getElementById("search").addEventListener("input", function (e) {
      state.searchTerm = e.target.value;
      if (state.view !== "feed") { setView("feed"); } else { renderFeed(); }
    });

    // Top-of-page saved-list buttons: toggle into (or back out of) each list.
    var createdBtn = document.getElementById("btn-created");
    if (createdBtn) createdBtn.addEventListener("click", function () {
      setView(state.view === "created" ? "feed" : "created");
    });
    var wantBtn = document.getElementById("btn-want");
    if (wantBtn) wantBtn.addEventListener("click", function () {
      setView(state.view === "want" ? "feed" : "want");
    });
    var scriptsBtn = document.getElementById("btn-scripts");
    if (scriptsBtn) scriptsBtn.addEventListener("click", function () {
      if (state.view === "scripts") { setView("feed"); return; }
      scriptsBtn.textContent = "📚 Loading…";
      loadAllDays().then(function () {
        scriptsBtn.textContent = "📚 All scripts";
        setView("scripts");
      });
    });
    updateViewButtons();
    var refreshBtn = document.getElementById("refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () { refreshData(refreshBtn); });
    }

    // Delegated clicks: open the detail view for any card carrying a data-item-id
    // (top picks and any feed item that has a script). Ignore clicks on links.
    function cardClickHandler(e) {
      if (e.target.closest("a")) return;
      if (e.target.closest(".gen-script-btn")) return; // Script Studio handles this
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
