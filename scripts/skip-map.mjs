// Builds public/skip-map.json: MyAnimeList id -> the TV-database ids the fallback skip-time sources
// (TheIntroDB by TVDB, IntroDB by IMDb) are keyed by, with the season and episode offset of that
// MAL entry within the TV show. Source: Fribb/anime-lists (anime-list-full.json). Rerun now and then
// to pick up new shows:  node scripts/skip-map.mjs
import fs from "node:fs";

const SOURCE = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const list = await (await fetch(SOURCE)).json();
// { mal: [tvdbId, season (0 = absolute numbering), episodeOffset, imdbNumber] }
const map = {};
for (const a of list) {
  if (!a.mal_id || (!a.tvdb_id && !a.imdb_id?.length)) continue;
  const season = a.season?.tvdb > 0 ? a.season.tvdb : 0;
  const imdb = Number(String(a.imdb_id?.[0] ?? "").replace(/^tt/, "")) || 0;
  map[a.mal_id] = [a.tvdb_id ?? 0, season, a.episode_offset ?? 0, imdb];
}
fs.writeFileSync(new URL("../public/skip-map.json", import.meta.url), JSON.stringify(map));
console.log(`${Object.keys(map).length} titles -> public/skip-map.json`);
