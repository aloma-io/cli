// Where the CLI keeps its session: the per-user configuration folder chosen by src/paths.js, and the one-time
// move of a session an older version kept inside its package folder (src/utils.js). The move runs in a child
// process against a copy of src/ in a temporary package folder, with HOME and XDG_CONFIG_HOME inside temporary
// folders; nothing outside them is read or written.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { getConfigDir } from "../src/paths.js";

const REPO = path.resolve(import.meta.dirname, "..");
const mode = (p) => statSync(p).mode & 0o777;
const SESSION = JSON.stringify({ token: "legacy-token-value" });
const OTHER = JSON.stringify({ token: "per-user-token-value" });

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "aloma-session-loc-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("getConfigDir", () => {
  const saved = { xdg: process.env.XDG_CONFIG_HOME, appdata: process.env.APPDATA, home: process.env.HOME };
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const restore = (key, value) => (value === undefined ? delete process.env[key] : (process.env[key] = value));
  afterEach(() => {
    restore("XDG_CONFIG_HOME", saved.xdg);
    restore("APPDATA", saved.appdata);
    restore("HOME", saved.home);
    Object.defineProperty(process, "platform", platform);
  });
  const setPlatform = (value) => Object.defineProperty(process, "platform", { ...platform, value });
  const fallback = () => path.join(os.homedir(), ".config", "aloma");

  test("uses an absolute XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = path.join(tmp, "xdg");
    assert.equal(getConfigDir(), path.join(tmp, "xdg", "aloma"));
  });

  test("ignores a relative XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = "relative/xdg";
    delete process.env.APPDATA;
    assert.equal(getConfigDir(), fallback());
  });

  test("ignores an empty XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = "";
    delete process.env.APPDATA;
    assert.equal(getConfigDir(), fallback());
  });

  test("uses an absolute APPDATA on win32", () => {
    delete process.env.XDG_CONFIG_HOME;
    process.env.APPDATA = path.join(tmp, "appdata");
    setPlatform("win32");
    assert.equal(getConfigDir(), path.join(tmp, "appdata", "aloma"));
  });

  test("ignores a relative APPDATA on win32", () => {
    delete process.env.XDG_CONFIG_HOME;
    process.env.APPDATA = "relative/appdata";
    setPlatform("win32");
    assert.equal(getConfigDir(), fallback());
  });

  test("falls back to the home folder on win32 when APPDATA is not set", () => {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.APPDATA;
    setPlatform("win32");
    assert.equal(getConfigDir(), fallback());
  });

  test("ignores APPDATA on other platforms", () => {
    delete process.env.XDG_CONFIG_HOME;
    process.env.APPDATA = path.join(tmp, "appdata");
    for (const p of ["linux", "darwin"]) {
      setPlatform(p);
      assert.equal(getConfigDir(), fallback());
    }
  });

  test("prefers an absolute XDG_CONFIG_HOME over APPDATA on win32", () => {
    process.env.XDG_CONFIG_HOME = path.join(tmp, "xdg");
    process.env.APPDATA = path.join(tmp, "appdata");
    setPlatform("win32");
    assert.equal(getConfigDir(), path.join(tmp, "xdg", "aloma"));
  });

  test("falls back to ~/.config/aloma under the home folder", () => {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.APPDATA;
    process.env.HOME = path.join(tmp, "home");
    assert.equal(getConfigDir(), path.join(tmp, "home", ".config", "aloma"));
  });
});

describe("session in the package folder from an older version", () => {
  const CHILD = `
    import { getStoragePath } from "./src/utils.js";
    process.stdout.write(await getStoragePath());
  `;
  let pkg, cfg;
  beforeEach(() => {
    pkg = path.join(tmp, "pkg");
    cfg = path.join(tmp, "xdg", "aloma");
    mkdirSync(pkg);
    cpSync(path.join(REPO, "src"), path.join(pkg, "src"), { recursive: true });
    writeFileSync(path.join(pkg, "package.json"), readFileSync(path.join(REPO, "package.json")));
    symlinkSync(path.join(REPO, "node_modules"), path.join(pkg, "node_modules"));
  });
  const legacyFile = () => path.join(pkg, ".cache", "session.json");
  const putLegacy = (content, fileMode = 0o644) => {
    mkdirSync(path.dirname(legacyFile()));
    writeFileSync(legacyFile(), content, { mode: fileMode });
    chmodSync(legacyFile(), fileMode);
  };
  const putCurrent = (content) => {
    mkdirSync(cfg, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(cfg, "session.json"), content, { mode: 0o600 });
  };
  const run = () =>
    execFileSync(process.execPath, ["--input-type=module", "-e", CHILD], {
      cwd: pkg,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: path.join(tmp, "home"), XDG_CONFIG_HOME: path.join(tmp, "xdg") },
    });

  test("moves a valid legacy session to the per-user folder with owner-only mode", () => {
    putLegacy(SESSION);
    assert.equal(run(), cfg);
    const moved = path.join(cfg, "session.json");
    assert.equal(readFileSync(moved, "utf8"), SESSION);
    assert.equal(mode(moved), 0o600);
    assert.equal(mode(cfg), 0o700);
    assert.equal(existsSync(legacyFile()), false);
    assert.equal(existsSync(path.dirname(legacyFile())), false);
  });

  test("moves it once: a second run leaves the per-user copy as it is", () => {
    putLegacy(SESSION);
    run();
    const moved = path.join(cfg, "session.json");
    writeFileSync(moved, OTHER, { mode: 0o600 });
    run();
    assert.equal(readFileSync(moved, "utf8"), OTHER);
    assert.equal(existsSync(legacyFile()), false);
  });

  test("keeps an existing per-user session and removes the legacy copy", () => {
    putCurrent(OTHER);
    putLegacy(SESSION);
    run();
    assert.equal(readFileSync(path.join(cfg, "session.json"), "utf8"), OTHER);
    assert.equal(existsSync(legacyFile()), false);
  });

  test("removes only the session file when the legacy folder holds other files", () => {
    putLegacy(SESSION);
    writeFileSync(path.join(pkg, ".cache", "other.txt"), "x");
    run();
    assert.equal(existsSync(legacyFile()), false);
    assert.equal(existsSync(path.join(pkg, ".cache", "other.txt")), true);
    assert.equal(readFileSync(path.join(cfg, "session.json"), "utf8"), SESSION);
  });

  test("leaves a corrupt legacy file alone", () => {
    putLegacy("{not json");
    run();
    assert.equal(readFileSync(legacyFile(), "utf8"), "{not json");
    assert.equal(existsSync(path.join(cfg, "session.json")), false);
  });

  test("leaves an empty legacy file alone", () => {
    putLegacy("");
    run();
    assert.equal(existsSync(legacyFile()), true);
    assert.equal(existsSync(path.join(cfg, "session.json")), false);
  });

  test("leaves an unreadable legacy file alone", { skip: process.getuid?.() === 0 && "root reads any file" }, () => {
    putLegacy(SESSION, 0o000);
    run();
    assert.equal(existsSync(legacyFile()), true);
    assert.equal(existsSync(path.join(cfg, "session.json")), false);
  });

  test("does nothing when there is no legacy session", () => {
    assert.equal(run(), cfg);
    assert.equal(existsSync(path.join(cfg, "session.json")), false);
  });

  test("does not import a session from the current directory", () => {
    const elsewhere = path.join(tmp, "cloned");
    mkdirSync(path.join(elsewhere, ".cache"), { recursive: true });
    writeFileSync(path.join(elsewhere, ".cache", "session.json"), SESSION);
    execFileSync(process.execPath, ["--input-type=module", "-e", CHILD.replace("./src/utils.js", pkg + "/src/utils.js")], {
      cwd: elsewhere,
      env: { PATH: process.env.PATH, HOME: path.join(tmp, "home"), XDG_CONFIG_HOME: path.join(tmp, "xdg") },
    });
    assert.equal(existsSync(path.join(cfg, "session.json")), false);
    assert.equal(existsSync(path.join(elsewhere, ".cache", "session.json")), true);
  });
});
