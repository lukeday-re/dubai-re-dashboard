# Dubai & Abu Dhabi Real Estate — Daily Content Feed

A local dashboard that pulls daily Dubai/Abu Dhabi real estate news for building 60-second IG/YouTube content.

## Opening it

Double-click `index.html`. No server, no install required — it opens straight in your browser.

## How it updates

A daily scheduled task (see `list_scheduled_tasks` in Claude Code, task id `dubai-re-daily-pull`) re-runs the collection prompt and drops a new `data/YYYY-MM-DD.js` file, then updates `data/index.js`. It fires while the Claude Code app is open at/after 6:30am local time; if the app was closed, it catches up on next launch.

To force a fresh pull right now, just ask Claude Code: "run today's real estate data pull."

## Editing sources

Everything the daily pull searches for — categories, developers, queries, preferred outlets — lives in `config/sources.json`. Edit that file anytime; no code changes needed.

## Folder structure

```
index.html / style.css / app.js   -> the dashboard
data/YYYY-MM-DD.js                -> one file per day's items + that day's top picks
data/index.js                     -> ordered list of dates, drives the archive/infinite-scroll
config/sources.json               -> editable category/query/developer list
```

## Phone access

Not set up yet (Phase 1 is local-only by design — see the plan). If you want to check this from your phone, that needs GitHub Pages hosting, which is a deliberate next step, not automatic.
