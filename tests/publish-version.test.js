// PLAT-459: the publish workflow sets the package version from the tag. Offline: the workflow file is read and
// the step's shell logic is run in a temp folder with its own package.json, never the real one.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import yaml from "js-yaml";
import { REPO } from "./helpers/sandbox.js";

const wf = yaml.load(readFileSync(path.join(REPO, ".github", "workflows", "publish.yml"), "utf8"));
const steps = wf.jobs.publish.steps;
const at = steps.findIndex((s) => /--no-git-tag-version/.test(s.run ?? ""));
const publishAt = steps.findIndex((s) => /\bnpm\s+publish\b/.test(s.run ?? ""));
const step = steps[at] ?? {};

test("PLAT-459: a step before Publish sets the version from the tag", () => {
  assert.ok(at >= 0, "no step runs npm version --no-git-tag-version");
  assert.ok(publishAt >= 0 && at < publishAt, `version step at ${at}, publish at ${publishAt}`);
  assert.match(step.run, /npm version "\$VERSION" --no-git-tag-version --allow-same-version/);
});

test("PLAT-459: the tag reaches the step through env, never interpolated into the script", () => {
  assert.equal(step.env?.TAG_NAME, "${{ github.ref_name }}");
  assert.doesNotMatch(step.run, /\$\{\{/);
  assert.match(step.run, /VERSION="\$\{TAG_NAME#v\}"/);
});

test("PLAT-459: the step never commits or pushes", () => {
  assert.doesNotMatch(step.run, /\bgit\s+(commit|push|tag|add)\b/);
});

// Runs the step's script in a temp folder whose package.json says `current`.
const run = (tag, current) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "plat459-"));
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", version: current }));
    const r = spawnSync("bash", ["-c", step.run], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, TAG_NAME: tag },
      encoding: "utf8",
    });
    const version = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
    return { status: r.status, err: r.stderr, version };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const passes = [
  ["v0.3.1", "0.3.1", "0.3.1"],
  ["0.3.1", "0.3.1", "0.3.1"],
  ["v0.3.1", "0.3.0", "0.3.1"],
  ["v1.0.0", "0.9.9", "1.0.0"],
  ["v0.10.0", "0.9.0", "0.10.0"],
];
for (const [tag, current, want] of passes) {
  test(`PLAT-459: tag ${tag} over package.json ${current} sets ${want}`, () => {
    const r = run(tag, current);
    assert.equal(r.status, 0, r.err);
    assert.equal(r.version, want);
  });
}

const lower = [
  ["v0.3.0", "0.3.1"],
  ["v0.9.0", "0.10.0"],
  ["v1.9.9", "2.0.0"],
  ["v0.3.9", "0.3.10"],
];
for (const [tag, current] of lower) {
  test(`PLAT-459: tag ${tag} below package.json ${current} fails naming both`, () => {
    const r = run(tag, current);
    assert.notEqual(r.status, 0);
    assert.ok(r.err.includes(tag.replace(/^v/, "")) && r.err.includes(current), r.err);
    assert.equal(r.version, current, "package.json untouched");
  });
}

for (const tag of ["v1.2", "v1.2.3.4", "vv1.2.3", "v1.2.x", "v1.2.3-rc1", "v1..3", "v", "V1.2.3"]) {
  test(`PLAT-459: tag ${JSON.stringify(tag)} is refused`, () => {
    const r = run(tag, "0.0.1");
    assert.notEqual(r.status, 0);
    assert.equal(r.version, "0.0.1");
  });
}
