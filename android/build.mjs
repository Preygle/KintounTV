// Build the KintounTV Android APK with the plain SDK tools (no Gradle):
// web bundle -> assets/web, aapt2 (resources + manifest), javac + d8 (code), zipalign, apksigner.
// Usage: node android/build.mjs [--debug]   (--debug: debuggable build, enables WebView DevTools over USB)
// Needs: Android SDK (platforms;android-35, build-tools;35.0.0) at %LOCALAPPDATA%\Android\Sdk or
// ANDROID_HOME, and a JDK (JAVA_HOME).
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const androidDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(androidDir);
const out = path.join(androidDir, "build");
const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, "Android", "Sdk");
const bt = path.join(sdk, "build-tools", "35.0.0");
const androidJar = path.join(sdk, "platforms", "android-35", "android.jar");
const javaHome = process.env.JAVA_HOME || "C:\\Program Files\\Java\\jdk-21";
const env = { ...process.env, JAVA_HOME: javaHome, PATH: `${path.join(javaHome, "bin")}${path.delimiter}${process.env.PATH}` };
const tool = (name) => path.join(bt, process.platform === "win32" ? (name === "d8" || name === "apksigner" ? `${name}.bat` : `${name}.exe`) : name);
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" && /\.(bat|cmd)$|^npm$/.test(cmd), ...opts });

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const versionCode = Math.floor(Date.now() / 60000) - 29_000_000; // increases with every build
const versionName = pkg.version;

function listFiles(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

console.log("> Building web bundle");
run("npm", ["run", "build"], { cwd: rootDir });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "assets"), { recursive: true });
fs.cpSync(path.join(rootDir, "dist"), path.join(out, "assets", "web"), { recursive: true });

console.log("> Resources + manifest (aapt2)");
run(tool("aapt2"), ["compile", "--dir", path.join(androidDir, "res"), "-o", path.join(out, "res.zip")]);
run(tool("aapt2"), [
  "link", "-o", path.join(out, "base.apk"), "-I", androidJar,
  "--manifest", path.join(androidDir, "AndroidManifest.xml"),
  "--min-sdk-version", "24", "--target-sdk-version", "34",
  "--version-code", String(versionCode), "--version-name", versionName,
  ...(process.argv.includes("--debug") ? ["--debug-mode"] : []),
  path.join(out, "res.zip"),
]);

console.log("> Compiling Java (javac + d8)");
const classes = path.join(out, "classes");
run(path.join(javaHome, "bin", "javac"), [
  "-source", "8", "-target", "8", "-bootclasspath", androidJar, "-Xlint:-options", "-encoding", "UTF-8",
  "-d", classes, ...listFiles(path.join(androidDir, "src"), ".java"),
]);
fs.mkdirSync(path.join(out, "dex"));
run(tool("d8"), ["--release", "--min-api", "24", "--lib", androidJar, "--output", path.join(out, "dex"), ...listFiles(classes, ".class")]);
// aapt adds the dex with the same zip layout aapt2 produced (run from the dex dir so the entry is "classes.dex").
run(tool("aapt"), ["add", path.join(out, "base.apk"), "classes.dex"], { cwd: path.join(out, "dex"), stdio: "ignore" });
// Web assets are added the same way with explicit forward-slash names: aapt2 -A on Windows writes
// backslash entry names ("assets/web\assets\x.js"), which Android's AssetManager can't find.
const webFiles = listFiles(path.join(out, "assets"), "").map((f) => path.relative(out, f).split(path.sep).join("/"));
run(tool("aapt"), ["add", path.join(out, "base.apk"), ...webFiles], { cwd: out, stdio: "ignore" });

console.log("> Align + sign");
run(tool("zipalign"), ["-p", "-f", "4", path.join(out, "base.apk"), path.join(out, "aligned.apk")]);
// One release key, created once and kept outside the repo: updates must be signed with the same key,
// so back this folder up — losing it means users have to uninstall before installing an update.
const keyDir = path.join(process.env.LOCALAPPDATA, "KintounTV", "android");
const keystore = path.join(keyDir, "kintountv-release.jks");
const passFile = path.join(keyDir, "kintountv-release.pass");
if (!fs.existsSync(keystore)) {
  fs.mkdirSync(keyDir, { recursive: true });
  fs.writeFileSync(passFile, crypto.randomBytes(18).toString("base64url"));
  const pass = fs.readFileSync(passFile, "utf8");
  run(path.join(javaHome, "bin", "keytool"), [
    "-genkeypair", "-keystore", keystore, "-storepass", pass, "-keypass", pass, "-alias", "kintountv",
    "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-dname", "CN=KintounTV",
  ], { stdio: "ignore" });
}
const apk = path.join(out, "KintounTV.apk");
// Key password = keystore password (passing the same file twice would make apksigner read line 2).
run(tool("apksigner"), ["sign", "--ks", keystore, "--ks-pass", `file:${passFile}`, "--out", apk, path.join(out, "aligned.apk")]);
run(tool("apksigner"), ["verify", apk]);
console.log(`  ${apk} (${(fs.statSync(apk).size / 1048576).toFixed(1)} MB, versionCode ${versionCode})`);
