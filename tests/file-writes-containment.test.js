// PLAT-10: every command that writes files from server or YAML data stays inside the folder it was given
// (or refuses with a clear error), and what `aloma deploy <yaml>` may read today. Offline: the API is the
// harness's local stub on 127.0.0.1. Commands that write files: step pull, library pull (src/resources/
// engine.js writeItemFile), step edit (temp file, src/commands/step/index.js), step generate (the user's
// own -f path, never a server name). There is no workspace export or download command.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandboxTest } from "./helpers/cli-harness.js";

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

  // PINS SUSPECT BEHAVIOUR: a symlink already in the target folder is followed. The name check is lexical
  // (src/pull-safety.js:14); writeItemFile (src/resources/engine.js:196) mkdirs and writes through links.
  test(`PINS SUSPECT BEHAVIOUR: ${K.kind} pull follows a symlink in the target folder and writes outside it`, sandboxTest(async (sb) => {
    const outside = path.join(sb.root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "victim.txt"), "original");
    sb.write("out/.keep", "");
    fs.symlinkSync(outside, path.join(sb.work, "out", "linkdir"));
    fs.symlinkSync(path.join(outside, "victim.txt"), path.join(sb.work, "out", "linkfile.js"));
    K.mock(sb, [K.item("d", "linkdir/x"), K.item("f", "linkfile")]);
    const r = await sb.run([K.kind, "pull", "-p", "out"]);
    assert.equal(r.code, 0, r.out);
    assert.match(fs.readFileSync(path.join(outside, "x.js"), "utf8"), /mark\("d"\)/, "written into the linked folder outside");
    assert.match(fs.readFileSync(path.join(outside, "victim.txt"), "utf8"), /mark\("f"\)/, "file outside overwritten through the link");
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

// PINS SUSPECT BEHAVIOUR: the temp file name is predictable and written with a plain writeFile
// (src/commands/step/index.js:223, :255), so a link planted at <tmpdir>/<name>.js is followed. On Linux
// os.tmpdir() is the shared /tmp.
test("PINS SUSPECT BEHAVIOUR: step edit writes through a symlink planted at the predictable temp file name", sandboxTest(async (sb) => {
  const tmp = path.join(sb.root, "tmp");
  fs.mkdirSync(tmp, { recursive: true });
  const victim = path.join(sb.root, "victim.txt");
  fs.writeFileSync(victim, "original");
  fs.symlinkSync(victim, path.join(tmp, "target.js"));
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [{ id: "s-1", name: "group/target" }] });
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-1", name: "group/target", content: { if: "{}", do: "edited();" } } });
  await sb.run(["step", "edit", "s-1"], { timeoutMs: 15000 }).catch(() => {});
  assert.match(fs.readFileSync(victim, "utf8"), /Step: group\/target[\s\S]*edited\(\);/);
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

// PINS SUSPECT BEHAVIOUR: file:, syncPath: (steps, libraries) and file: (tasks, connectors) are passed to
// fs.readFile as written (src/resources/step.js:20, library.js:19, task/index.js:374, connector/index.js:258):
// relative to the current directory, not the YAML's folder, and "../" or absolute paths are not refused.
// What they read is sent to the API.
test("PINS SUSPECT BEHAVIOUR: deploy reads step, library, task and connector files outside the YAML's folder and sends them", sandboxTest(async (sb) => {
  sb.write("outside/s.js", stepFile("{}", "leakStepRel();"));
  sb.write("outside/abs.js", stepFile("{}", "leakStepAbs();"));
  sb.write("outside/l.js", libFile("T", "leakLib();"));
  sb.write("outside/t.json", '{"leak":"leakTask"}');
  sb.write("outside/c.yaml", "name: leakConnector\n");
  sb.write("outside/dir/synced.js", stepFile("{}", "leakSync();"));
  sb.write("cwd-only.js", stepFile("{}", "leakCwd();"));
  sb.write("proj/d.yaml", [
    "workspaces:", "  - name: Dev",
    "    steps:",
    "      - name: rel", "        file: ../outside/s.js",
    `      - name: abs`, `        file: ${path.join(sb.work, "outside", "abs.js")}`,
    "      - syncPath: ../outside/dir",
    "    libraries:", "      - name: lib", "        file: ../outside/l.js",
    "    tasks:", "      - name: t", "        file: ../outside/t.json",
    "    connectors:", "      - connectorId: m-1", "        connectorName: Conn", "        file: ../outside/c.yaml",
  ].join("\n"));
  deployMocks(sb);
  // the connector update waits 10 s after the add (src/commands/connector/index.js:165)
  const r = await sb.run(["deploy", "d.yaml"], { cwd: path.join(sb.work, "proj"), timeoutMs: 40000 });
  assert.equal(r.code, 0, r.out);
  for (const mark of ["leakStepRel", "leakStepAbs", "leakSync", "leakLib", "leakTask", "leakConnector"]) {
    assert.match(sent(sb), new RegExp(mark), `${mark}\n${r.out}`);
  }
  // Relative paths are taken from the current directory, not the YAML's folder
  sb.api.calls.length = 0;
  sb.write("proj/d2.yaml", "workspaces:\n  - name: Dev\n    steps:\n      - name: c\n        file: cwd-only.js\n");
  const r2 = await sb.run(["deploy", "proj/d2.yaml"]);
  assert.equal(r2.code, 0, r2.out);
  assert.match(sent(sb), /leakCwd/);
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
  assert.match(r.stderr, /Error creating step: n: Error parsing step file\..*null bytes/);
  assert.ok(!sb.api.ops().includes("CREATE_STEP_MUTATION"));
}));
