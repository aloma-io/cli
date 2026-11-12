// Offline check: every deliberate break in the two mutation lists must still apply to the current source
// (PLAT-464). Runs each runner with --check-apply (no file written, no test run) and fails, naming the
// runner and the lines it printed, when it exits non-zero. It also shows the check fails when an entry does not
// apply: each failure mode runs against a temp copy of just the files the entries name (--root), never the real tree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyBreak, parseArgs, selectIds } from "./helpers/apply-check.mjs";

const RUNNERS = ["tests/helpers/run-mutations.mjs", "tests/helpers/run-security-mutations.mjs"];
const root = new URL("../", import.meta.url);

// One hash over src/, .github, package.json, package-lock.json and every file in the file column of both lists:
// --check-apply must leave all of them as they were.
function treeHash(extraFiles) {
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
  for (const rel of new Set(["src", ".github", "package.json", "package-lock.json", ...extraFiles])) walk(rel);
  return h.digest("hex");
}

const run = (runner, ...args) => {
  const r = spawnSync(process.execPath, [runner, "--check-apply", ...args], { cwd: root, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

// The runner's own list: --check-apply --list prints [{ id, file, find }] and exits 0 (nothing is checked).
const listOf = (runner) => JSON.parse(run(runner, "--list").out);
const filesOf = (runner) => listOf(runner).map((e) => e.file);

// A temp copy of just the files the entries name; mutate(dir) changes it before the runner looks at it.
function withCopy(entries, mutate, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "mutants-apply-"));
  try {
    for (const file of new Set(entries.map((e) => e.file))) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), readFileSync(new URL(file, root)));
    }
    mutate(dir);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// An entry whose old text overlaps no other entry's old text in the same file, so changing it breaks only it.
function loneEntry(entries) {
  const spans = (e) => {
    const text = readFileSync(new URL(e.file, root), "utf8");
    const out = [];
    for (let i = text.indexOf(e.find); i !== -1; i = text.indexOf(e.find, i + 1)) out.push([i, i + e.find.length]);
    return out;
  };
  const found = entries.find((e) => {
    const mine = spans(e);
    return entries.every((o) => o === e || o.file !== e.file || !spans(o).some(([a, b]) => mine.some(([c, d]) => a < d && c < b)));
  });
  assert.ok(found, "no entry is independent of the others in its file");
  return found;
}

const edit = (dir, file, fn) => {
  const abs = path.join(dir, file);
  writeFileSync(abs, fn(readFileSync(abs, "utf8")));
};
const changeOneChar = (find) => `${find[0] === "~" ? "^" : "~"}${find.slice(1)}`;
const lines = (out) => out.trimEnd().split("\n");
const lastLine = (out) => lines(out).at(-1);

for (const runner of RUNNERS) {
  test(`every deliberate break in ${runner} still applies`, () => {
    const before = treeHash(filesOf(runner));
    const r = run(runner);
    assert.match(r.out, /^checked [1-9]\d* mutants, 0 do not apply$/m, `${runner} reports breaks that do not apply or did not run --check-apply:\n${r.out}`);
    assert.equal(r.status, 0, `${runner} --check-apply exited ${r.status}:\n${r.out}`);
    assert.equal(treeHash(filesOf(runner)), before, `${runner} --check-apply changed a file`);
  });

  test(`${runner} --check-apply fails when it checks no mutants`, () => {
    const r = run(runner, "NO-SUCH-ID");
    assert.match(r.out, /^checked 0 mutants, 0 do not apply$/m, r.out);
    assert.notEqual(r.status, 0, `${runner} exited 0 after checking 0 mutants`);
  });

  test(`${runner} --check-apply on an unaltered temp copy passes`, () => {
    const entries = listOf(runner);
    withCopy(entries, () => {}, (dir) => {
      const r = run(runner, "--root", dir);
      assert.equal(lastLine(r.out), `checked ${entries.length} mutants, 0 do not apply`, r.out);
      assert.equal(r.status, 0, r.out);
    });
  });

  // One entry's old text is changed by one character, deleted, or present twice: that entry, and only it, is
  // reported as not applying, and the check exits 1.
  const failures = {
    "old text changed by one character (stale)": (e) => (dir) => edit(dir, e.file, (t) => t.replace(e.find, changeOneChar(e.find))),
    "old text deleted (zero matches)": (e) => (dir) => edit(dir, e.file, (t) => t.replace(e.find, "")),
    "old text present twice (two matches)": (e) => (dir) => edit(dir, e.file, (t) => `${t}\n${e.find}\n`),
  };
  for (const [what, mutate] of Object.entries(failures)) {
    test(`${runner} --check-apply fails when an entry's ${what}`, () => {
      const entries = listOf(runner);
      const e = loneEntry(entries);
      withCopy(entries, mutate(e), (dir) => {
        const r = run(runner, "--root", dir);
        assert.ok(lines(r.out).includes(`${e.id} does not apply to ${e.file}`), r.out);
        assert.equal(lines(r.out).filter((l) => l.includes("does not apply to")).length, 1, r.out);
        assert.equal(lastLine(r.out), `checked ${entries.length} mutants, 1 do not apply`, r.out);
        assert.equal(r.status, 1, r.out);
      });
    });
  }

  test(`${runner} --check-apply fails for every entry whose target file is missing`, () => {
    const entries = listOf(runner);
    const e = entries[0];
    const hit = entries.filter((o) => o.file === e.file);
    withCopy(entries, (dir) => rmSync(path.join(dir, e.file)), (dir) => {
      const r = run(runner, "--root", dir);
      for (const o of hit) assert.ok(lines(r.out).includes(`${o.id} does not apply to ${o.file}`), r.out);
      assert.equal(lastLine(r.out), `checked ${entries.length} mutants, ${hit.length} do not apply`, r.out);
      assert.equal(r.status, 1, r.out);
    });
  });

  test(`${runner} --check-apply takes the root from the REPO variable`, () => {
    const entries = listOf(runner);
    const e = loneEntry(entries);
    withCopy(entries, (dir) => edit(dir, e.file, (t) => t.replace(e.find, "")), (dir) => {
      const r = spawnSync(process.execPath, [runner, "--check-apply"], { cwd: root, encoding: "utf8", env: { REPO: dir } });
      assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
      assert.ok(lines(r.stdout).includes(`${e.id} does not apply to ${e.file}`), r.stdout);
    });
  });

  test(`${runner} --check-apply lists an unknown id and exits 1`, () => {
    const r = run(runner, listOf(runner)[0].id, "M3O");
    assert.ok(lines(r.out).includes("unknown id M3O"), r.out);
    assert.equal(lastLine(r.out), "checked 1 mutants, 0 do not apply", r.out);
    assert.equal(r.status, 1, r.out);
  });
}

test("the security runner's normal run reports a break that does not apply and writes nothing", () => {
  const runner = RUNNERS[1];
  const entries = listOf(runner);
  const e = loneEntry(entries);
  withCopy(entries, (dir) => edit(dir, e.file, (t) => t.replace(e.find, "")), (dir) => {
    const before = readFileSync(path.join(dir, e.file), "utf8");
    const r = spawnSync(process.execPath, [runner, e.id, "--md", "--root", dir], { cwd: root, encoding: "utf8" });
    const out = `${r.stdout}${r.stderr}`;
    assert.match(out, /NOT APPLIED \(0 matches\)/, out);
    assert.match(out, /0 of 1 mutants killed/, out);
    assert.equal(r.status, 1, out);
    assert.equal(readFileSync(path.join(dir, e.file), "utf8"), before, "the file was written");
  });
});

test("applyBreak changes the text only when the old text is there exactly once", () => {
  assert.equal(applyBreak("a-b", "-", "+"), "a+b");
  assert.equal(applyBreak("a-b-c", "-", "+"), null);
  assert.equal(applyBreak("abc", "-", "+"), null);
  assert.equal(applyBreak("a-b", "-", "$&"), "a$&b");
});

test("selectIds keeps the known ids in list order and names the unknown ones", () => {
  const known = ["M01", "M02", "M03"];
  assert.deepEqual(selectIds([], known), { selected: known, unknown: [] });
  assert.deepEqual(selectIds(["M03", "M01"], known), { selected: ["M01", "M03"], unknown: [] });
  assert.deepEqual(selectIds(["M03", "M3O"], known), { selected: ["M03"], unknown: ["M3O"] });
  assert.deepEqual(selectIds(["X", "X"], known), { selected: [], unknown: ["X"] });
  assert.deepEqual(selectIds([], []), { selected: [], unknown: [] });
});

test("parseArgs separates ids, flags and the root (--root wins over REPO)", () => {
  assert.deepEqual(parseArgs(["--check-apply", "M01", "--root", "/d", "M02"], { REPO: "/e" }), {
    ids: ["M01", "M02"],
    flags: ["--check-apply"],
    root: "/d",
  });
  assert.equal(parseArgs([], { REPO: "/e" }).root, "/e");
  assert.equal(parseArgs([], {}).root, null);
  assert.throws(() => parseArgs(["--root"], {}), /--root needs a directory/);
});
