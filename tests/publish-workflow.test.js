// PLAT-10: the npm publish on a tag runs the test suite first and publishes nothing unless it passes.
// Offline: only the repository's own workflow files are read.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import yaml from "js-yaml";
import { REPO } from "./helpers/sandbox.js";

const load = (name) => yaml.load(readFileSync(path.join(REPO, ".github", "workflows", name), "utf8"));
const publishWf = load("publish.yml");
const testWf = load("test.yml");

const testJob = publishWf.jobs.test;
const publishJob = publishWf.jobs.publish;
const needsOf = (job) => [].concat(job?.needs ?? []);
const publishIndex = (job) => (job?.steps ?? []).findIndex((s) => /\bnpm\s+publish\b/.test(s.run ?? ""));

// The command test.yml runs for the suite: its step named "Test".
const suiteCommand = testWf.jobs.test.steps.find((s) => s.name === "Test")?.run;

test("test.yml has a Test step to mirror", () => {
  assert.equal(typeof suiteCommand, "string");
});

test("PLAT-10: publish.yml has a test job", () => {
  assert.ok(testJob, "no test job");
  assert.ok(Array.isArray(testJob.steps) && testJob.steps.length > 0);
});

test("PLAT-10: the publish job needs the test job", () => {
  assert.ok(publishJob, "no publish job");
  assert.ok(needsOf(publishJob).includes("test"), `publish needs: ${JSON.stringify(publishJob.needs)}`);
});

test("PLAT-10: the test job runs the same command as test.yml, after checkout, Node 22 and a frozen install", () => {
  const steps = testJob?.steps ?? [];
  const runs = steps.map((s) => s.run);
  const at = runs.indexOf(suiteCommand);
  assert.ok(at >= 0, `test job does not run ${JSON.stringify(suiteCommand)}`);
  assert.equal(runs.filter((r) => r === suiteCommand).length, 1);
  const uses = (prefix) => steps.findIndex((s) => (s.uses ?? "").startsWith(prefix));
  assert.ok(uses("actions/checkout@") >= 0 && uses("actions/checkout@") < at, "checkout before tests");
  const node = uses("actions/setup-node@");
  assert.ok(node >= 0 && node < at, "setup-node before tests");
  assert.equal(String(steps[node].with?.["node-version"]), "22");
  const install = runs.findIndex((r) => r === "npm ci --ignore-scripts");
  assert.ok(install >= 0 && install < at, "frozen install (npm ci --ignore-scripts, as test.yml) before tests");
});

test("PLAT-10: the test job has a timeout and cannot fail open", () => {
  assert.equal(typeof testJob?.["timeout-minutes"], "number");
  assert.ok(testJob["timeout-minutes"] > 0);
  assert.equal(testJob["continue-on-error"], undefined);
  for (const s of testJob.steps) assert.equal(s["continue-on-error"], undefined, s.name ?? s.uses);
  assert.equal(testJob.if, undefined);
});

test("SECURITY: the test job has read-only permissions, no id-token, no write", () => {
  // A job without its own permissions inherits the workflow's, which include id-token: write.
  assert.deepEqual(testJob?.permissions, { contents: "read" });
});

test("SECURITY: the test job gets no secret and no token", () => {
  const text = JSON.stringify(testJob ?? null);
  assert.doesNotMatch(text, /secrets\./i);
  assert.doesNotMatch(text, /\$\{\{\s*github\.token/i);
  assert.doesNotMatch(text, /NODE_AUTH_TOKEN|NPM_TOKEN|registry-url/);
  assert.equal(testJob.env, undefined);
  for (const s of testJob.steps) assert.equal(s.env, undefined, s.name ?? s.uses);
});

test("PLAT-10: the publish step never runs ahead of the tests", () => {
  assert.equal(publishIndex(testJob), -1, "the test job must not publish");
  for (const [name, job] of Object.entries(publishWf.jobs)) {
    const at = publishIndex(job);
    if (at < 0) continue;
    assert.ok(needsOf(job).includes("test"), `${name} publishes without needing test`);
    const tests = (job.steps ?? []).findIndex((s) => s.run === suiteCommand);
    if (tests >= 0) assert.ok(tests < at, `${name}: publish step at ${at} is before the tests at ${tests}`);
  }
  assert.ok(publishIndex(publishJob) >= 0, "the publish job still publishes");
});

test("PLAT-10: the publish job keeps id-token, provenance and its publish command", () => {
  assert.equal(publishWf.permissions["id-token"], "write");
  assert.equal(publishWf.permissions.contents, "read");
  assert.equal(publishJob.steps.at(-1).run, "npm publish --access public --provenance");
});
