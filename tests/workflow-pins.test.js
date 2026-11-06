// Offline check of .github/workflows/*.yml: every `uses:` names a full 40-character commit ID and
// carries a "# v<version>" (or "# main") comment beside it, and Dependabot keeps the pins current.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../.github/", import.meta.url);
const dir = new URL("workflows/", root);
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

const USES = /^\s*(?:-\s+)?uses:\s*(\S+)\s*(?:#\s*(.*))?$/;
const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;
const VERSION_COMMENT = /^(v\d|main\b)/;

export function findUnpinned(text) {
  const bad = [];
  text.split("\n").forEach((line, i) => {
    const m = USES.exec(line);
    if (!m) return;
    if (!PINNED.test(m[1])) bad.push(`line ${i + 1}: ${m[1]} is not pinned by commit ID`);
    else if (!VERSION_COMMENT.test(m[2] ?? "")) bad.push(`line ${i + 1}: ${m[1]} has no version comment`);
  });
  return bad;
}

test("there are workflow files to check", () => {
  assert.ok(files.length > 0);
});

for (const f of files) {
  test(`${f}: every action is pinned by commit ID with a version comment`, () => {
    assert.deepEqual(findUnpinned(readFileSync(new URL(f, dir), "utf8")), []);
  });
}

test("the checker flags a tag, a branch and a missing comment", () => {
  const sha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
  assert.equal(findUnpinned("- uses: actions/checkout@v6").length, 1);
  assert.equal(findUnpinned("- uses: actions/checkout@main # main").length, 1);
  assert.equal(findUnpinned(`- uses: actions/checkout@${sha}`).length, 1);
  assert.equal(findUnpinned(`- uses: actions/checkout@${sha} # latest`).length, 1);
  assert.deepEqual(findUnpinned(`- uses: actions/checkout@${sha} # v7.0.1`), []);
});

test("dependabot.yml updates github-actions weekly", () => {
  const text = readFileSync(new URL("dependabot.yml", root), "utf8");
  const block = text.split(/^\s*-\s+package-ecosystem:/m).find((b) => /^\s*["']?github-actions["']?\s*$/m.test(b.split("\n")[0]));
  assert.ok(block, "a github-actions ecosystem entry");
  assert.match(block, /interval:\s*["']?weekly["']?/);
});
