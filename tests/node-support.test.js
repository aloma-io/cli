// PLAT-146: the supported Node versions agree across package.json engines, the test matrix, the README
// and the release note. Offline: only repository files are read.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers/sandbox.js";

const text = (...parts) => readFileSync(path.join(REPO, ...parts), "utf8");
const pkg = JSON.parse(text("package.json"));
const workflow = text(".github", "workflows", "test.yml");
const readme = text("README.md");
const changelog = existsSync(path.join(REPO, "CHANGELOG.md")) ? text("CHANGELOG.md") : "";

// The matrix line has the form: fromJSON('<pull request list>') || fromJSON('<other list>').
const matrixLine = workflow.match(
  /node-version:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*&&\s*fromJSON\('(\[[^\]]*\])'\)\s*\|\|\s*fromJSON\('(\[[^\]]*\])'\)\s*\}\}/,
);
assert.ok(matrixLine, "the node-version matrix line has the expected shape");
const PR_MATRIX = JSON.parse(matrixLine[1]);
const FULL_MATRIX = JSON.parse(matrixLine[2]);

const minimumOf = (range) => Number(range.match(/^>=\s*(\d+)(?:\.0\.0)?$/)?.[1]);
// Every "Node <n>" mention in a text, as numbers.
const nodeVersions = (s) => [...s.matchAll(/\bNode(?:\.js)?\s+v?(\d+)/gi)].map((m) => Number(m[1]));
const recommended = readme.match(/we recommend Node (\d+)/i)?.[1];

test("PLAT-146: engines.node is exactly >=22", () => {
  assert.equal(pkg.engines.node, ">=22");
});

test("PLAT-146: pull requests test on Node 26 alone", () => {
  assert.deepEqual(PR_MATRIX, ["26"]);
});

test("PLAT-146: main and manual runs test Node 22, 24 and 26", () => {
  assert.deepEqual(FULL_MATRIX, ["22", "24", "26"]);
});

test("PLAT-146: the README says Node 22 or later and recommends Node 26", () => {
  assert.match(readme, /Node 22 or later/);
  assert.match(readme, /we recommend Node 26/i);
});

test("PLAT-146: the README names no Node version below 22", () => {
  const versions = nodeVersions(readme);
  assert.ok(versions.length > 0);
  for (const v of versions) assert.ok(v >= 22, `README mentions Node ${v}`);
});

test("PLAT-146: the 0.3.0 release note explains the change and the upgrade from Node 18 and 20", () => {
  assert.equal(pkg.version, "0.3.0");
  const entry = changelog.split(/^## /m).find((s) => /^\[?0\.3\.0\]?/.test(s));
  assert.ok(entry, "a 0.3.0 section in CHANGELOG.md");
  assert.match(entry, /Node 22 or later/);
  assert.match(entry, /we recommend Node 26/i);
  assert.match(entry, /Node 18/);
  assert.match(entry, /Node 20/);
  assert.match(entry, /upgrade/i);
  assert.match(entry, /end of life|ended|end-of-life/i);
});

test("PLAT-146: engines, README and matrix agree", () => {
  const min = minimumOf(pkg.engines.node);
  assert.ok(Number.isInteger(min), "engines.node is a simple >=N range");
  assert.equal(Math.min(...FULL_MATRIX.map(Number)), min);
  assert.ok(recommended, "the README names a recommended version");
  assert.ok(FULL_MATRIX.includes(recommended), "the recommended version is in the matrix");
  assert.ok(PR_MATRIX.includes(recommended), "pull requests test the recommended version");
  assert.match(readme, new RegExp(`Node ${min} or later`));
});
