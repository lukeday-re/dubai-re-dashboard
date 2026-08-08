/* Script Studio — turns a daily story into a production-ready, first-person
   opinion script + shot list with portrait Pexels queries.
   Calls the Anthropic API directly from the browser (key stored locally). */
(function () {
  "use strict";

  var MODEL = "claude-sonnet-4-6";
  var MAX_TOKENS = 8000; // a full 15-20 shot list + captions overruns 4000 tokens
  var API_URL = "https://api.anthropic.com/v1/messages";
  var ANTHROPIC_VERSION = "2023-06-01";

  var KEY_STORE = "re_anthropic_key";
  var SCRIPTS_STORE = "re_scripts_v1";   // { [storyId]: {result, meta, produced} }
  var PRODUCED_STORE = "re_produced_v1"; // [ {storyId, headline, hook, platforms[], date, retention_note} ]

  var BANNED_OPENERS = ["okay", "plot twist", "wait", "did you know", "here's something",
    "let me tell you", "according to", "a new report", "so", "listen"];

  // Dashboard categories -> script schema categories
  var CATEGORY_MAP = {
    developer_launch: "new_launch",
    infrastructure: "policy",
    market_data: "price_data",
    abu_dhabi: "abu_dhabi",
    market_drivers: "policy"
  };
  var SCHEMA_CATEGORIES = ["new_launch", "policy", "price_data", "abu_dhabi"];

  // ---- System prompt (tuned voice + hard constraints) --------------------
  var SYSTEM_PROMPT =
'You write vertical short-form video scripts about Dubai and Abu Dhabi property for a channel called "Day on Dubai". The voice is Luke\'s: an Australian agent working the luxury end of the Dubai market — Palm Jumeirah villas, off-plan launches, the Dubai and Abu Dhabi development pipeline.\n' +
'\n' +
'Write in FIRST PERSON as a genuine opinion piece: "I think", "here\'s what I\'d tell a client", "in my view", "what I\'d watch". The channel currently runs AI voiceover over stock B-roll with burned-in captions and he is not on camera yet — but he may reveal himself later, so the script must already read as one credible person\'s take, never a faceless news read.\n' +
'\n' +
'The audience is buyers, investors, expats considering Dubai, and other agents. They can get the headline anywhere. They come here for what someone inside the market makes of it.\n' +
'\n' +
'## TONE — one voice, always\n' +
'Professional and genuinely informative, but playful. Explain the thing clearly, then say what you actually think of it. Confident and opinionated without being a hype-merchant; dry wit is welcome, forced excitement is not. First person throughout. British spelling. Write AED as "AED 25 million", never "25M".\n' +
'BANNED words/phrases (they read as fake-viral and cost credibility): game-changer, skyrocket, insane, unbelievable, boom, crazy, wild, massive, huge, "wake-up call", "let that sink in", "you won\'t believe".\n' +
'The ENERGY input controls PACE ONLY, never hype:\n' +
'- ENERGY = "Measured": steadier sentences, one clear through-line, the delivery of someone explaining across a desk. No exclamation marks.\n' +
'- ENERGY = "Punchy": shorter sentences, faster cuts, contractions, more momentum from rhythm. One exclamation maximum in the whole script. Energy comes from cut pace and sentence length, not adjectives or effects.\n' +
'Under both: no fireworks, explosions, confetti, sticker animations, or meme effects. Emphasis comes from typography and timing.\n' +
'\n' +
'## HARD CONSTRAINTS — violating any of these makes the output unusable\n' +
'1. SCRIPT LENGTH: 145-165 words (about 55-65 seconds at natural pace). Count the words and state the count in word_count.\n' +
'2. SHOT COUNT: 15-20 shots. Every shot is 2.5-4.0 seconds. No shot may exceed 4.0 seconds. Static footage held past four seconds is where viewers leave.\n' +
'3. THE HOOK IS THE STORY\'S STRONGEST FACT, NOT A PREAMBLE. Shot 1 must contain the single most surprising, specific, verifiable number or claim in the source. Maximum 12 words. BANNED openers: "okay", "plot twist", "wait", "did you know", "here\'s something", "let me tell you", "according to", "a new report", "so", "listen". If the first three words could open any video about any topic, rewrite it. The hook must also appear as on_screen_text in shot 1, because most viewers watch muted and decide within one second.\n' +
'4. VISUALS MUST MATCH THE SUBJECT LITERALLY. If the story is about offices, the shots are offices, lobbies, workspaces, business districts — not a generic skyline. If it is about villas, they are villas. Generic Dubai skyline is permitted for a maximum of 3 shots, and never for a shot where a specific place, asset class or building is named. When the script names a location (Business Bay, JLT, Palm Jumeirah), the visual search terms for that shot must name it too.\n' +
'5. EVERY STATISTIC IS ATTRIBUTED ONCE. Somewhere in the script, name where the numbers come from — DLD, Knight Frank, Property Monitor, the developer. Once, not repeatedly.\n' +
'6. NEVER STATE A FIGURE NOT PRESENT IN THE SOURCE. No estimation, no rounding into a rounder number, no derived percentages unless the arithmetic is explicit and correct.\n' +
'7. ONE LINE OF JUDGEMENT, MINIMUM. At least one sentence must be an opinion only someone working this market would offer — what it means, who it favours, what the data understates. Mark it in judgement_line. A script that is purely facts is a rejected script.\n' +
'8. NO INVESTMENT ADVICE. No guaranteed returns, no price predictions, no "now is the time to buy". Opinions framed as opinions.\n' +
'9. NEVER NAME A BROKERAGE, employer, specific client, or a live listing.\n' +
'\n' +
'## CAPTION AND TEXT RULES\n' +
'- on_screen_text is SHORT: a number, a place name, a two-to-four word label. Not a subtitle.\n' +
'- Not every shot needs on_screen_text. Roughly 6-9 of the 15-20 shots.\n' +
'- Any shot whose voiceover contains a statistic SHOULD have that statistic as on_screen_text.\n' +
'\n' +
'## OUTPUT\n' +
'Return ONLY valid JSON matching the schema below. No preamble, no markdown fences, no commentary.\n' +
'\n' +
'## OUTPUT SCHEMA (return exactly this shape)\n' +
'{\n' +
'  "meta": { "story_headline": string, "source_name": string, "source_url": string, "category": "new_launch|policy|price_data|abu_dhabi", "tone": string, "word_count": number, "estimated_seconds": number, "shot_count": number },\n' +
'  "hook": { "vo_text": string, "on_screen_text": string, "why_this_hook": string },\n' +
'  "judgement_line": { "text": string, "shot_index": number },\n' +
'  "attribution": string,\n' +
'  "script_full": "the complete VO script as continuous prose, for pasting into ElevenLabs",\n' +
'  "shots": [ { "index": number, "start_sec": number, "duration_sec": number, "vo_text": string, "on_screen_text": string, "text_position": "upper_third|centre|lower_third", "visual": { "type": "stock|data_card|own_footage", "description": string, "pexels_queries": [3 to 5 strings, most-specific first], "fallback_query": string, "own_footage_tag": string or null } } ],\n' +
'  "data_cards": [ { "shot_index": number, "headline_figure": string, "sub_label": string, "note": string } ],\n' +
'  "end_card": { "text": "Follow @dayondubai for daily Dubai market updates", "duration_sec": 1.5 },\n' +
'  "captions": { "tiktok": string (<150 chars), "instagram": string (<300 chars), "youtube_title": string (<70 chars), "youtube_description": string },\n' +
'  "hashtags": [string],\n' +
'  "alt_hooks": [two more hook options, so three total including the primary],\n' +
'  "compliance_flags": [ { "type": "unsupported_number|advice|brokerage_mention|tone", "detail": string, "shot_index": number } ]\n' +
'}\n' +
'Rules: pexels_queries are search strings (not descriptions), 3-5 per shot, most-specific first. Populate own_footage_tag when the shot is something Luke plausibly has of his own (Palm Jumeirah villa exteriors, Palm aerials, Marina, Sheikh Zayed Road); else null. data_cards are the 2-3 numeric moments that replace footage entirely. alt_hooks holds two alternatives (three total with the primary). compliance_flags is an empty array if clean — never suppress a flag to look cleaner. total of shot durations should sum to within 2 seconds of estimated_seconds.';

  // ---- Storage helpers ---------------------------------------------------
  function getKey() { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } }
  function setKey(k) { try { localStorage.setItem(KEY_STORE, k); } catch (e) {} }
  function hasKey() { return !!getKey(); }

  function loadScripts() { try { return JSON.parse(localStorage.getItem(SCRIPTS_STORE)) || {}; } catch (e) { return {}; } }
  function saveScripts(o) { try { localStorage.setItem(SCRIPTS_STORE, JSON.stringify(o)); } catch (e) {} }
  function getSaved(id) { return loadScripts()[id] || null; }
  function putSaved(id, val) { var o = loadScripts(); o[id] = val; saveScripts(o); }

  function loadProduced() { try { return JSON.parse(localStorage.getItem(PRODUCED_STORE)) || []; } catch (e) { return []; } }
  function saveProduced(a) { try { localStorage.setItem(PRODUCED_STORE, JSON.stringify(a)); } catch (e) {} }

  // ---- Utilities ---------------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function wordCount(s) { return String(s || "").trim().split(/\s+/).filter(Boolean).length; }
  function pexelsLink(q) {
    return "https://www.pexels.com/search/videos/" + encodeURIComponent(String(q || "").trim()) + "/?orientation=portrait";
  }
  function copyText(text, btn) {
    var done = function () {
      if (!btn) return;
      var orig = btn.getAttribute("data-label") || btn.textContent;
      btn.setAttribute("data-label", orig);
      btn.textContent = "✓ Copied";
      btn.classList.add("copied");
      setTimeout(function () { btn.textContent = orig; btn.classList.remove("copied"); }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fb);
    } else { fb(); }
    function fb() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta); done();
    }
  }
  function extractJson(text) {
    var t = String(text || "").trim();
    // strip ```json fences if the model added them despite instructions
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    var start = t.indexOf("{"), end = t.lastIndexOf("}");
    if (start > -1 && end > -1) t = t.slice(start, end + 1);
    return JSON.parse(t);
  }
  function bulletsToText(b) { return (b || []).map(function (x) { return "• " + x; }).join("\n"); }

  // ---- Build the story text passed to the model --------------------------
  function buildUserContent(item, energy, seconds, category) {
    var parts = [];
    parts.push("STORY HEADLINE: " + (item.headline || ""));
    parts.push("SOURCE: " + (item.source_name || "") + (item.source_url ? " (" + item.source_url + ")" : ""));
    parts.push("PUBLISHED: " + (item.published_date || ""));
    parts.push("CATEGORY: " + category);
    if (item.developer_tags && item.developer_tags.length) parts.push("DEVELOPERS: " + item.developer_tags.join(", "));
    if (item.location_tags && item.location_tags.length) parts.push("LOCATIONS NAMED: " + item.location_tags.join(", "));
    parts.push("");
    parts.push("SUMMARY / SOURCE FACTS:\n" + (item.summary || ""));
    if (item.bullets && item.bullets.length) parts.push("\nKEY FACTS (only use figures present here or in the summary):\n" + bulletsToText(item.bullets));
    if (item.hook_angle) parts.push("\nSUGGESTED ANGLE (a starting idea, improve on it): " + item.hook_angle);
    parts.push("");
    parts.push("ENERGY: " + energy);
    parts.push("TARGET LENGTH: " + seconds + " seconds (script 145-165 words)");
    parts.push("");
    parts.push("Write the script and shot list now. Every figure must come from the facts above — do not invent numbers. Return ONLY the JSON object, nothing else.");
    return parts.join("\n");
  }

  // ---- API call ----------------------------------------------------------
  function callAnthropic(userContent) {
    var key = getKey();
    if (!key) return Promise.reject(new Error("NO_KEY"));
    return fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }]
      })
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || (data && data.type === "error")) {
          var msg = (data && data.error && data.error.message) || ("HTTP " + r.status);
          throw new Error(msg);
        }
        if (data.stop_reason === "refusal") throw new Error("The model declined this request.");
        var block = (data.content || []).filter(function (b) { return b.type === "text"; })[0];
        if (!block) throw new Error("Empty response from the model.");
        if (data.stop_reason === "max_tokens") {
          throw new Error("The script was cut off at the length limit — please hit Generate again.");
        }
        try {
          return extractJson(block.text);
        } catch (e) {
          console.warn("Raw model output that failed to parse:", block.text);
          throw new Error("The model returned malformed JSON (usually a length cut-off). Please try Generate again.");
        }
      });
    });
  }

  // ---- Validation layer --------------------------------------------------
  function validate(result) {
    var fails = [];
    function push(check, msg) { fails.push({ check: check, msg: msg }); }
    if (!result || typeof result !== "object") { push("parse", "Response was not a valid object."); return fails; }

    var shots = result.shots || [];
    var wc = wordCount(result.script_full);
    if (!(wc >= 145 && wc <= 165)) push("word count", "Script is " + wc + " words (need 145-165).");

    if (!(shots.length >= 15 && shots.length <= 20)) push("shot count", shots.length + " shots (need 15-20).");

    var badDur = shots.filter(function (s) { return !(s.duration_sec >= 2.5 && s.duration_sec <= 4.0); });
    if (badDur.length) push("shot duration", badDur.length + " shot(s) outside 2.5-4.0s (e.g. shot " + (badDur[0].index) + " = " + badDur[0].duration_sec + "s).");

    var totalDur = shots.reduce(function (a, s) { return a + (Number(s.duration_sec) || 0); }, 0);
    var est = Number(result.meta && result.meta.estimated_seconds) || 0;
    if (est && Math.abs(totalDur - est) > 2) push("total duration", "Shots sum to " + totalDur.toFixed(1) + "s vs estimated " + est + "s (>2s off).");

    var hook = result.hook || {};
    if (wordCount(hook.vo_text) > 12) push("hook length", "Hook is " + wordCount(hook.vo_text) + " words (max 12).");
    var opener = String(hook.vo_text || "").toLowerCase().replace(/^[^a-z0-9]+/, "");
    if (BANNED_OPENERS.some(function (b) { return opener.indexOf(b) === 0; })) push("hook opener", 'Hook opens with a banned filler word.');
    if (!String(hook.on_screen_text || "").trim()) push("hook on-screen text", "Shot 1 has no on-screen text.");

    var jl = result.judgement_line || {};
    var jlOk = jl.text && shots.some(function (s) { return s.index === jl.shot_index; });
    if (!jlOk) push("judgement line", "Missing judgement line or it maps to no shot.");

    if (!String(result.attribution || "").trim()) push("attribution", "No source attribution.");

    var skyline = shots.filter(function (s) {
      var v = s.visual || {}; var blob = ((v.pexels_queries || []).join(" ") + " " + (v.description || "")).toLowerCase();
      return blob.indexOf("skyline") > -1;
    });
    if (skyline.length > 3) push("generic skyline", skyline.length + " skyline shots (max 3).");

    var badQ = shots.filter(function (s) {
      var q = (s.visual && s.visual.pexels_queries) || [];
      return !(q.length >= 3 && q.length <= 5) || q.some(function (x) { return !String(x || "").trim(); });
    });
    if (badQ.length) push("pexels queries", badQ.length + " shot(s) without 3-5 non-empty queries.");

    return fails;
  }

  // ---- Overlay plumbing --------------------------------------------------
  function overlay(id) { return document.getElementById(id); }
  function openOverlay(id) { var o = overlay(id); if (o) { o.style.display = "flex"; document.body.style.overflow = "hidden"; } }
  function closeOverlay(id) { var o = overlay(id); if (o) { o.style.display = "none"; document.body.style.overflow = ""; } }

  // ---- Settings ----------------------------------------------------------
  function openSettings() {
    var c = document.getElementById("settings-content");
    c.innerHTML =
      '<h2 class="studio-h">⚙️ Settings</h2>' +
      '<label class="studio-label" for="anthropic-key">Anthropic API key</label>' +
      '<input id="anthropic-key" class="studio-input" type="password" placeholder="sk-ant-..." value="' + esc(getKey()) + '">' +
      '<p class="studio-note">Stored only in this browser (localStorage) — never uploaded or committed. Get a key at console.anthropic.com. Generating a shot list uses the Claude API (pay-as-you-go, a few cents per script) on the ' + esc(MODEL) + ' model.</p>' +
      '<div class="studio-actions"><button class="studio-btn primary" id="save-key">Save key</button>' +
      '<button class="studio-btn" id="clear-key">Remove key</button></div>';
    c.querySelector("#save-key").addEventListener("click", function () {
      setKey(c.querySelector("#anthropic-key").value.trim());
      closeOverlay("settings-overlay");
    });
    c.querySelector("#clear-key").addEventListener("click", function () {
      setKey(""); c.querySelector("#anthropic-key").value = "";
    });
    openOverlay("settings-overlay");
  }

  // ---- Studio: options -> generate --------------------------------------
  var currentItem = null, currentResult = null, currentOpts = null;

  function openStudio(item) {
    currentItem = item;
    var saved = getSaved(item.id);
    if (saved && saved.result) {
      currentResult = saved.result; currentOpts = saved.meta;
      renderStudio(item, saved.result, saved.meta);
    } else {
      renderOptions(item);
    }
    openOverlay("studio-overlay");
  }

  function renderOptions(item) {
    var inheritCat = CATEGORY_MAP[item.category] || "price_data";
    var c = document.getElementById("studio-content");
    c.innerHTML =
      '<div class="studio-head"><div><div class="studio-kicker">Script Studio</div>' +
      '<h2 class="studio-h">' + esc(item.headline) + '</h2>' +
      '<div class="studio-sub">' + esc(item.source_name || "") + (item.published_date ? " · " + esc(item.published_date) : "") + '</div></div></div>' +
      (hasKey() ? "" : '<div class="studio-flag">Add your Anthropic API key in ⚙️ Settings before generating.</div>') +
      '<div class="opt-row"><span class="opt-label">Energy</span>' +
      '<div class="seg" data-opt="energy"><button class="seg-btn active" data-v="Measured">Measured</button><button class="seg-btn" data-v="Punchy">Punchy</button></div></div>' +
      '<div class="opt-row"><span class="opt-label">Length</span>' +
      '<div class="seg" data-opt="seconds"><button class="seg-btn" data-v="55">55s</button><button class="seg-btn active" data-v="60">60s</button><button class="seg-btn" data-v="65">65s</button></div></div>' +
      '<div class="opt-row"><span class="opt-label">Category</span>' +
      '<div class="seg" data-opt="category">' +
      SCHEMA_CATEGORIES.map(function (k) {
        return '<button class="seg-btn' + (k === inheritCat ? " active" : "") + '" data-v="' + k + '">' + k.replace("_", " ") + '</button>';
      }).join("") + '</div></div>' +
      '<div class="studio-actions"><button class="studio-btn primary" id="gen-go"' + (hasKey() ? "" : " disabled") + '>🎬 Generate shot list</button></div>';

    // segmented control behaviour
    c.querySelectorAll(".seg").forEach(function (seg) {
      seg.addEventListener("click", function (e) {
        var b = e.target.closest(".seg-btn"); if (!b) return;
        seg.querySelectorAll(".seg-btn").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
      });
    });
    c.querySelector("#gen-go").addEventListener("click", function () {
      var opts = readOptions(c);
      runGenerate(item, opts);
    });
  }

  function readOptions(root) {
    function val(opt) { var a = root.querySelector('[data-opt="' + opt + '"] .active'); return a ? a.getAttribute("data-v") : null; }
    return { energy: val("energy") || "Measured", seconds: parseInt(val("seconds") || "60", 10), category: val("category") || "price_data" };
  }

  function runGenerate(item, opts) {
    var c = document.getElementById("studio-content");
    c.innerHTML = '<div class="studio-loading"><div class="spinner"></div><p>Writing your ' + opts.seconds + '-second script and shot list…</p><p class="studio-note">One Claude call — usually 10-25 seconds.</p></div>';
    var userContent = buildUserContent(item, opts.energy, opts.seconds, opts.category);
    callAnthropic(userContent).then(function (result) {
      currentItem = item; currentResult = result; currentOpts = opts;
      putSaved(item.id, { result: result, meta: opts, produced: (getSaved(item.id) || {}).produced || false });
      renderStudio(item, result, opts);
    }).catch(function (err) { renderError(item, opts, err); });
  }

  function renderError(item, opts, err) {
    var msg = err && err.message === "NO_KEY" ? "No API key set. Add one in ⚙️ Settings." : (err && err.message) || "Something went wrong.";
    var c = document.getElementById("studio-content");
    c.innerHTML = '<div class="studio-flag">Generation failed: ' + esc(msg) + '</div>' +
      '<div class="studio-actions"><button class="studio-btn primary" id="retry">Try again</button>' +
      '<button class="studio-btn" id="back-opts">Back to options</button></div>';
    c.querySelector("#retry").addEventListener("click", function () { runGenerate(item, opts); });
    c.querySelector("#back-opts").addEventListener("click", function () { renderOptions(item); });
  }

  // ---- Studio: render result --------------------------------------------
  function renderStudio(item, r, opts) {
    var c = document.getElementById("studio-content");
    var fails = validate(r);
    var meta = r.meta || {};
    var wc = wordCount(r.script_full);
    var shots = r.shots || [];

    var html = "";
    html += '<div class="studio-head"><div><div class="studio-kicker">Script Studio · ' + esc(meta.category || opts.category) + ' · ' + esc((opts && opts.energy) || meta.tone || "") + '</div>' +
      '<h2 class="studio-h">' + esc(meta.story_headline || item.headline) + '</h2>' +
      '<div class="studio-sub">' + esc(meta.source_name || item.source_name || "") + ' · ' + wc + ' words · ~' + (meta.estimated_seconds || "?") + 's · ' + shots.length + ' shots</div></div></div>';

    if (fails.length) {
      html += '<div class="studio-flag err"><strong>⚠ ' + fails.length + ' validation issue' + (fails.length > 1 ? "s" : "") + '</strong><ul>' +
        fails.map(function (f) { return "<li><b>" + esc(f.check) + ":</b> " + esc(f.msg) + "</li>"; }).join("") +
        '</ul><button class="studio-btn small" id="fix-regen">↻ Regenerate</button></div>';
    } else {
      html += '<div class="studio-flag ok">✓ Passed all validation checks</div>';
    }

    if (r.compliance_flags && r.compliance_flags.length) {
      html += '<div class="studio-flag err"><strong>Compliance flags</strong><ul>' +
        r.compliance_flags.map(function (f) { return "<li><b>" + esc(f.type) + ":</b> " + esc(f.detail) + (f.shot_index != null ? " (shot " + f.shot_index + ")" : "") + "</li>"; }).join("") + "</ul></div>";
    }

    // Hook block
    var hook = r.hook || {};
    html += '<section class="studio-sec hook-sec"><h3>🪝 Hook</h3>' +
      '<div class="hook-primary"><div class="hook-vo">' + esc(hook.vo_text) + '</div>' +
      '<div class="hook-ost">ON SCREEN: ' + esc(hook.on_screen_text) + '</div>' +
      (hook.why_this_hook ? '<div class="hook-why">' + esc(hook.why_this_hook) + '</div>' : "") + '</div>';
    if (r.alt_hooks && r.alt_hooks.length) {
      html += '<div class="alt-hooks"><div class="alt-title">Alternatives (A/B)</div>' +
        r.alt_hooks.map(function (h, i) {
          return '<div class="alt-hook"><span>' + esc(h) + '</span><button class="studio-btn small use-hook" data-i="' + i + '">Use this</button></div>';
        }).join("") + '</div>';
    }
    html += '</section>';

    // Full script
    html += '<section class="studio-sec"><div class="sec-head"><h3>🎙️ Full script</h3>' +
      '<span class="sec-meta">' + wc + ' words · ~' + (meta.estimated_seconds || "?") + 's</span>' +
      '<button class="studio-btn small copy-btn" data-copy="script">Copy</button></div>' +
      '<p class="script-full">' + esc(r.script_full) + '</p></section>';

    // Shot table
    html += '<section class="studio-sec"><div class="sec-head"><h3>🎬 Shot list</h3>' +
      '<button class="studio-btn small" id="reroll-visuals">↻ Re-roll visuals only</button></div>' +
      '<div class="shots">';
    shots.forEach(function (s) {
      var v = s.visual || {};
      var st = getShotState(item.id, s.index);
      html += '<div class="shot' + (st ? " sourced" : "") + '" data-shot="' + s.index + '">' +
        '<div class="shot-top"><label class="shot-check"><input type="checkbox" class="src-chk" data-shot="' + s.index + '"' + (st ? " checked" : "") + '> sourced</label>' +
        '<span class="shot-idx">#' + s.index + '</span><span class="shot-time">' + (s.start_sec != null ? s.start_sec + "s" : "") + ' · ' + s.duration_sec + 's</span>' +
        (v.type === "data_card" ? '<span class="shot-tag data">DATA CARD</span>' : (v.type === "own_footage" ? '<span class="shot-tag own">OWN</span>' : "")) +
        '</div>' +
        '<div class="shot-vo">' + esc(s.vo_text) + '</div>' +
        (s.on_screen_text ? '<div class="shot-ost">▸ ' + esc(s.on_screen_text) + ' <span class="shot-pos">(' + esc(s.text_position || "") + ')</span></div>' : "") +
        (v.description ? '<div class="shot-desc">' + esc(v.description) + '</div>' : "") +
        (v.own_footage_tag ? '<div class="shot-own">📁 you likely have: ' + esc(v.own_footage_tag) + '</div>' : "") +
        '<div class="pexels-row">' +
        (v.pexels_queries || []).map(function (q) {
          return '<a class="pexels-link" href="' + esc(pexelsLink(q)) + '" target="_blank" rel="noopener">🔎 ' + esc(q) + '</a>' +
            '<button class="pexels-copy" data-q="' + esc(q) + '" title="Copy query">⧉</button>';
        }).join("") +
        (v.fallback_query ? '<a class="pexels-link fallback" href="' + esc(pexelsLink(v.fallback_query)) + '" target="_blank" rel="noopener">↩ ' + esc(v.fallback_query) + '</a>' : "") +
        '</div></div>';
    });
    html += '</div></section>';

    // Data cards
    if (r.data_cards && r.data_cards.length) {
      html += '<section class="studio-sec"><h3>📊 Data cards (full-screen, no footage)</h3><div class="data-cards">' +
        r.data_cards.map(function (d) {
          return '<div class="data-card"><div class="dc-fig">' + esc(d.headline_figure) + '</div><div class="dc-sub">' + esc(d.sub_label) + '</div>' +
            (d.note ? '<div class="dc-note">' + esc(d.note) + '</div>' : "") + (d.shot_index != null ? '<div class="dc-shot">shot ' + d.shot_index + '</div>' : "") + '</div>';
        }).join("") + '</div></section>';
    }

    // Captions
    if (r.captions) {
      var cap = r.captions;
      html += '<section class="studio-sec"><h3>✍️ Captions</h3>' +
        capBlock("TikTok", cap.tiktok, "tiktok") +
        capBlock("Instagram", cap.instagram, "instagram") +
        capBlock("YouTube title", cap.youtube_title, "yt_title") +
        capBlock("YouTube description", cap.youtube_description, "yt_desc") +
        (r.hashtags && r.hashtags.length ? '<div class="hashtags">' + r.hashtags.map(function (h) { return '<span class="tag">' + esc(h) + '</span>'; }).join(" ") + '<button class="studio-btn small copy-btn" data-copy="hashtags">Copy tags</button></div>' : "") +
        '</section>';
    }

    // Actions
    var produced = (getSaved(item.id) || {}).produced;
    html += '<div class="studio-actions bottom">' +
      '<button class="studio-btn" id="regen-all">↻ Regenerate all</button>' +
      '<button class="studio-btn" id="export-json">Export JSON</button>' +
      '<button class="studio-btn ' + (produced ? "done" : "primary") + '" id="mark-produced">' + (produced ? "✓ Produced" : "Mark as produced") + '</button>' +
      (r.source_url || item.source_url ? '<a class="studio-btn" href="' + esc(r.meta && r.meta.source_url ? r.meta.source_url : item.source_url) + '" target="_blank" rel="noopener">🔗 Source article</a>' : "") +
      '</div>';

    c.innerHTML = html;
    c.scrollTop = 0;
    wireStudio(item, r, opts, c);
  }

  function capBlock(label, text, key) {
    return '<div class="cap"><div class="cap-head"><span>' + esc(label) + '</span>' +
      '<button class="studio-btn small copy-btn" data-copy="' + key + '">Copy</button></div>' +
      '<div class="cap-text">' + esc(text) + '</div></div>';
  }

  function getShotState(id, idx) {
    var s = getSaved(id); return !!(s && s.sourced && s.sourced[idx]);
  }
  function setShotState(id, idx, on) {
    var s = getSaved(id) || {}; s.sourced = s.sourced || {}; s.sourced[idx] = on; putSaved(id, s);
  }

  function wireStudio(item, r, opts, c) {
    // copy buttons
    c.querySelectorAll(".copy-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-copy"), txt = "";
        if (k === "script") txt = r.script_full;
        else if (k === "hashtags") txt = (r.hashtags || []).join(" ");
        else if (k === "tiktok") txt = r.captions.tiktok;
        else if (k === "instagram") txt = r.captions.instagram;
        else if (k === "yt_title") txt = r.captions.youtube_title;
        else if (k === "yt_desc") txt = r.captions.youtube_description;
        copyText(txt, b);
      });
    });
    c.querySelectorAll(".pexels-copy").forEach(function (b) {
      b.addEventListener("click", function () { copyText(b.getAttribute("data-q"), b); });
    });
    c.querySelectorAll(".src-chk").forEach(function (chk) {
      chk.addEventListener("change", function () {
        setShotState(item.id, parseInt(chk.getAttribute("data-shot"), 10), chk.checked);
        var shot = chk.closest(".shot"); if (shot) shot.classList.toggle("sourced", chk.checked);
      });
    });
    c.querySelectorAll(".use-hook").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = parseInt(b.getAttribute("data-i"), 10);
        var chosen = r.alt_hooks[i];
        var oldPrimary = r.hook.vo_text;
        r.hook.vo_text = chosen;
        r.alt_hooks[i] = oldPrimary; // swap so nothing is lost
        if (r.shots[0]) r.shots[0].vo_text = chosen;
        putSaved(item.id, { result: r, meta: opts, produced: (getSaved(item.id) || {}).produced, sourced: (getSaved(item.id) || {}).sourced });
        renderStudio(item, r, opts);
      });
    });
    var fix = c.querySelector("#fix-regen"); if (fix) fix.addEventListener("click", function () { runGenerate(item, opts); });
    var reAll = c.querySelector("#regen-all"); if (reAll) reAll.addEventListener("click", function () { runGenerate(item, opts); });
    var reV = c.querySelector("#reroll-visuals"); if (reV) reV.addEventListener("click", function () { rerollVisuals(item, r, opts); });
    var exp = c.querySelector("#export-json"); if (exp) exp.addEventListener("click", function () { exportJson(item, r); });
    var mp = c.querySelector("#mark-produced"); if (mp) mp.addEventListener("click", function () { markProduced(item, r); });
  }

  // ---- Re-roll visuals only ---------------------------------------------
  function rerollVisuals(item, r, opts) {
    var c = document.getElementById("studio-content");
    var overlayNote = document.createElement("div");
    overlayNote.className = "studio-loading floating"; overlayNote.innerHTML = '<div class="spinner"></div><p>Finding alternative footage…</p>';
    c.appendChild(overlayNote);
    var shotsForModel = (r.shots || []).map(function (s) { return { index: s.index, vo_text: s.vo_text, subject: (s.visual || {}).description }; });
    var prompt = "Here is the shot list for a Dubai property video. For EACH shot, propose ALTERNATIVE stock-footage search terms only — the script, timings and captions are locked and must not change.\n\n" +
      "SHOTS:\n" + JSON.stringify(shotsForModel, null, 2) + "\n\n" +
      "Return ONLY a JSON object of this shape and nothing else:\n" +
      '{ "shots": [ { "index": number, "visual": { "type": "stock|data_card|own_footage", "description": string, "pexels_queries": [3 to 5 strings, most-specific first], "fallback_query": string, "own_footage_tag": string or null } } ] }\n' +
      "Rules: queries must literally match the subject (offices=offices, villas=villas); name the location in the query when the shot names a place; generic Dubai skyline for at most 3 shots total; 3-5 non-empty queries per shot.";
    callAnthropic(prompt).then(function (res) {
      var byIdx = {};
      (res.shots || []).forEach(function (s) { if (s && s.index != null && s.visual) byIdx[s.index] = s.visual; });
      (r.shots || []).forEach(function (s) { if (byIdx[s.index]) s.visual = byIdx[s.index]; }); // vo_text/timings untouched
      putSaved(item.id, { result: r, meta: opts, produced: (getSaved(item.id) || {}).produced, sourced: (getSaved(item.id) || {}).sourced });
      renderStudio(item, r, opts);
    }).catch(function (err) {
      overlayNote.remove();
      alert("Re-roll failed: " + ((err && err.message) || "unknown"));
    });
  }

  // ---- Export / produce --------------------------------------------------
  function exportJson(item, r) {
    var blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "dayondubai_" + (item.id || "script") + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function markProduced(item, r) {
    var platforms = prompt("Which platforms did this go to? (comma-separated, e.g. TikTok, Reels, Shorts)", "TikTok, Reels, Shorts");
    if (platforms === null) return;
    var s = getSaved(item.id) || {}; s.produced = true; putSaved(item.id, s);
    var list = loadProduced().filter(function (p) { return p.storyId !== item.id; });
    list.unshift({
      storyId: item.id,
      headline: (r.meta && r.meta.story_headline) || item.headline,
      hook: (r.hook && r.hook.vo_text) || "",
      platforms: platforms.split(",").map(function (x) { return x.trim(); }).filter(Boolean),
      date: new Date().toISOString().slice(0, 10),
      retention_note: (list.find ? "" : "")
    });
    saveProduced(list);
    renderStudio(item, r, getSaved(item.id).meta);
  }

  // ---- Produced archive --------------------------------------------------
  function openArchive() {
    var c = document.getElementById("archive-content");
    var list = loadProduced();
    var html = '<h2 class="studio-h">🎥 Produced archive</h2>';
    if (!list.length) {
      html += '<div class="empty">Nothing produced yet. Open a story, generate its shot list, and hit “Mark as produced”.</div>';
    } else {
      html += list.map(function (p, i) {
        return '<div class="prod-card" data-i="' + i + '">' +
          '<div class="prod-head"><span class="prod-date">' + esc(p.date) + '</span>' +
          '<span class="prod-platforms">' + (p.platforms || []).map(function (x) { return '<span class="tag">' + esc(x) + '</span>'; }).join(" ") + '</span></div>' +
          '<div class="prod-headline">' + esc(p.headline) + '</div>' +
          '<div class="prod-hook">🪝 ' + esc(p.hook) + '</div>' +
          '<label class="studio-label">Analytics / retention note (paste what TikTok showed you)</label>' +
          '<textarea class="studio-input note" data-i="' + i + '" rows="2" placeholder="e.g. 62% avg watch, 1.2k views, hook held to 3s">' + esc(p.retention_note || "") + '</textarea>' +
          '</div>';
      }).join("");
    }
    c.innerHTML = html;
    c.querySelectorAll("textarea.note").forEach(function (t) {
      t.addEventListener("change", function () {
        var i = parseInt(t.getAttribute("data-i"), 10);
        var l = loadProduced(); if (l[i]) { l[i].retention_note = t.value; saveProduced(l); }
      });
    });
    openOverlay("archive-overlay");
  }

  // ---- Wire overlay close buttons + header buttons -----------------------
  function ready() {
    ["studio", "settings", "archive"].forEach(function (name) {
      var closeBtn = document.getElementById(name + "-close");
      if (closeBtn) closeBtn.addEventListener("click", function () { closeOverlay(name + "-overlay"); });
      var ov = document.getElementById(name + "-overlay");
      if (ov) ov.addEventListener("click", function (e) { if (e.target === ov) closeOverlay(name + "-overlay"); });
    });
    var sBtn = document.getElementById("btn-settings"); if (sBtn) sBtn.addEventListener("click", openSettings);
    var aBtn = document.getElementById("btn-produced"); if (aBtn) aBtn.addEventListener("click", openArchive);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { ["studio", "settings", "archive"].forEach(function (n) { closeOverlay(n + "-overlay"); }); }
    });
    // delegated: "Generate shot list" buttons rendered by app.js
    document.addEventListener("click", function (e) {
      var b = e.target.closest(".gen-script-btn");
      if (!b) return;
      e.preventDefault();
      var id = b.getAttribute("data-gen-id");
      var item = (window.MWfindItem && window.MWfindItem(id)) || null;
      if (item) openStudio(item);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();

  window.MW = { openStudio: openStudio, openSettings: openSettings, openArchive: openArchive, hasKey: hasKey };
})();
