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
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("missing " + src)); };
      document.head.appendChild(s);
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

  function itemMatchesFilter(item) {
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
      return '<div class="pick-card">' +
        '<div class="pick-headline">' + escapeHtml(it.headline) + "</div>" +
        (it.hook_angle ? '<div class="hook">🎬 ' + escapeHtml(it.hook_angle) + "</div>" : "") +
        "</div>";
    }).join("");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
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

    if (order.length === 0) {
      feed.innerHTML = '<div class="empty">No stories match this filter yet.</div>';
      return;
    }

    var html = "";
    order.forEach(function (dateStr) {
      html += '<div class="day-divider">' + fmtDayLabel(dateStr) + "</div>";
      grouped[dateStr].forEach(function (item) {
        var meta = CATEGORY_META[item.category] || { label: item.category, color: "#555" };
        html += '<div class="card">' +
          '<span class="badge" style="background:' + meta.color + '">' + meta.label + "</span>" +
          '<div class="headline">' + escapeHtml(item.headline) + "</div>" +
          '<div class="summary">' + escapeHtml(item.summary) + "</div>" +
          (item.hook_angle ? '<div class="hook">🎬 ' + escapeHtml(item.hook_angle) + "</div>" : "") +
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
  }

  function init() {
    wireControls();
    if (state.dates.length === 0) {
      document.getElementById("feed").innerHTML = '<div class="empty">No data files found yet. Run a collection pass to populate data/.</div>';
      document.getElementById("updated").textContent = "No data yet";
      return;
    }
    setUpdatedLabel();
    loadNextBatch().then(function () {
      renderTopPicks();
      renderFeed();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
