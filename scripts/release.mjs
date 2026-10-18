// Publish a GitHub release for the version in package.json: builds KintounTV.exe and KintounTV.apk,
// writes SHA256SUMS.txt, tags v<version> and creates the release with the CHANGELOG.md section as notes.
// Usage: npm run release              (needs the GitHub CLI, signed in: gh auth login)
//        npm run release -- --draft   (create it as a draft to review before publishing)
// Asset names don't carry the version, so .../releases/latest/download/KintounTV.exe always works.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const tag = `v${version}`;
const outDir = path.join(rootDir, "release");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: rootDir, stdio: "inherit", shell: process.platform === "win32" && cmd === "npm" });
const capture = (cmd, args) => execFileSync(cmd, args, { cwd: rootDir, encoding: "utf8" }).trim();
const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

if (capture("git", ["status", "--porcelain"])) fail("commit or stash your changes first; releases are built from a clean tree.");
if (capture("git", ["tag", "--list", tag])) fail(`${tag} already exists; bump "version" in package.json.`);

// Notes: this version's CHANGELOG.md section ("## 1.2.0 — date" up to the next "## ").
const changelog = fs.readFileSync(path.join(rootDir, "CHANGELOG.md"), "utf8");
const section = changelog.split(/^## /m).find((s) => s.split(/\s/, 1)[0] === version);
if (!section) fail(`CHANGELOG.md has no "## ${version}" section.`);
const notes = `${section.slice(section.indexOf("\n") + 1).trim()}

### Install
- **Windows 10/11:** download \`KintounTV.exe\` and run it (no installer needed). If SmartScreen appears, choose *More info → Run anyway*.
- **Android 7+:** download \`KintounTV.apk\` on your phone and open it; allow installs from your browser when asked.
- Verify downloads against \`SHA256SUMS.txt\` (\`certutil -hashfile KintounTV.exe SHA256\` on Windows).
`;

run("npm", ["run", "desktop:build"]);
run("npm", ["run", "android:build"]);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir);
const built = [path.join(rootDir, "desktop", "bin", "KintounTV.exe"), path.join(rootDir, "android", "build", "KintounTV.apk")];
const assets = built.map((file) => {
  const dest = path.join(outDir, path.basename(file));
  fs.copyFileSync(file, dest);
  return dest;
});
const sums = assets.map((file) => `${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}  ${path.basename(file)}`);
fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
fs.writeFileSync(path.join(outDir, "notes.md"), notes);
console.log(`> Assets\n${sums.map((s) => `  ${s}`).join("\n")}`);

run("git", ["tag", "-a", tag, "-m", `KintounTV ${version}`]);
run("git", ["push", "origin", tag]);
run("gh", [
  "release", "create", tag, ...assets, path.join(outDir, "SHA256SUMS.txt"),
  "--verify-tag", "--title", `KintounTV ${version}`, "--notes-file", path.join(outDir, "notes.md"),
  ...(process.argv.includes("--draft") ? ["--draft"] : []),
]);
