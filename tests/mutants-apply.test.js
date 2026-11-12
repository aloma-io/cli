// Offline check: every deliberate break in the two mutation lists must still apply to the current source
// (PLAT-464). Runs each runner with --check-apply (no file written, no test run) and fails, naming the
// runner and the lines it printed, when it exits non-zero.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const RUNNERS = ["tests/helpers/run-mutations.mjs", "tests/helpers/run-security-mutations.mjs"];
const root = new URL("../", import.meta.url);

// One hash over every file a break can name: --check-apply must leave all of them as they were.
function treeHash() {
  const h = createHash("sha256");
  const walk = (rel) => {
    const url = new URL(rel, root);
    let entries;
    try {
      entries = readdirSync(url, { withFileTypes: true });
    } catch {
      h.update(rel).update(readFileSync(url));
      return;
    }
    for (const e of entries) walk(`${rel}/${e.name}`);
  };
  for (const rel of ["src", ".github", "package.json", "package-lock.json"]) walk(rel);
  return h.digest("hex");
}

const run = (runner, ...args) => {
  const r = spawnSync(process.execPath, [runner, "--check-apply", ...args], { cwd: root, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

for (const runner of RUNNERS) {
  test(`every deliberate break in ${runner} still applies`, () => {
    const before = treeHash();
    const r = run(runner);
    assert.match(r.out, /^checked [1-9]\d* mutants, 0 do not apply$/m, `${runner} reports breaks that do not apply or did not run --check-apply:\n${r.out}`);
    assert.equal(r.status, 0, `${runner} --check-apply exited ${r.status}:\n${r.out}`);
    assert.equal(treeHash(), before, `${runner} --check-apply changed a file`);
  });

  test(`${runner} --check-apply fails when it checks no mutants`, () => {
    const r = run(runner, "NO-SUCH-ID");
    assert.match(r.out, /^checked 0 mutants, 0 do not apply$/m, r.out);
    assert.notEqual(r.status, 0, `${runner} exited 0 after checking 0 mutants`);
  });
}
