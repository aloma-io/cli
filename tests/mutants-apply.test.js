// Offline check: every deliberate break in the two mutation lists must still apply to the current source
// (PLAT-464). Runs each runner with --check-apply (no file written, no test run) and fails, naming the
// runner and the lines it printed, when it exits non-zero. It also shows the check fails when an entry does not
// apply: each failure mode runs against a temp copy of just the files the entries name (--root), never the real tree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, statSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { applyBreak, checkBreak, parseArgs, selectIds } from "./helpers/apply-check.mjs";

const RUNNERS = ["tests/helpers/run-mutations.mjs", "tests/helpers/run-security-mutations.mjs"];
const root = new URL("../", import.meta.url);

// One hash over src/, .github, package.json, package-lock.json and every file in the file column of both lists:
// --check-apply must leave all of them as they were.
function treeHash(extraFiles, base = root) {
  const h = createHash("sha256");
  const walk = (rel) => {
    const url = new URL(rel, base);
    let st;
    try {
      st = statSync(url);
    } catch (err) {
      if (err.code === "ENOENT") return; // an absent file or folder contributes nothing
      throw err;
    }
    if (!st.isDirectory()) {
      h.update(rel).update(readFileSync(url));
      return;
    }
    for (const e of readdirSync(url, { withFileTypes: true })) walk(`${rel}/${e.name}`);
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

test("parseArgs separates ids, flags and the root", () => {
  assert.deepEqual(parseArgs(["--check-apply", "M01", "--root", "/d", "M02"]), {
    ids: ["M01", "M02"],
    flags: ["--check-apply"],
    root: "/d",
  });
  assert.equal(parseArgs([]).root, null);
});

test("parseArgs accepts --root=/dir", () => {
  assert.deepEqual(parseArgs(["--root=/d", "--md"]), { ids: [], flags: ["--md"], root: "/d" });
});

test("parseArgs ignores any REPO variable (it has no environment parameter)", () => {
  assert.equal(parseArgs.length, 1);
  assert.equal(parseArgs(["M01"], { REPO: "/e" }).root, null);
});

test("parseArgs refuses --root without a directory, never taking a flag as the directory", () => {
  assert.throws(() => parseArgs(["--root"]), /--root needs a directory/);
  assert.throws(() => parseArgs(["--root", "--md"]), /--root needs a directory/);
  assert.throws(() => parseArgs(["--root", "--check-apply"]), /--root needs a directory/);
  assert.throws(() => parseArgs(["--root="]), /--root needs a directory/);
});

test("parseArgs refuses an unknown flag and names it", () => {
  assert.throws(() => parseArgs(["--chek-apply"]), /unknown flag --chek-apply/);
  assert.throws(() => parseArgs(["M01", "--rot=/d"]), /unknown flag --rot=\/d/);
});

for (const runner of RUNNERS) {
  test(`${runner} exits 1 and names a bad argument`, () => {
    const unknown = run(runner, "--bogus");
    assert.equal(unknown.status, 1, unknown.out);
    assert.match(unknown.out, /unknown flag --bogus/);
    const noDir = run(runner, "--root", "--md");
    assert.equal(noDir.status, 1, noDir.out);
    assert.match(noDir.out, /--root needs a directory/);
  });

  test(`${runner} --check-apply accepts --root=<dir>`, () => {
    const entries = listOf(runner);
    withCopy(entries, () => {}, (dir) => {
      const r = run(runner, `--root=${dir}`);
      assert.equal(lastLine(r.out), `checked ${entries.length} mutants, 0 do not apply`, r.out);
      assert.equal(r.status, 0, r.out);
    });
  });
}

test("checkBreak: a missing file does not apply; a stale text does not apply; a good entry gives null", () => {
  const read = (text) => () => text;
  const entry = { id: "X1", file: "a.js", find: "-", replace: "+" };
  assert.equal(checkBreak("/r", entry, read("a-b")), null);
  assert.equal(checkBreak("/r", entry, read("ab")), "X1 does not apply to a.js");
  const gone = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
  assert.equal(checkBreak("/r", entry, () => { throw gone; }), "X1 does not apply to a.js");
});

test("checkBreak: any other read error is reported with its own message", () => {
  const entry = { id: "X1", file: "a.js", find: "-", replace: "+" };
  const denied = Object.assign(new Error("EACCES: permission denied, open 'a.js'"), { code: "EACCES" });
  assert.equal(checkBreak("/r", entry, () => { throw denied; }), "X1 cannot read a.js: EACCES: permission denied, open 'a.js'");
});

for (const runner of RUNNERS) {
  test(`${runner} --check-apply reports a target that is a directory as a read error and exits 1`, () => {
    const entries = listOf(runner);
    const e = entries[0];
    const hit = entries.filter((o) => o.file === e.file);
    withCopy(entries, (dir) => {
      rmSync(path.join(dir, e.file));
      mkdirSync(path.join(dir, e.file));
    }, (dir) => {
      const r = run(runner, "--root", dir);
      for (const o of hit) {
        assert.ok(lines(r.out).some((l) => l.startsWith(`${o.id} cannot read ${o.file}: EISDIR`)), r.out);
        assert.ok(!lines(r.out).includes(`${o.id} does not apply to ${o.file}`), r.out);
      }
      assert.equal(lastLine(r.out), `checked ${entries.length} mutants, ${hit.length} do not apply`, r.out);
      assert.equal(r.status, 1, r.out);
    });
  });
}

test("treeHash hashes what exists when a hashed folder is absent", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mutants-hash-"));
  try {
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "a.js"), "a");
    writeFileSync(path.join(dir, "package.json"), "{}");
    const base = pathToFileURL(`${dir}/`);
    const first = treeHash([], base); // no .github, no package-lock.json
    assert.equal(first, treeHash([], base));
    writeFileSync(path.join(dir, "src", "a.js"), "b");
    assert.notEqual(treeHash([], base), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A copy of one runner (with apply-check.mjs) inside a temp tree laid out like the repo, so "the real repo" for that
// copy is the temp tree and a normal run can change files without touching this checkout. The tests it runs are
// stubs that fail, so the break is "killed". A decoy tree, where the entry's old text is absent, stands for the
// tree an ambient REPO variable would point at.
function runnerTree(runner, file, extra) {
  const dir = mkdtempSync(path.join(tmpdir(), "mutants-tree-"));
  const put = (rel, data) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), data);
  };
  for (const f of [runner, "tests/helpers/apply-check.mjs"]) put(f, readFileSync(new URL(f, root)));
  put(file, readFileSync(new URL(file, root)));
  for (const f of extra) put(f, "process.exit(1);\n");
  return dir;
}

const NORMAL_RUNS = [
  { runner: RUNNERS[0], id: "P01", file: "src/ui/select.js", stubs: ["tests/ui-select.test.js"] },
  { runner: RUNNERS[1], id: "S38", file: "package.json", stubs: ["tests/package-files.test.js"] },
];

for (const { runner, id, file, stubs } of NORMAL_RUNS) {
  test(`${runner}: REPO is ignored; a normal run and --check-apply read the real repo, or the --root tree`, () => {
    const real = runnerTree(runner, file, stubs);
    const decoy = runnerTree(runner, file, stubs);
    try {
      const entry = listOf(runner).find((e) => e.id === id);
      const decoyText = readFileSync(path.join(decoy, file), "utf8").replace(entry.find, "");
      writeFileSync(path.join(decoy, file), decoyText);
      const realText = readFileSync(path.join(real, file), "utf8");
      const go = (args, treeRunner = real) =>
        spawnSync(process.execPath, [path.join(treeRunner, runner), ...args], { cwd: root, encoding: "utf8", env: { REPO: decoy } });
      const KILLED = /killed 1 \/ 1|1 of 1 mutants killed/;
      const out = (r) => `${r.stdout}${r.stderr}`;

      // no --root: the tree the runner sits in, not the REPO tree
      const check = go(["--check-apply", id]);
      assert.equal(check.status, 0, out(check));
      assert.match(out(check), /checked 1 mutants, 0 do not apply/);
      const normal = go([id]);
      assert.match(out(normal), KILLED, out(normal));
      assert.equal(readFileSync(path.join(real, file), "utf8"), realText, "the file was not restored");
      assert.equal(readFileSync(path.join(decoy, file), "utf8"), decoyText, "the REPO tree was touched");

      // --root: the given tree
      const checkRoot = go(["--check-apply", id, "--root", decoy]);
      assert.equal(checkRoot.status, 1, out(checkRoot));
      assert.ok(lines(out(checkRoot)).includes(`${id} does not apply to ${file}`), out(checkRoot));
      const normalRoot = go([id, "--root", decoy]);
      assert.doesNotMatch(out(normalRoot), KILLED, out(normalRoot));
      assert.equal(readFileSync(path.join(decoy, file), "utf8"), decoyText);

      // --root on the tree that does apply runs the stub tests there and kills the break
      const normalGood = go([id, "--root", real]);
      assert.match(out(normalGood), KILLED, out(normalGood));
    } finally {
      rmSync(real, { recursive: true, force: true });
      rmSync(decoy, { recursive: true, force: true });
    }
  });
}
