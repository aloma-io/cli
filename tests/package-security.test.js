// Security checks over the package itself: what runs at install time (finding 8), which dependency
// versions are locked (finding 4) and that CI fails on known vulnerabilities. Offline: only the
// repository's own files are read.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import yaml from "js-yaml";
import { REPO } from "./helpers/sandbox.js";

const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(REPO, "package-lock.json"), "utf8"));
const INSTALL_HOOKS = ["preinstall", "install", "postinstall", "prepare"];

const cmp = (a, b) => {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

// SECURITY (finding 8): installing the CLI runs nothing.
test("SECURITY: the package has no install-time scripts", () => {
  for (const hook of INSTALL_HOOKS) assert.equal(pkg.scripts?.[hook], undefined, hook);
});

test("SECURITY: no production dependency in the lockfile runs an install script", () => {
  const offenders = Object.entries(lock.packages)
    .filter(([name, p]) => name && !p.dev && p.hasInstallScript)
    .map(([name]) => name);
  assert.deepEqual(offenders, []);
});

// Decision: keytar is not used (archived upstream, native build with an install script, no
// prebuilt binaries under --ignore-scripts, needs libsecret on Linux). The session is an
// owner-only file instead; see src/paths.js.
test("keytar and the unused supabase CLI are not dependencies", () => {
  assert.equal(pkg.dependencies.keytar, undefined);
  assert.equal(pkg.devDependencies?.supabase, undefined);
  assert.equal(lock.packages["node_modules/keytar"], undefined);
});

// SECURITY (finding 4): every package that had a published advisory against the locked version
// is locked at or above the first patched release.
const PATCHED = {
  axios: "1.19.1",
  "form-data": "4.0.6",
  "js-yaml": "4.3.2",
  "follow-redirects": "1.15.12",
  diff: "8.0.3",
  "http-cache-semantics": "4.2.1",
};
for (const [name, min] of Object.entries(PATCHED)) {
  test(`SECURITY: ${name} is locked at a patched version (>= ${min})`, () => {
    const entries = Object.entries(lock.packages).filter(([k]) => k === `node_modules/${name}` || k.endsWith(`/node_modules/${name}`));
    assert.ok(entries.length > 0, `${name} is in the lockfile`);
    for (const [k, p] of entries) assert.ok(cmp(p.version, min) >= 0, `${k}@${p.version} < ${min}`);
  });
}

test("SECURITY: js-yaml merge keys cannot set a prototype (GHSA-mh29-5h37-fv8m)", () => {
  const doc = yaml.load("base: &b\n  __proto__:\n    polluted: true\nx:\n  <<: *b\n");
  assert.equal(Object.getPrototypeOf(doc.x).polluted, undefined);
  assert.equal({}.polluted, undefined);
});

// SECURITY: CI fails on known vulnerabilities (npm audit) and installs without running scripts.
test("SECURITY: the test workflow runs npm audit and installs with --ignore-scripts", () => {
  const wf = yaml.load(readFileSync(path.join(REPO, ".github", "workflows", "test.yml"), "utf8"));
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.run ?? ""));
  assert.ok(steps.some((r) => /^npm audit\b/m.test(r) && !/\|\|\s*true/.test(r)), "an npm audit step that can fail the job");
  assert.ok(steps.some((r) => /npm ci --ignore-scripts/.test(r)));
});

test("SECURITY: the publish workflow audits before publishing", () => {
  const wf = yaml.load(readFileSync(path.join(REPO, ".github", "workflows", "publish.yml"), "utf8"));
  const runs = wf.jobs.publish.steps.map((s) => s.run ?? "");
  const audit = runs.findIndex((r) => /^npm audit\b/m.test(r));
  const publish = runs.findIndex((r) => /npm publish/.test(r));
  assert.ok(audit >= 0 && audit < publish, "npm audit runs before npm publish");
});
