// Regression: moving an old-style session file (<package folder>/.cache/session.json) into the per-user folder.
// The code looks only in the running package's own folder, so each case copies src/ and package.json into a
// fresh temporary package folder and runs the copied module in a child process, with the per-user folder in a
// second temporary folder (XDG_CONFIG_HOME). Nothing outside those two folders is written; both are removed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const OLD = '{"token":"not-a-token"}';
const NEWER = '{"token":"newer-not-a-token"}';
const CHILD = `
  import { getStoragePath } from "./src/utils.js";
  process.stdout.write(await getStoragePath());
`;

// Runs `body({ pkg, cfg, legacy, run })` with a fresh package folder and per-user folder, then removes both.
async function withTrees(body) {
  const pkg = mkdtempSync(path.join(os.tmpdir(), "aloma-legacy-pkg-"));
  const base = mkdtempSync(path.join(os.tmpdir(), "aloma-legacy-cfg-"));
  try {
    cpSync(path.join(REPO, "src"), path.join(pkg, "src"), { recursive: true });
    writeFileSync(path.join(pkg, "package.json"), readFileSync(path.join(REPO, "package.json")));
    symlinkSync(path.join(REPO, "node_modules"), path.join(pkg, "node_modules"));
    const cfg = path.join(base, "aloma");
    const legacy = path.join(pkg, ".cache", "session.json");
    const run = (cwd = pkg, script = CHILD) =>
      spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: path.join(base, "home"), XDG_CONFIG_HOME: base },
      });
    await body({ pkg, cfg, legacy, run });
  } finally {
    rmSync(pkg, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  }
}
const putLegacy = (file, content) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};
// The child succeeded, reported the per-user folder, and printed none of the given texts.
const quiet = (r, cfg, ...texts) => {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, cfg);
  for (const t of texts) assert.equal((r.stdout + r.stderr).includes(t), false);
};

describe("moving an old-style session file into the per-user folder", () => {
  test("moves a valid file once, owner-only, and removes the old file and its empty folder", () =>
    withTrees(({ cfg, legacy, run }) => {
      putLegacy(legacy, OLD);
      quiet(run(), cfg, "not-a-token");
      const moved = path.join(cfg, "session.json");
      assert.equal(readFileSync(moved, "utf8"), OLD);
      if (process.platform !== "win32") assert.equal(statSync(moved).mode & 0o777, 0o600);
      assert.equal(existsSync(legacy), false);
      assert.equal(existsSync(path.dirname(legacy)), false);
    }));

  test("leaves an existing per-user session as it was and still removes the old file", () =>
    withTrees(({ cfg, legacy, run }) => {
      mkdirSync(cfg, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(cfg, "session.json"), NEWER, { mode: 0o600 });
      putLegacy(legacy, OLD);
      quiet(run(), cfg);
      assert.equal(readFileSync(path.join(cfg, "session.json"), "utf8"), NEWER);
      assert.equal(existsSync(legacy), false);
    }));

  test("leaves a corrupt old file alone, imports nothing and prints nothing from it", () =>
    withTrees(({ cfg, legacy, run }) => {
      putLegacy(legacy, "not json, not-a-token");
      quiet(run(), cfg, "not-a-token");
      assert.equal(readFileSync(legacy, "utf8"), "not json, not-a-token");
      assert.equal(existsSync(path.join(cfg, "session.json")), false);
    }));

  test("leaves an unreadable old file (a folder in its place) alone and imports nothing", () =>
    withTrees(({ cfg, legacy, run }) => {
      putLegacy(path.join(legacy, "inner.txt"), "not-a-token");
      quiet(run(), cfg, "not-a-token");
      assert.equal(statSync(legacy).isDirectory(), true);
      assert.equal(existsSync(path.join(legacy, "inner.txt")), true);
      assert.equal(existsSync(path.join(cfg, "session.json")), false);
    }));

  test("removes only the old session file when its folder holds another file", () =>
    withTrees(({ cfg, legacy, run }) => {
      putLegacy(legacy, OLD);
      writeFileSync(path.join(path.dirname(legacy), "other.txt"), "other");
      quiet(run(), cfg);
      assert.equal(existsSync(legacy), false);
      assert.deepEqual(readdirSync(path.dirname(legacy)), ["other.txt"]);
      assert.equal(readFileSync(path.join(cfg, "session.json"), "utf8"), OLD);
    }));

  test("never imports a session file from the current working directory", () =>
    withTrees(({ pkg, cfg, run }) => {
      const elsewhere = mkdtempSync(path.join(os.tmpdir(), "aloma-legacy-cwd-"));
      try {
        const there = path.join(elsewhere, ".cache", "session.json");
        putLegacy(there, OLD);
        const script = CHILD.replace("./src/utils.js", path.join(pkg, "src", "utils.js"));
        quiet(run(elsewhere, script), cfg);
        assert.equal(existsSync(path.join(cfg, "session.json")), false);
        assert.equal(readFileSync(there, "utf8"), OLD);
      } finally {
        rmSync(elsewhere, { recursive: true, force: true });
      }
    }));
});
