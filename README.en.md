# Anime Tracker (番剧记录)

A local-first Windows desktop app (Electron) that records your anime watching progress organized by **year × season**: status, episode count, rating, comments, per-episode watch log — plus a statistics dashboard, download-folder scanning, Excel import/export, and JSON backups. Fully Chinese UI with a pink dark theme.

> The season-info automation pipeline (scraping yuc.wiki / Bangumi to generate quarterly docx / pptx reports) has moved to its own repository: [Luke0122/anime-season-auto](https://github.com/Luke0122/anime-season-auto).

## Features

- **Season organization**: sidebar groups by January / April / July / October.
- **Progress tracking**: one-click “＋1 集” advances an episode and auto-marks the show “completed” at the final episode; supports one-click complete and editing anytime.
- **Watch log**: record and edit the watch time of every episode.
- **Season picker**: pick from the current-season list when adding an anime to auto-fill episode count, update day, synopsis, and cover. Already-added shows are marked “已添加 (added)” to prevent duplicates.
- **Bangumi search**: auto-fill total episodes, synopsis, cover, and rating; gracefully falls back to manual entry when offline.
- **Statistics dashboard**: totals, watching/completed counts, cumulative episodes, completion rate, average rating, top-5 rated, per-season comparison, and monthly trend.
- **Download-folder scanning**: scan a download folder (e.g. `D:\ANIME\花织`), recognize titles and downloaded episode numbers, and warn when downloads are ahead of your watched progress.
- **Import / Export**: import your old “已经 将要 看.xlsx” (auto-dedup); export a styled Excel workbook (overview / per-season detail / full records); export / import complete JSON backups (a safety copy is made before import).
- **Auto backup**: daily / weekly backups as dated JSON files into a folder of your choice (e.g. a sync drive), keeping only the latest N copies; corrupt data is auto-restored from the newest backup.

## Data Sources

- The “当季新番” (current season) list comes **only from [yuc.wiki](https://yuc.wiki/)**: fetched live with a 24-hour cache, falling back to a bundled offline catalog (2019-10 to present).
- “搜 Bangumi” is used only to enrich info when adding a show — not a source for the season list.
- Word (docx) and season-folder JSON files are no longer used as sources.

## Getting Started

### Portable build (recommended)

Double-click `anime-tracker/dist/番剧记录.exe` (Windows x64, no installation required).

### Development

```bash
cd anime-tracker
npm install        # first time
npm start          # launch the app
npm test           # run tests (node --test)
npm run dist       # rebuild the portable exe
```

Requires Node.js 18+ (Electron 37).

## Data & Backups

- Data lives in `%APPDATA%\anime-tracker\data.json` (shown in Settings).
- Every modification refreshes the same-day backup (`backups/`, keeping the latest 30).
- For multi-device sync, put the whole `anime-tracker` data directory into a sync drive, combined with auto-backup.

## Repository Layout

```
anime-tracker/
├── main.js / preload.js      # Electron main process & secure bridge
├── lib/
│   ├── store.js              # persistence (atomic writes + auto backup + corruption recovery)
│   ├── seasonData.js         # season data source (yuc.wiki live + bundled catalog)
│   ├── yucLive.js            # yuc.wiki page parser (strips HTML-commented preview cards)
│   ├── bangumi.js            # Bangumi search API client
│   ├── scanner.js            # download-folder scanning & filename parsing
│   ├── excel.js              # Excel import (old/new formats) & styled export
│   ├── docxParser.js         # docx table parser (kept as utility; no longer used by the app)
│   └── backup.js             # auto-backup export
├── renderer/                 # UI (vanilla HTML/CSS/JS, pink dark theme)
├── data/
│   ├── yuc-catalog.json      # bundled yuc.wiki season catalog (offline fallback)
│   └── covers/               # bundled anime covers
└── tests/                    # unit tests (node --test, 39 cases)
```

## FAQ

- **Does “当季新番” work offline?** Yes — it falls back to the bundled yuc.wiki catalog.
- **Why is there only one “Mushoku Tensei” entry for July 2026?** yuc.wiki hides ended “first-week 2-episode preview” cards inside HTML comments; the parser strips comments so the show never appears twice.
- **Where is the data file?** `%APPDATA%\anime-tracker\data.json` (visible in Settings).
- **Does the portable build need internet?** Everything works offline except live season fetching and Bangumi search.

## License

MIT License