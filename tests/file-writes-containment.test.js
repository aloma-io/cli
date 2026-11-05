// PLAT-10: every command that writes files from server or YAML data stays inside the folder it was given
// (or refuses with a clear error), and what `aloma deploy <yaml>` may read today. Offline: the API is the
// harness's local stub on 127.0.0.1. Commands that write files: step pull, library pull (src/resources/
// engine.js writeItemFile), step edit (temp file, src/commands/step/index.js), step generate (the user's
// own -f path, never a server name). There is no workspace export or download command.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sandboxTest } from "./helpers/cli-harness.js";

// NODE_OPTIONS for a CLI run whose `open` runs the TEST_EDITOR_SCRIPT on the target (any platform).
const here = path.dirname(new URL(import.meta.url).pathname);
const withEditor = `--import ${pathToFileURL(path.join(here, "helpers", "preload-fetch.mjs")).href} --import ${pathToFileURL(path.join(here, "helpers", "editor-open-hook.mjs")).href}`;

const ok = { validateAutomationIf: true };
const stepFile = (cond, body) =>
  `export const condition = ${cond};\n\nexport const content = async () => {\n${body}\n};\n`;
const libFile = (types, body) =>
  `export const types = () => {\n  return \`${types}\`;\n};\n\nexport const content = () => {\n${body}\n};\n`;
const WS = (...names) => ({ listAutomationEnvironmentWithStats: names.map(([id, name]) => ({ id, name })) });

// Every file and link under the sandbox root except the target folder and the harness's own files.
function outsideTree(sb, target) {
  const skip = new Set([path.join(sb.work, target), path.join(sb.root, "tmp"), path.join(sb.root, "home"), sb.openLog, sb.realmLog]);
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (skip.has(p)) continue;
      if (e.isDirectory()) walk(p);
      else out.push(`${path.relative(sb.root, p)}:${e.isSymbolicLink() ? "link" : fs.readFileSync(p, "utf8")}`);
    }
  };
  walk(sb.root);
  return out.sort();
}

const KINDS = [
  {
    kind: "step",
    item: (id, name) => ({ id, name, content: { if: "{}", do: `mark("${id}");` } }),
    mock(sb, items) {
      sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: items.map(({ id, name }) => ({ id, name })) });
      sb.api.on("GET_STEP_QUERY", (v) => ({ getAutomationStep: items.find((s) => s.id === v.id) ?? null }));
    },
    one: "-s",
  },
  {
    kind: "library",
    item: (id, name) => ({ id, name, namespace: "n", enabled: true, tags: [], version: 1, types: "T", content: { content: `mark("${id}");` } }),
    mock(sb, items) {
      sb.api.on("LIST_AUTOMATION_LIBS_QUERY", { listAutomationLibs: items.map(({ id, name }) => ({ id, name })) });
      sb.api.on("GET_AUTOMATION_LIB_QUERY", (v) => ({ getAutomationLib: items.find((l) => l.id === v.id) ?? null }));
    },
    one: "-l",
  },
];

for (const K of KINDS) {
  test(`SECURITY: ${K.kind} pull: traversal, absolute, drive, NUL names from the server are refused; nothing is written outside`, sandboxTest(async (sb) => {
    const tmpAbs = `/tmp/aloma-plat10-${process.pid}-${Date.now()}/x`;
    const unsafe = ["../x", "../../etc/x", tmpAbs, `${sb.root}/abs/x`, "C:\\x", "C:/x/../../y", "a\u0000b", "ok/../../x"];
    const items = unsafe.map((name, i) => K.item(`u-${i}`, name));
    items.push(K.item("good", "ok/inside"));
    K.mock(sb, items);
    sb.write("out/keep.txt", "keep");
    const before = outsideTree(sb, "out");
    const r = await sb.run([K.kind, "pull", "-p", "out"]);
    assert.deepEqual(outsideTree(sb, "out"), before, "nothing written next to or above the target folder");
    assert.equal(fs.existsSync(path.dirname(tmpAbs)), false, "absolute /tmp name not written");
    assert.equal((r.out.match(new RegExp(`Skipped ${K.kind} u-\\d: unsafe name`, "g")) || []).length, unsafe.length, r.out);
    assert.deepEqual(sb.list("out"), ["keep.txt", "ok"]);
    assert.match(sb.read("out/ok/inside.js"), /mark\("good"\)/);
    // One unsafe name asked for by id: refused with the reason, nothing written
    for (let i = 0; i < unsafe.length; i++) {
      const one = await sb.run([K.kind, "pull", K.one, `u-${i}`, "-p", "out"]);
      assert.equal(one.code, 1, unsafe[i]);
      assert.match(one.stderr, new RegExp(`unsafe ${K.kind} name`), unsafe[i]);
    }
    assert.deepEqual(outsideTree(sb, "out"), before);
    assert.deepEqual(sb.list("out"), ["keep.txt", "ok"]);
  }));

  test(`SECURITY: ${K.kind} pull: a very long name fails with a clear error and writes nothing`, sandboxTest(async (sb) => {
    K.mock(sb, [K.item("long", "a".repeat(300)), K.item("deep", Array(2100).fill("d").join("/"))]);
    const before = outsideTree(sb, "out");
    for (const id of ["long", "deep"]) {
      const r = await sb.run([K.kind, "pull", K.one, id, "-p", "out"]);
      assert.equal(r.code, 1, id);
      assert.match(r.stderr, /ENAMETOOLONG|name too long/, id);
      assert.doesNotMatch(r.stdout, /Successfully pulled/);
    }
    assert.deepEqual(outsideTree(sb, "out"), before);
    assert.deepEqual(sb.list("out"), [], "nothing written inside either");
  }));

  // A name whose real location is outside the target folder (through a link folder or a link file) is
  // refused with the name shown; the linked file stays as it was. Links that stay inside are fine.
  test(`SECURITY: ${K.kind} pull refuses a name that lands outside the target folder through a link`, sandboxTest(async (sb) => {
    const outside = path.join(sb.root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "victim.txt"), "original");
    sb.write("out/.keep", "");
    fs.symlinkSync(outside, path.join(sb.work, "out", "linkdir"));
    fs.symlinkSync(path.join(outside, "victim.txt"), path.join(sb.work, "out", "linkfile.js"));
    fs.symlinkSync(path.join(sb.work, "out", "real"), path.join(sb.work, "out", "innerlink"));
    fs.mkdirSync(path.join(sb.work, "out", "real"));
    K.mock(sb, [K.item("d", "linkdir/x"), K.item("f", "linkfile"), K.item("n", "linkdir/new/deep"), K.item("i", "innerlink/ok"), K.item("g", "plain")]);
    const r = await sb.run([K.kind, "pull", "-p", "out"]);
    assert.deepEqual(fs.readdirSync(outside), ["victim.txt"], "nothing created outside");
    assert.equal(fs.readFileSync(path.join(outside, "victim.txt"), "utf8"), "original", "linked file unchanged");
    for (const shown of ['"linkdir/x"', '"linkfile"', '"linkdir/new/deep"']) {
      assert.ok(r.out.includes(shown), `${shown} named in\n${r.out}`);
    }
    assert.match(sb.read("out/real/ok.js"), /mark\("i"\)/, "a link that stays inside the folder works");
    assert.match(sb.read("out/plain.js"), /mark\("g"\)/, "a normal name writes");
    // asked for by id: refused, exit 1, name shown
    for (const [id, name] of [["d", "linkdir/x"], ["f", "linkfile"]]) {
      const one = await sb.run([K.kind, "pull", K.one, id, "-p", "out"]);
      assert.equal(one.code, 1, name);
      assert.ok(one.stderr.includes(JSON.stringify(name)), one.stderr);
    }
    assert.equal(fs.readFileSync(path.join(outside, "victim.txt"), "utf8"), "original");
    assert.deepEqual(fs.readdirSync(outside), ["victim.txt"]);
  }));
}

// step edit writes the step to <os.tmpdir()>/<last name segment>.js before opening the editor.
test("SECURITY: step edit: server names with traversal, absolute or drive parts keep the temp file inside the temp folder", sandboxTest(async (sb) => {
  const names = ["../x", "../../etc/x", "/tmp/plat10-edit", "C:\\x", "a/.."];
  for (const name of names) {
    sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [{ id: "s-1", name }] });
    sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-1", name, content: { if: "{}", do: "x();" } } });
    const before = outsideTree(sb, "none");
    await sb.run(["step", "edit", "s-1"], { env: { TEST_EDITOR_SCRIPT: "" }, timeoutMs: 15000 }).catch(() => {});
    assert.deepEqual(outsideTree(sb, "none"), before, name);
  }
  // NUL in the name: refused by the file system call, nothing written
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [{ id: "s-1", name: "a\u0000b" }] });
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-1", name: "a\u0000b", content: { if: "{}", do: "x();" } } });
  const r = await sb.run(["step", "edit", "s-1"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error editing step:.*null bytes/);
}));

// step edit works in its own private folder under the temp folder: made with mkdtemp, the file created
// exclusively with mode 0600, read back from there and removed afterwards. Whatever sits at the old
// predictable name <tmpdir>/<last name segment>.js is neither written nor read.
test("SECURITY: step edit uses a private temp file; a file or link at the old predictable name is not touched", sandboxTest(async (sb) => {
  const tmp = path.join(sb.root, "tmp");
  fs.mkdirSync(tmp, { recursive: true });
  const editor = sb.write("editor.mjs", [
    'import fs from "node:fs";',
    'const p = process.argv[2];',
    'fs.appendFileSync(process.env.TEST_EDIT_LOG, JSON.stringify({ p, mode: fs.statSync(p).mode & 0o777, dirMode: fs.statSync(p.slice(0, p.lastIndexOf("/"))).mode & 0o777 }) + "\\n");',
    'fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("edited();", "editedByTest();"));',
  ].join("\n"));
  const log = path.join(sb.root, "edit.log");
  const victim = path.join(sb.root, "victim.txt");
  fs.writeFileSync(victim, "original");
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [{ id: "s-1", name: "group/target" }] });
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-1", name: "group/target", content: { if: "{}", do: "edited();" } } });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const edit = async () => {
    sb.api.calls.length = 0;
    const r = await sb.run(["step", "edit", "s-1"], { env: { TEST_EDITOR_SCRIPT: editor, TEST_EDIT_LOG: log, NODE_OPTIONS: withEditor }, timeoutMs: 15000 });
    assert.equal(r.code, 0, r.out);
    return sb.api.calls.filter((c) => c.op === "SAVE_STEP_MUTATION").map((c) => c.variables.do).join("\n");
  };

  // a link planted at the old name: the victim is not written, the edit is still saved
  fs.symlinkSync(victim, path.join(tmp, "target.js"));
  assert.match(await edit(), /editedByTest\(\);/);
  assert.equal(fs.readFileSync(victim, "utf8"), "original");

  // a regular file planted at the old name: it is not read back as the edited step
  fs.unlinkSync(path.join(tmp, "target.js"));
  const planted = stepFile("{}", "plantedContent();");
  fs.writeFileSync(path.join(tmp, "target.js"), planted);
  const saved = await edit();
  assert.match(saved, /editedByTest\(\);/);
  assert.doesNotMatch(saved, /plantedContent/);
  assert.equal(fs.readFileSync(path.join(tmp, "target.js"), "utf8"), planted, "planted file untouched");

  // where the editor was pointed: a fresh private folder each time, file mode 0600, all gone afterwards
  const runs = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(runs.length, 2);
  for (const { p, mode, dirMode } of runs) {
    assert.notEqual(p, path.join(tmp, "target.js"), "not the old predictable name");
    assert.equal(path.dirname(path.dirname(p)), tmp, "inside a folder directly under the temp folder");
    assert.equal(path.basename(p), "target.js");
    assert.equal(mode, 0o600, "file mode");
    assert.equal(dirMode, 0o700, "folder mode");
    assert.equal(fs.existsSync(p), false, "temp file removed");
    assert.equal(fs.existsSync(path.dirname(p)), false, "temp folder removed");
  }
  assert.notEqual(path.dirname(runs[0].p), path.dirname(runs[1].p), "folder name is not predictable");
  assert.match(path.basename(path.dirname(runs[0].p)), /[A-Za-z0-9]{6,}$/);
  assert.deepEqual(fs.readdirSync(tmp), ["target.js"], "nothing left behind");
}));

// ------------------------------------------------------------------ deploy: what a YAML may read

function deployMocks(sb) {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", { listAutomationLibs: [] });
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "l-new" });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  sb.api.on("CREATE_TASK_MUTATION", { createAutomationTask: "t-new" });
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: true });
  sb.api.on("LIST_CONNECTORS_QUERY", { listAutomationConnectors: [{ id: "c-1", name: "Conn" }] });
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
}
const sent = (sb) => JSON.stringify(sb.api.calls.map((c) => c.variables));

// Every file reference in a deploy YAML (step and library file: and syncPath:, task file:, connector file:)
// is taken from the YAML's own folder. A path that is absolute, or whose real location is outside that
// folder (also through a link), is refused with an error naming it; nothing is read and nothing is sent.
const REFUSED = [
  { kind: "step file", yaml: (p) => `    steps:\n      - name: n\n        file: ${p}\n`, mark: "leakStep" },
  { kind: "step syncPath", yaml: (p) => `    steps:\n      - syncPath: ${p}\n`, mark: "leakStep" },
  { kind: "library file", yaml: (p) => `    libraries:\n      - name: n\n        file: ${p}\n`, mark: "leakLib" },
  { kind: "library syncPath", yaml: (p) => `    libraries:\n      - syncPath: ${p}\n`, mark: "leakLib" },
  { kind: "task file", yaml: (p) => `    tasks:\n      - name: n\n        file: ${p}\n`, mark: "leakTask" },
  { kind: "connector file", yaml: (p) => `    connectors:\n      - connectorId: m-1\n        connectorName: Conn\n        file: ${p}\n`, mark: "leakConn" },
];
function seedOutside(sb) {
  sb.write("outside/f.js", stepFile("{}", "leakStep();"));
  sb.write("outside/dir/f.js", stepFile("{}", "leakStep();"));
  sb.write("outside/lib.js", libFile("T", "leakLib();"));
  sb.write("outside/libdir/lib.js", libFile("T", "leakLib();"));
  sb.write("outside/t.json", '{"leak":"leakTask"}');
  sb.write("outside/c.yaml", "name: leakConn\n");
  sb.write("proj/in/f.js", stepFile("{}", "leakStep();"));
  sb.write("proj/in/dir/f.js", stepFile("{}", "leakStep();"));
  sb.write("proj/in/lib.js", libFile("T", "leakLib();"));
  sb.write("proj/in/libdir/lib.js", libFile("T", "leakLib();"));
  sb.write("proj/in/t.json", '{"leak":"leakTask"}');
  sb.write("proj/in/c.yaml", "name: leakConn\n");
  fs.mkdirSync(path.join(sb.work, "proj"), { recursive: true });
  fs.symlinkSync(path.join(sb.work, "outside"), path.join(sb.work, "proj", "linkdir"));
  fs.symlinkSync(path.join(sb.work, "outside", "f.js"), path.join(sb.work, "proj", "linkfile.js"));
}
const pick = (R, name) => ({
  "step file": name.s, "step syncPath": name.sd, "library file": name.l, "library syncPath": name.ld,
  "task file": name.t, "connector file": name.c,
})[R.kind];

for (const R of REFUSED) {
  test(`SECURITY: deploy refuses ${R.kind} paths outside the YAML's folder, names them and sends nothing`, sandboxTest(async (sb) => {
    seedOutside(sb);
    deployMocks(sb);
    const abs = (rel) => path.join(sb.work, rel);
    const cases = {
      "../outside": pick(R, { s: "../outside/f.js", sd: "../outside/dir", l: "../outside/lib.js", ld: "../outside/libdir", t: "../outside/t.json", c: "../outside/c.yaml" }),
      absolute: pick(R, { s: abs("outside/f.js"), sd: abs("outside/dir"), l: abs("outside/lib.js"), ld: abs("outside/libdir"), t: abs("outside/t.json"), c: abs("outside/c.yaml") }),
      "absolute, even when it points into the folder": pick(R, { s: abs("proj/in/f.js"), sd: abs("proj/in/dir"), l: abs("proj/in/lib.js"), ld: abs("proj/in/libdir"), t: abs("proj/in/t.json"), c: abs("proj/in/c.yaml") }),
      "through a link": pick(R, { s: "linkdir/f.js", sd: "linkdir/dir", l: "linkdir/lib.js", ld: "linkdir/libdir", t: "linkdir/t.json", c: "linkdir/c.yaml" }),
      "link to a file": pick(R, { s: "linkfile.js", sd: "linkfile.js", l: "linkfile.js", ld: "linkfile.js", t: "linkfile.js", c: "linkfile.js" }),
    };
    for (const [label, ref] of Object.entries(cases)) {
      sb.api.calls.length = 0;
      sb.write("proj/d.yaml", `workspaces:\n  - name: Dev\n${R.yaml(ref)}`);
      const r = await sb.run(["deploy", "d.yaml"], { cwd: path.join(sb.work, "proj"), timeoutMs: 40000 });
      assert.equal(r.code, 1, `${label}\n${r.out}`);
      assert.ok(r.stderr.includes(ref), `${label}: names ${ref}\n${r.stderr}`);
      assert.doesNotMatch(sent(sb), new RegExp(R.mark), `${label}: nothing sent`);
      const writes = sb.api.ops().filter((o) => /CREATE|SAVE|ADD|UPDATE/.test(o));
      assert.deepEqual(writes, [], `${label}: nothing created or saved`);
    }
  }));
}

test("deploy reads files inside the YAML's folder, in subfolders too, from any current directory", sandboxTest(async (sb) => {
  sb.write("proj/steps/s.js", stepFile("{}", "inStep();"));
  sb.write("proj/lib/l.js", libFile("T", "inLib();"));
  sb.write("proj/sync/a.js", stepFile("{}", "inSync();"));
  sb.write("proj/data/t.json", '{"v":"inTask"}');
  sb.write("proj/data/c.yaml", "name: inConn\n");
  sb.write("proj/d.yaml", [
    "workspaces:", "  - name: Dev",
    "    steps:", "      - name: s", "        file: steps/s.js", "      - syncPath: sync",
    "    libraries:", "      - name: lib", "        file: ./lib/l.js",
    "    tasks:", "      - name: t", "        file: data/t.json",
    "    connectors:", "      - connectorId: m-1", "        connectorName: Conn", "        file: data/c.yaml",
  ].join("\n"));
  deployMocks(sb);
  // from the parent folder and from an unrelated folder: paths are the YAML's, not the current directory's
  for (const cwd of [sb.work, path.join(sb.work, "proj", "steps")]) {
    sb.api.calls.length = 0;
    const yamlArg = path.relative(cwd, path.join(sb.work, "proj", "d.yaml"));
    const r = await sb.run(["deploy", yamlArg], { cwd, timeoutMs: 40000 });
    assert.equal(r.code, 0, r.out);
    for (const mark of ["inStep", "inSync", "inLib", "inTask", "inConn"]) {
      assert.match(sent(sb), new RegExp(mark), `${mark} (cwd ${cwd})\n${r.out}`);
    }
  }
}));

test("deploy: a missing file inside the folder still reports that it is missing", sandboxTest(async (sb) => {
  sb.write("proj/d.yaml", "workspaces:\n  - name: Dev\n    steps:\n      - name: n\n        file: nope/missing.js\n");
  deployMocks(sb);
  const r = await sb.run(["deploy", "d.yaml"], { cwd: path.join(sb.work, "proj") });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /ENOENT|no such file/);
  assert.doesNotMatch(r.stderr, /outside the folder/);
}));

// Safe today: a syncPath folder is walked with readdir entries, and symlinks are neither files nor folders
// there (src/walk.js:10), so a link inside it to a file or folder outside is not read.
test("SECURITY: deploy syncPath does not follow symlinks inside the folder", sandboxTest(async (sb) => {
  sb.write("outside/secret.js", stepFile("{}", "leakLinked();"));
  sb.write("outside/d/inner.js", stepFile("{}", "leakLinkedDir();"));
  sb.write("proj/steps/real.js", stepFile("{}", "inside();"));
  fs.symlinkSync(path.join(sb.work, "outside", "secret.js"), path.join(sb.work, "proj", "steps", "link.js"));
  fs.symlinkSync(path.join(sb.work, "outside", "d"), path.join(sb.work, "proj", "steps", "linkdir"));
  sb.write("proj/d.yaml", "workspaces:\n  - name: Dev\n    steps:\n      - syncPath: steps\n");
  deployMocks(sb);
  const r = await sb.run(["deploy", "d.yaml"], { cwd: path.join(sb.work, "proj") });
  assert.equal(r.code, 0, r.out);
  assert.match(sent(sb), /inside\(\)/);
  assert.doesNotMatch(sent(sb), /leakLinked/);
  const creates = sb.api.calls.filter((c) => c.op === "CREATE_STEP_MUTATION").map((c) => c.variables.name);
  assert.deepEqual(creates, ["real"]);
}));

test("SECURITY: deploy: a file path with NUL fails that item with an error and reads nothing", sandboxTest(async (sb) => {
  sb.write("proj/d.yaml", 'workspaces:\n  - name: Dev\n    steps:\n      - name: n\n        file: "s\\0.js"\n');
  deployMocks(sb);
  const r = await sb.run(["deploy", "d.yaml"], { cwd: path.join(sb.work, "proj") });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Path outside the folder of d\.yaml is refused: s +\.js/);
  assert.ok(!sb.api.ops().includes("CREATE_STEP_MUTATION"));
}));
