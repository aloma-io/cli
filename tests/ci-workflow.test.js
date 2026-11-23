// ci.yml (the push/PR build) must agree with package.json: the Node it installs satisfies "engines",
// and it names its runner image like the other workflows (never ubuntu-latest).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export function minNodeMajor(range) {
  const m = /(\d+)/.exec(range);
  return m ? Number(m[1]) : NaN;
}

test("minNodeMajor reads the lowest major of an engines range", () => {
  assert.equal(minNodeMajor(">=22"), 22);
  assert.equal(minNodeMajor(">=20.10.0"), 20);
  assert.ok(Number.isNaN(minNodeMajor("")));
});

test("ci.yml: the Node version it installs satisfies package.json engines", () => {
  const versions = [...ci.matchAll(/node-version:\s*["']?(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(versions.length > 0, "ci.yml sets a node-version");
  for (const v of versions) assert.ok(v >= minNodeMajor(pkg.engines.node), `node ${v} is below engines ${pkg.engines.node}`);
});

test("ci.yml: names its runner image, never ubuntu-latest", () => {
  const runners = [...ci.matchAll(/runs-on:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(runners.length > 0);
  for (const r of runners) assert.equal(r, "ubuntu-26.04");
});
