// Package contents: `npm pack --dry-run --json` lists what would be published. The package holds
// src/ and no test, findings or mutation-result files. Offline: nothing is downloaded or published.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers/sandbox.js";

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function packedPaths(cwd) {
  const r = spawnSync(NPM, ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd, encoding: "utf8", maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr);
  const [info] = JSON.parse(r.stdout);
  return info.files.map((f) => f.path);
}

// What in a list of packaged paths does not belong there.
function unexpected(paths) {
  return paths.filter((p) => p.startsWith("tests/") || /(^|\/)(FINDINGS|MUTATION)[^/]*$/i.test(p));
}

test("the package contains src/", () => {
  const paths = packedPaths(REPO);
  assert.ok(paths.some((p) => p.startsWith("src/")), "no path under src/");
  assert.ok(paths.includes("src/cli.js"));
  assert.ok(paths.includes("package.json"));
});

test("the package contains nothing under tests/ and no FINDINGS or MUTATION file", () => {
  assert.deepEqual(unexpected(packedPaths(REPO)), []);
});

test("the check notices tests/ added to the files list", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pkg-files-"));
  try {
    const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
    pkg.files = [...pkg.files, "tests/"];
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
    cpSync(path.join(REPO, "src"), path.join(dir, "src"), { recursive: true });
    cpSync(path.join(REPO, "tests", "package-files.test.js"), path.join(dir, "tests", "package-files.test.js"));
    writeFileSync(path.join(dir, "tests", "FINDINGS-x.md"), "x\n");
    const found = unexpected(packedPaths(dir));
    assert.ok(found.includes("tests/package-files.test.js"), found.join(","));
    assert.ok(found.includes("tests/FINDINGS-x.md"), found.join(","));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
