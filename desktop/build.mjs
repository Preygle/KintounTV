// Build the KintounTV desktop app: web bundle -> embedded assets -> Windows resources -> KintounTV.exe.
// Usage: node desktop/build.mjs [--install]
//   --install  copy KintounTV.exe to %LOCALAPPDATA%\Programs\KintounTV and create a Desktop shortcut.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = "KintounTV";
const LEGACY = "AniLab"; // name of builds released before the rename

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(desktopDir);
const webDir = path.join(desktopDir, "web");
const exePath = path.join(desktopDir, "bin", `${APP}.exe`);
const run = (cmd, args, cwd, env) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" && cmd === "npm", env: { ...process.env, ...env } });

console.log("> Building web bundle");
run("npm", ["run", "build"], rootDir);

console.log("> Embedding dist/ into desktop/web");
fs.rmSync(webDir, { recursive: true, force: true });
fs.cpSync(path.join(rootDir, "dist"), webDir, { recursive: true });

console.log("> Generating Windows resources (icon, manifest, version)");
// The version comes from package.json, like the APK's, so a release bumps it in one place.
const { version } = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const quad = `${version.split("-")[0]}.0`;
const res = JSON.parse(fs.readFileSync(path.join(desktopDir, "winres", "winres.json"), "utf8"));
res.RT_MANIFEST["#1"]["0409"].identity.version = quad;
const ver = res.RT_VERSION["#1"]["0000"];
Object.assign(ver.fixed, { file_version: quad, product_version: quad });
Object.assign(ver.info["0409"], { FileVersion: version, ProductVersion: version });
fs.writeFileSync(path.join(desktopDir, "winres", "winres.gen.json"), JSON.stringify(res, null, 2));
run("go", ["run", "github.com/tc-hib/go-winres@v0.3.3", "make", "--in", "winres/winres.gen.json", "--arch", "amd64"], desktopDir);

console.log(`> Compiling ${APP}.exe`);
run("go", ["build", "-trimpath", "-ldflags", "-s -w -H windowsgui", "-o", exePath, "."], desktopDir, { CGO_ENABLED: "0", GOOS: "windows", GOARCH: "amd64" });
console.log(`  ${exePath} (${(fs.statSync(exePath).size / 1048576).toFixed(1)} MB)`);

if (process.argv.includes("--install")) {
  const installDir = path.join(process.env.LOCALAPPDATA, "Programs", APP);
  const installedExe = path.join(installDir, `${APP}.exe`);
  console.log(`> Installing to ${installDir}`);
  fs.mkdirSync(installDir, { recursive: true });
  fs.copyFileSync(exePath, installedExe);

  console.log("> Creating Desktop shortcut (and removing the pre-rename one)");
  const ps = [
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop '${APP}.lnk'))`,
    `$s.TargetPath = '${installedExe}'`,
    `$s.WorkingDirectory = '${installDir}'`,
    `$s.IconLocation = '${installedExe},0'`,
    `$s.Description = '${APP}'`,
    "$s.Save()",
    `Remove-Item -LiteralPath (Join-Path $desktop '${LEGACY}.lnk') -ErrorAction SilentlyContinue`,
    `Join-Path $desktop '${APP}.lnk'`,
  ].join("; ");
  run("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], desktopDir);

  // The old executable goes; its WebView2 profile is moved by the new app on first start (main.go).
  const legacyDir = path.join(process.env.LOCALAPPDATA, "Programs", LEGACY);
  try {
    fs.rmSync(legacyDir, { recursive: true, force: true });
  } catch {
    console.log(`  (could not remove ${legacyDir} — is the old app still open?)`);
  }
}
