# Changelog

All notable changes to KintounTV. Versions follow [Semantic Versioning](https://semver.org);
`npm run release` publishes the section matching the version in `package.json`.

## 1.1.0 — 2026-10-19

- **Watch order flow chart** on every title page, replacing the old Seasons row. The whole franchise
  is mapped: seasons as numbered steps with arrows, and movies, OVAs, recaps and spin-offs branching
  off the step they belong to. Each tile shows its poster, format (TV, Movie, OVA, Special, ONA),
  episode count or runtime, season, airing status, "You're here" and your resume episode.
- Recap movies sit after the last season they cover; remasters (Dragon Ball Z Kai) get their own line.
- Long-running series with many movies (Detective Conan, One Piece) spread them in a wide grid; on
  phones the chart becomes a vertical timeline.

## 1.0.0 — 2026-10-18

First public release.

- **Catalog:** home rows, categories, latest, search, and detail pages with seasons, related and similar titles.
- **In-app player, no ads:** adaptive HLS with quality selection, subtitles when the stream has them,
  playback speed, keyboard shortcuts, and true fullscreen with auto-hiding controls.
- **Intro, recap and credits skipping** from AniSkip timings, with an on/off switch under the player.
- **Next episode and auto-next keep fullscreen.** SUB/DUB servers with automatic failover.
- **Continue Watching and History**, grouped by day, Crunchyroll-style.
- **Sync:** My List and watch history follow you between Windows and Android with a username and password.
- **Small native apps:** Windows (7.5 MB, WebView2) and Android (0.2 MB).
