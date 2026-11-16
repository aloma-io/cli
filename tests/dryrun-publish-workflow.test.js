// PLAT-140: the dry run of the npm publish path on ubuntu-26.04 can never publish. Offline: only the
// repository's own workflow files are read.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import yaml from "js-yaml";
import { REPO } from "./helpers/sandbox.js";

const WORKFLOWS = path.join(REPO, ".github", "workflows");
const PUBLISH_SHA256 = "dbe418aeb1a5b5b8f73ba4175bc3adc9ead9eaad881780f61b5d74173ee24748";

const read = (name) => readFileSync(path.join(WORKFLOWS, name));
const raw = read("dryrun-publish-ubuntu-2604.yml").toString("utf8");
const wf = yaml.load(raw);
const publish = yaml.load(read("publish.yml").toString("utf8"));
const jobs = Object.values(wf.jobs);
const steps = jobs.flatMap((job) => job.steps);
const runs = steps.map((step) => step.run).filter(Boolean);

test("DRY RUN: publish.yml is unchanged (the dry run mirrors it)", () => {
  assert.equal(createHash("sha256").update(read("publish.yml")).digest("hex"), PUBLISH_SHA256);
});

test("DRY RUN: triggers only on pull_request and workflow_dispatch", () => {
  assert.deepEqual(Object.keys(wf.on).sort(), ["pull_request", "workflow_dispatch"]);
});

test("DRY RUN: one job on exactly ubuntu-26.04, with a timeout", () => {
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]["runs-on"], "ubuntu-26.04");
  assert.equal(typeof jobs[0]["timeout-minutes"], "number");
  assert.doesNotMatch(raw, /ubuntu-latest/);
});

test("DRY RUN: permissions are contents: read only, no id-token", () => {
  assert.deepEqual(wf.permissions, { contents: "read" });
  assert.doesNotMatch(raw, /id-token/);
  for (const job of jobs) assert.equal(job.permissions, undefined);
});

test("DRY RUN: reads no credentials", () => {
  assert.doesNotMatch(raw, /\bsecrets\b/i);
  assert.doesNotMatch(raw, /NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN/);
});

test("DRY RUN: repeats publish.yml's steps in order, up to the publish step", () => {
  const release = publish.jobs.publish.steps;
  assert.deepEqual(steps.slice(0, release.length - 1), release.slice(0, -1));
  const node = steps.find((s) => s.uses?.startsWith("actions/setup-node"));
  assert.equal(node.with["node-version"], "22");
  assert.ok(runs.some((r) => r.includes("npm ci --ignore-scripts")));
  assert.ok(runs.some((r) => r.includes("npm audit --audit-level=low")));
});

test("DRY RUN: ends with npm publish --dry-run, then npm pack --dry-run", () => {
  const tail = steps.slice(-2).map((s) => s.run);
  assert.equal(tail[0].trim(), "npm publish --dry-run --access public");
  assert.equal(tail[1].trim(), "npm pack --dry-run");
});

test("DRY RUN: no provenance and no npm publish without --dry-run", () => {
  assert.doesNotMatch(raw, /--provenance/);
  const publishes = raw.split("\n").filter((line) => /npm\s+publish/.test(line) && !line.trim().startsWith("#"));
  assert.ok(publishes.length > 0);
  for (const line of publishes) assert.match(line, /--dry-run/);
});
