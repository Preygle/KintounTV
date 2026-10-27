# Changelog

All notable changes to KintounTV. Versions follow [Semantic Versioning](https://semver.org);
`npm run release` publishes the section matching the version in `package.json`.

## 1.5.3 — 2026-10-27

- **Screen changes from 1.5.0 undone** (they made fullscreen flicker worse on some monitors):
  fullscreen works exactly as in 1.4.7 again, and the app fullscreen button / F11, flicker-safe
  mode, remembered window position, WebView zoom/shortcut/status-bar changes, back/forward mouse
  buttons and the wide-screen layout are gone. Media keys, 5-second skips and the A / D speed keys
  stay.

## 1.5.2 — 2026-10-26

- **Speed keys:** A and D make playback slower or faster in 0.1× steps (0.5× to 3×); the new speed
  shows briefly and is remembered.

## 1.5.1 — 2026-10-25

- **5-second skips:** the back/forward buttons, ← / → (J / L), double taps on phones and media keys
  now move 5 seconds instead of 10.

## 1.5.0 — 2026-10-25

A proper Windows app.

- **App fullscreen:** F11 or the new header button makes the whole app fullscreen, and it's
  remembered next time. The player's fullscreen works inside it; Esc or F11 leaves.
- **Flicker-safe fullscreen** (on by default; Account → App): fullscreen no longer switches
  FreeSync / G-Sync monitors into game mode, which made some of them flicker. It leaves a
  one-pixel line at the bottom of the screen; turn it off for an exact fullscreen.
- **Remembers the window:** size, position and maximized state come back on the next start.
- **Feels like an app, not a web page:** no link address popping up in a corner, no page zoom
  (Ctrl + wheel, Ctrl +/−, pinch), no browser shortcuts (Ctrl+P, Ctrl+F, F5), and a dark window from
  the first frame instead of a white flash. Alt+←/→ and the mouse's back/forward buttons navigate.
- **Media controls:** the episode shows in Windows' media controls and keyboard media keys work
  (play/pause, next/previous episode); on Android, in the media notification.
- **Big screens:** pages use the full width up to 2400 px, posters scale with the window (more per
  row on wide screens) and the player fills the screen's height on the watch page.

## 1.4.7 — 2026-10-25

- **Timeline previews that keep up:** a grid of frames across the episode loads in the background a
  few seconds in, and dragging shows the nearest frame instead of waiting for the exact one (before,
  a quick drag showed no new frames at all).
- **Smoother seek bar:** dragging updates at most once per frame, a quick tap on the bar always
  seeks, and the bar can't get stuck mid-drag. On phones the bar is taller to grab and the handle
  is bigger and always visible.
- **Outros auto-skip too:** with Auto-skip on, credits of up to 4 minutes skip by themselves from any
  source (with Undo), not only timings confirmed for your exact video.

## 1.4.6 — 2026-10-22

- **Auto-skip covers more intros:** with Auto-skip intro on, intros and recaps now skip by
  themselves whichever database the timing came from (up to 3 minutes long), not only timings
  confirmed for your exact video. Each automatic skip shows "Skipped intro · Undo" for a few
  seconds; Undo goes back and lets it play. Credits still skip automatically only when confirmed,
  since scenes sometimes follow them.

## 1.4.5 — 2026-10-22

- **Phone player:** tapping the video no longer makes the controls open, close and open again.
- **Skip buttons respond on the first tap**, even while the controls are hidden (the button used to
  jump up under your finger as the controls came back).
- **Skips stick:** if the stream jumps back right after a skip (it can while an episode is starting),
  the player skips again, and "Skipped intro" only shows once the skip has really happened.

## 1.4.4 — 2026-10-22

- **Update checks work on shared networks:** GitHub's API allows only 60 checks an hour per network
  address, which campus and office networks use up. When it refuses, the app now reads the latest
  version from GitHub's release page instead (and the notes from the changelog).

## 1.4.3 — 2026-10-22

- **Smoother touch controls:** only real taps count — swipes, long presses, two-finger touches and
  two taps far apart no longer skip 10 seconds or pause by accident; after a double-tap skip, a
  tap a moment later just shows the controls instead of skipping again; a double tap never toggles
  fullscreen on a phone.
- The play button's icon is centred in its circle.
- On phones the server buttons sit side by side in one row you can swipe, instead of stacking.

## 1.4.2 — 2026-10-20

- **Update from inside the app:** KintounTV checks GitHub for a new release and shows "Update now".
  Windows downloads the new version, checks it against the release's SHA-256 checksums, swaps it in
  and restarts; Android downloads and checks the APK and opens Android's installer to confirm. The
  version and a "Check for updates" button are on the Account page. (This version still has to be
  installed by hand; later ones can be updated in the app.)
- **More intro, recap and credits timings:** when AniSkip has none for an episode, TheIntroDB and
  IntroDB fill in. In a sample of 146 titles, episodes with skip times went from about 40% to 60%
  (per show). Their times come from other releases, so they show a Skip button, and skip
  automatically only when both databases agree.

## 1.4.1 — 2026-10-20

- **Fast sync** (on by default; switch it on the Account page, it applies to every device on the
  account): when you switch devices, the other one picks up within about 30 seconds of where you
  stopped. Watch progress uploads every 15 seconds and as soon as you leave the app; opening the app
  pulls straight away, and open devices check every 15 seconds. With it off, sync works as before
  (every minute while watching, other devices checked every 5 minutes).

## 1.4.0 — 2026-10-20

- **Downloads:** save one episode, a few, or a whole season (SUB or DUB, up to 1080p) from a title or
  the player, and watch them without a connection. The new **Downloads** page shows progress and lets
  you pause, resume, retry and delete. Downloads survive restarts and pick up where they stopped; on
  Android they keep going in the background with a progress notification. A downloaded episode plays
  from the device automatically; pick a server under the player to stream instead.
- **Touch controls:** tap the middle of the video to play or pause; double-tap the left or right side to
  go back or forward 10 seconds (each further tap adds 10 more); a single tap at the sides shows or
  hides the controls.
- **Timeline previews:** hover over the seek bar (Windows) or drag it (Android) to see the frame at
  that point, Netflix-style. Streams or devices that can't make previews show the time as before.
- The Android app icon no longer sits on a white plate (adaptive icon on charcoal).
- The header shows icon-only navigation on mid-sized windows, so it always fits.

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
