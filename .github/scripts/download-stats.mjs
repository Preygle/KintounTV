// Records release download counts on the `stats` branch (run by .github/workflows/download-stats.yml):
//   DOWNLOADS.md     per-release and per-platform totals
//   history.csv      cumulative totals, one row per day (today's row is updated in place)
//   badges/*.json    shields.io endpoint badges shown in the README
// Commits only when something changed. Env: GITHUB_TOKEN, REPO (owner/name).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repo = process.env.REPO;
const token = process.env.GITHUB_TOKEN;
const branch = "stats";
const dir = path.resolve("stats-worktree");

const PLATFORMS = [
  { key: "windows", name: "Windows", file: /\.exe$/i, color: "0078d6" },
  { key: "android", name: "Android", file: /\.apk$/i, color: "3ddc84" },
];

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const compact = (n) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n).toLowerCase();
const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};

async function api(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res.json();
}

// --- Count ---------------------------------------------------------------------------------------
const releases = [];
for (let page = 1; ; page++) {
  const batch = await api(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`);
  releases.push(...batch.filter((r) => !r.draft));
  if (batch.length < 100) break;
}

const zero = () => Object.fromEntries(PLATFORMS.map((p) => [p.key, 0]));
const totals = zero();
const rows = releases.map((release) => {
  const counts = zero();
  for (const asset of release.assets) {
    const platform = PLATFORMS.find((p) => p.file.test(asset.name));
    if (!platform) continue; // checksums etc.
    counts[platform.key] += asset.download_count;
    totals[platform.key] += asset.download_count;
  }
  return { tag: release.tag_name, url: release.html_url, date: (release.published_at ?? release.created_at).slice(0, 10), counts };
});
const total = Object.values(totals).reduce((a, b) => a + b, 0);
const today = new Date().toISOString().slice(0, 10);

// --- Check out the stats branch (created on the first run) ---------------------------------------
git("config", "--global", "user.name", "github-actions[bot]");
git("config", "--global", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
if (git("ls-remote", "--heads", "origin", branch)) {
  git("fetch", "--depth=1", "origin", `${branch}:refs/remotes/origin/${branch}`);
  git("worktree", "add", "--detach", dir, `origin/${branch}`);
} else {
  git("worktree", "add", "--detach", dir);
  git("-C", dir, "checkout", "--orphan", branch);
  git("-C", dir, "rm", "-rf", "--quiet", ".");
}

// --- Write ---------------------------------------------------------------------------------------
const header = `date,${PLATFORMS.map((p) => p.key).join(",")},total`;
const historyFile = path.join(dir, "history.csv");
const history = fs.existsSync(historyFile)
  ? fs.readFileSync(historyFile, "utf8").trim().split("\n").slice(1).filter((line) => line && !line.startsWith(today))
  : [];
history.push(`${today},${PLATFORMS.map((p) => totals[p.key]).join(",")},${total}`);
write("history.csv", `${header}\n${history.join("\n")}\n`);

for (const p of PLATFORMS) {
  write(`badges/${p.key}.json`, `${JSON.stringify({ schemaVersion: 1, label: `${p.name} downloads`, message: compact(totals[p.key]), color: p.color })}\n`);
}
write("badges/total.json", `${JSON.stringify({ schemaVersion: 1, label: "downloads", message: compact(total), color: "7c5cff" })}\n`);

const table = (cells) => `| ${cells.join(" | ")} |`;
const recent = history.slice(-30).reverse().map((line) => table(line.split(",")));
write(
  "DOWNLOADS.md",
  [
    "# Download stats",
    "",
    `Download counts for every [KintounTV release](https://github.com/${repo}/releases), recorded every 6 hours`,
    `by the [Download stats workflow](https://github.com/${repo}/actions/workflows/download-stats.yml). As of ${today}.`,
    "",
    "## Totals",
    "",
    table(["Platform", "Downloads"]),
    table(["---", "---:"]),
    ...PLATFORMS.map((p) => table([p.name, totals[p.key].toLocaleString("en")])),
    table(["**All**", `**${total.toLocaleString("en")}**`]),
    "",
    "## By release",
    "",
    table(["Release", "Published", ...PLATFORMS.map((p) => p.name), "Total"]),
    table(["---", "---", ...PLATFORMS.map(() => "---:"), "---:"]),
    ...rows.map((r) =>
      table([`[${r.tag}](${r.url})`, r.date, ...PLATFORMS.map((p) => r.counts[p.key].toLocaleString("en")), Object.values(r.counts).reduce((a, b) => a + b, 0).toLocaleString("en")]),
    ),
    "",
    "## Last 30 days (cumulative)",
    "",
    table(header.split(",")),
    table(header.split(",").map((_, i) => (i ? "---:" : "---"))),
    ...recent,
    "",
    "Full daily history: [history.csv](history.csv).",
    "",
  ].join("\n"),
);

// --- Commit --------------------------------------------------------------------------------------
git("-C", dir, "add", "--all");
if (!git("-C", dir, "status", "--porcelain")) {
  console.log(`No change (${total} downloads).`);
} else {
  git("-C", dir, "commit", "--quiet", "-m", `Download stats ${today}: ${total} total`);
  git("-C", dir, "push", "--quiet", "origin", `HEAD:refs/heads/${branch}`);
  console.log(`Recorded ${total} downloads (${PLATFORMS.map((p) => `${p.name} ${totals[p.key]}`).join(", ")}).`);
}
