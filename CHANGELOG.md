# Changelog

All notable changes to KintounTV. Versions follow [Semantic Versioning](https://semver.org);
`npm run release` publishes the section matching the version in `package.json`.

## 1.4.0 — 2026-10-20

- **Timeline previews:** hover over the seek bar (Windows) or drag it (Android) to see the frame at
  that point, Netflix-style. Frames come from the stream's own keyframe index, about 30 KB each, and
  are kept for the episode so going back over the bar is instant. Streams or devices that can't make
  previews show the time as before.

## 1.3.0 — 2026-10-19

- **Categories, rebuilt:** all 74 categories in groups (Genres, Worlds & settings, Powers, danger &
  crime, Love & relationships, Everyday life, Sports & the arts, Adult), each with a one-line
  explanation and the poster of a title that represents it.
- **Combine categories:** pick several and match **any** (OR) or **all** (AND) of them. AND reads
  every selected category in full, so it finds every title they share; results are ranked by the
  catalog's ratings and the selection is kept in the link.
- Duplicate categories in the catalog (Comedy, Supernatural, Suspense) now show once.

## 1.2.1 — 2026-10-19

- **New logo:** the KintounTV cloud wordmark in the header and README, and the cloud as the app icon
  (Windows, Android) and favicon.

## 1.2.0 — 2026-10-19

A full redesign.

- **New look:** charcoal with orange-gold accents, the Inter typeface, and consistent cards, buttons,
  focus rings, loading placeholders and fallbacks for missing artwork.
- **Header:** icon navigation, a single search field (Ctrl + K), notifications and your profile.
- **Home:** a featured carousel with wide artwork, Continue Watching as 16:9 cards (time left,
  progress, episode and percentage), and Trending with genre filters.
- **Every poster** now shows its title, rating, format and episode count.
- **Notifications:** new episodes of airing shows in My List or Continue Watching.
- **Pages:** Search with genre and year filters, Categories as a genre picker, release seasons on
  Latest, and My List with format, status and sort filters and quick remove.

## 1.1.1 — 2026-10-19

- **Watch order:** later TV series filed as "side stories" of a finished series now continue the
  main line. Dragon Ball reads DB → Z → GT → Super → Broly → Super Hero → Daima. Spin-offs
  (Attack on Titan: Junior High, Detective Conan: Zero's Tea Time) stay as extras.

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
