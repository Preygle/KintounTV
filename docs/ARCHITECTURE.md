# How KintounTV works

KintounTV is one web app (`src/`) shipped three ways: as a website (`server.mjs`), as a Windows app
(`desktop/`) and as an Android app (`android/`). Each host serves the same built bundle and the same
three data endpoints, so the web code doesn't know which one it runs in:

| Endpoint | Purpose | Web | Windows | Android |
| --- | --- | --- | --- | --- |
| `/api/*` | Catalog proxy | `server.mjs` | `api.go` | `LocalServer.java` |
| `/stream/episodes\|servers\|source` | Episode and stream lookup | `stream.mjs` | `stream.go` | `LocalServer.java` |
| `/hls?u=` | Playlist and segment relay | `stream.mjs` | `stream.go` | `LocalServer.java` |

Data endpoints refuse cross-site requests (`Sec-Fetch-Site`), so other pages can't use them as a relay.

## Windows app

`desktop/main.go` embeds the built site in a ~7.5 MB native exe. It serves the site and the endpoints on
`127.0.0.1:47613` and shows them in a WebView2 window. The address is fixed, so the page origin, and
with it saved data, stays the same across launches. A second launch focuses the open window.
Fullscreen video makes the window itself borderless and monitor-sized through the
`kintounSetFullscreen` binding (`window.go`). The WebView2 profile lives in
`%LOCALAPPDATA%\KintounTV\WebView2`. Builds from before the rename used `%LOCALAPPDATA%\AniLab`, and
that profile is moved over once on first start.

## Android app

A WebView wrapper (`android/src`) built with the plain SDK tools: aapt2, javac, d8 and apksigner, no
Gradle. The site is bundled in the APK and served from `https://appassets.androidplatform.net` via
`shouldInterceptRequest`. `LocalServer.java` answers the data endpoints like the Go server does. Video
fullscreen uses `onShowCustomView`.

## Catalog API

The catalog comes from the API used by the AniLab Android app (`com.xo.anilab` 1.0.5), recovered from
its APK with [REA](https://github.com/morluto/rea). Base `https://anilab2.amdapi.click/api/`; the
proxies add the headers the app sends (`app-id`, `app-version`, `os-version`, `os-id`, see
`upstream.mjs`).

| Endpoint | Params | Response |
| --- | --- | --- |
| `GET home` | — | `{ featured, sections[{ name, posts }] }` |
| `GET categories` | — | `{ categories[{ id, name }] }` |
| `GET category` | `id`, `page` | `{ posts[{ id, poster, age }] }` |
| `GET latest` | `page` | `{ posts }` |
| `GET search` | `query`, `page` | `{ posts }` |
| `POST list` | `page`, body `{ ids }` | `{ posts }` (the page calls `GET /api/list?ids=`; the proxies convert) |
| `GET post` | `id` | detail: overview, seasons, related, similar, `playerConfig` |
| `GET config` | — | `{ messages }` (server-pushed promo dialogs, not used) |

Paging starts at 1 and ends on the first empty page. The proxy is needed because the upstream only
allows cross-origin `GET`, and the list endpoint is a `POST`.

## Streaming

The original app hands playback to a separate app, KYOTO Player (`com.kyotoplayer` 1.2.6). Its flow,
analyzed with REA, is reimplemented in `desktop/stream.go`, `stream.mjs` and `LocalServer.java`:

| Step | Request | Result |
| --- | --- | --- |
| 1 | `GET https://app.kyotoplayer.com/api/v4/post?id=<post id>` | URL templates: `episodes`, `servers`, `server{url, headers}` |
| 2 | `episodes` | `{ list[{ id, name, number, filler }] }` |
| 3 | `servers` (`%id%` = episode id) | `{ list[{ id, lang, name }] }` (SUB/DUB) |
| 4 | `server.url` (`%id%` = server id) + `Referer`/`X-Requested-With` headers | `{ link }`: an HLS master playlist |

The video CDN sends no CORS headers, so `/hls?u=` relays playlists (rewriting every URI) and the
MPEG-TS segments (served by the CDN with an `.xls` extension). Playback uses
[hls.js](https://github.com/video-dev/hls.js), loaded only on the Watch page, with the player
capping quality to its size by default.

## Intro and credits skipping

`src/skips.ts` gets timestamps from [AniSkip](https://api.aniskip.com), community data keyed by
MyAnimeList id. Titles are matched to MAL ids through AniList's search (title, year and format; cached
on the device). AniSkip is queried with the exact episode length, so timings are matched to the right
encode:

- timings from an encode within 5 seconds of ours are skipped automatically;
- timings within 20 seconds are only offered as a **Skip** button;
- anything further off is ignored.

The catalog numbers sequel seasons continuously (season 2 may start at episode 171) while AniSkip
restarts at 1, so episodes are renumbered per season. Coverage depends on AniSkip: about 40% of
currently airing titles had timings when this was written.

## Sync

`src/sync.ts` talks to Firebase through its REST APIs; there's no SDK.

- **Accounts:** Firebase email/password. A plain username maps to a fixed synthetic email address; a
  real email address also works and enables "Forgot password". Refresh tokens don't expire on a
  schedule, so each device signs in once.
- **Storage:** one Firestore document per account (`users/{uid}`; field `data` holds the JSON payload).
- **Merging:** every My List add and removal and every history entry is timestamped. For each entry the
  newest change wins; removals and "Clear history" are kept as tombstones (`mergeMyList`,
  `mergeProgress`). Thumbnails stay on the device.
- **When:** on launch, about 3 seconds after a My List change, at most once a minute while watching,
  when the app regains focus, and every 5 minutes.

### Setting up Firebase for your own build

1. In the [Firebase console](https://console.firebase.google.com), create a project.
2. **Authentication → Sign-in method:** enable **Email/Password**.
3. **Firestore Database:** create a database in production mode, then set these **Rules**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

4. **Project settings → Your apps → Web:** register an app, then put its `apiKey` and `projectId` in
   `.env.local` (see `.env.example`) and rebuild.

For local testing, `VITE_FIREBASE_AUTH_EMULATOR` and `VITE_FIREBASE_FIRESTORE_EMULATOR` point the app
at the Firebase emulators.

## Differences from the original app

- **Watch** plays in the app instead of launching KYOTO Player. It adds an episode browser (ranges,
  filter, sort), SUB/DUB servers with failover, prev/next, auto-next, resume, keyboard shortcuts and
  intro skipping. Downloads are not included.
- Server-pushed promo dialogs (`config` messages), Firebase Analytics/Crashlytics and OneSignal push
  are dropped.
- Share copies the title's link instead of the server's "download the app" text.
