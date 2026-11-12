// PLAT-145: the test workflow spends few Actions minutes on pull requests and still runs every
// release check. Offline: only the workflow files are read.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { load as parseYaml, CORE_SCHEMA } from "js-yaml";
import { REPO } from "./helpers/sandbox.js";

const read = (name) => readFileSync(path.join(REPO, ".github", "workflows", name));
const wf = parseYaml(read("test.yml").toString("utf8"), { schema: CORE_SCHEMA });
const jobs = Object.values(wf.jobs);
const FULL = ["22", "24", "26"];
// publish.yml is out of scope for PLAT-145; change this hash only with a deliberate publish change.
// Re-pinned for PLAT-10's publish gate (#22: test job before publish), merged alongside #19 without this update.
// Re-pinned for PLAT-149: the actions in publish.yml are named by commit ID with a version comment.
// Re-pinned for PLAT-140: publish runs-on is named ubuntu-26.04, never ubuntu-latest.
// Re-pinned for PLAT-459: publish sets the package version from the tag.
const PUBLISH_SHA256 = "db4c21cb7197bbeaa691800f220c6ad1dfe4a4c001354b10cfafad1b35d47f6d";

// Evaluates the only expression shapes the workflow may use, for one event name.
const evaluate = (value, event) => {
  if (typeof value !== "string") return value;
  const m = value.match(/^\$\{\{\s*github\.event_name\s*==\s*'(\w+)'\s*(?:&&\s*fromJSON\('(.*?)'\)\s*\|\|\s*fromJSON\('(.*?)'\))?\s*\}\}$/);
  assert.ok(m, `unsupported expression: ${value}`);
  const [, name, yes, no] = m;
  if (yes === undefined) return event === name;
  return JSON.parse(event === name ? yes : no);
};
const matrixFor = (job, event) => evaluate(job.strategy.matrix["node-version"], event).map(String);

test("PLAT-145: pull requests test on one Node version only (26, PLAT-146)", () => {
  for (const job of jobs) assert.deepEqual(matrixFor(job, "pull_request"), ["26"]);
});

test("PLAT-145: push to main and workflow_dispatch run the full 22/24/26 matrix (PLAT-146)", () => {
  assert.deepEqual(wf.on.push.branches, ["main"]);
  for (const job of jobs) {
    assert.deepEqual(matrixFor(job, "push"), FULL);
    assert.deepEqual(matrixFor(job, "workflow_dispatch"), FULL);
  }
});

test("PLAT-145: a workflow_dispatch trigger exists", () => {
  assert.ok("workflow_dispatch" in wf.on);
});

test("PLAT-145: cancel-in-progress is true for pull requests and false for pushes to main", () => {
  const cancel = wf.concurrency["cancel-in-progress"];
  assert.equal(evaluate(cancel, "pull_request"), true);
  assert.equal(evaluate(cancel, "push"), false);
  assert.equal(evaluate(cancel, "workflow_dispatch"), false);
});

test("PLAT-145: setup-node uses the npm cache", () => {
  for (const job of jobs) {
    const setup = job.steps.filter((s) => /^actions\/setup-node@/.test(s.uses ?? ""));
    assert.ok(setup.length > 0, "a setup-node step");
    for (const s of setup) {
      const w = s.with ?? {};
      assert.ok(w.cache === "npm" || w["package-manager-cache"] === true, "cache: npm or package-manager-cache on");
    }
  }
});

test("PLAT-145: only documentation changes are ignored", () => {
  for (const trigger of ["pull_request", "push"]) {
    assert.deepEqual(wf.on[trigger]["paths-ignore"], ["**/*.md", "docs/**"], trigger);
    assert.equal(wf.on[trigger].paths, undefined, trigger);
  }
});

test("PLAT-145: every job has a timeout of at most 15 minutes", () => {
  assert.ok(jobs.length > 0);
  for (const job of jobs) {
    assert.equal(typeof job["timeout-minutes"], "number");
    assert.ok(job["timeout-minutes"] > 0 && job["timeout-minutes"] <= 15);
  }
});

test("PLAT-145: npm audit and npm test run in every matrix leg, unconditionally", () => {
  for (const job of jobs) {
    assert.equal(job.if, undefined);
    const runs = job.steps.map((s) => s.run ?? "");
    for (const re of [/^npm audit --audit-level=low$/m, /^npm test$/m]) {
      const step = job.steps.find((s) => re.test(s.run ?? ""));
      assert.ok(step, `a step running ${re}`);
      assert.equal(step.if, undefined);
      assert.equal(step["continue-on-error"], undefined);
      assert.ok(!/\|\|/.test(step.run));
    }
    assert.ok(runs.some((r) => /npm ci/.test(r)));
  }
});

test("PLAT-145: publish.yml is unchanged", () => {
  assert.equal(createHash("sha256").update(read("publish.yml")).digest("hex"), PUBLISH_SHA256);
});
