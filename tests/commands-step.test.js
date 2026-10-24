// Characterisation tests for `aloma step ...` (src/commands/step): requests, printed output
// and the files written/read by add, edit, pull, sync and generate.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sandboxTest, gqlError, canFakeOpen } from "./helpers/cli-harness.js";

const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);
const ok = { validateAutomationIf: true };
const stepFile = (cond, body) =>
  `export const condition = ${cond};\n\nexport const content = async () => {\n${body}\n};\n`;

const HEADER = (name, id) => `/**
 * Step: ${name}
 * ID: ${id}
 * 
 * Edit the condition and content below.
 * The condition should be a valid JavaScript object (trailing commas are allowed).
 * The content should be JavaScript code that will be executed.
 * 
 * Example:
 * condition = {
 *   newStep: true,  // trailing commas are fine
 *   status: "active"
 * };
 * 
 * content = async () => {
 *   console.log('running step');
 *   data.newStep = true;
 * };
 */
`;

// -------------------------------------------------------------------- list

test("step list: defaults send includeDisabled=false and name=null", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", {
    listAutomationSteps: [
      { id: "s-1", name: "first", enabled: true, valid: true, last_used_at: "2024-05-06" },
      { id: "s-2", name: "second", enabled: false, valid: false, last_used_at: null },
    ],
  });
  const r = await sb.run(["step", "list"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["LIST_STEPS_QUERY", { id: "ws-sel", includeDisabled: false, name: null }]]);
  assert.equal(
    r.stdout,
    [
      "", "📊 Steps in Current Workspace", "",
      "first", "   ID: s-1", "   Status: ● Enabled | ✓ Valid", "   Last Used: 2024-05-06", "",
      "second", "   ID: s-2", "   Status: ● Disabled | ✗ Invalid", "   Last Used: Never", "", "",
    ].join("\n"),
  );
}));

test("step list: --include-disabled and --name are passed through", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  const r = await sb.run(["step", "list", "-d", "-n", "foo"]);
  assert.deepEqual(ops(sb), [["LIST_STEPS_QUERY", { id: "ws-sel", includeDisabled: true, name: "foo" }]]);
  assert.equal(r.stdout, "No steps found in current workspace.\n");
}));

test("step list: API error is printed, exit 0", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", gqlError("denied"));
  const r = await sb.run(["step", "list"]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /Error fetching steps: denied/);
}));

// -------------------------------------------------------------------- show

test("step show: prints details and JSON content; ignores the workspace option", sandboxTest(async (sb) => {
  sb.api.on("GET_STEP_QUERY", {
    getAutomationStep: {
      id: "s-1", name: "first", valid: true, enabled: true, version: 4, nocode_type: null,
      content: { if: "{}", do: "x" }, nocode_content: { a: 1 },
    },
  });
  const r = await sb.run(["step", "show", "s-1", "-w", "whatever"]);
  assert.equal(r.code, 0);
  // -w is accepted but unused: no workspace lookup happens.
  assert.deepEqual(ops(sb), [["GET_STEP_QUERY", { id: "s-1" }]]);
  assert.equal(
    r.stdout,
    [
      "", "📊 Step Details", "", "Name: first", "ID: s-1", "Status: Enabled", "Valid: Yes",
      "Version: 4", "Type: Standard", "", "Content:", '{\n  "if": "{}",\n  "do": "x"\n}', "",
      "NoCode Content:", '{\n  "a": 1\n}', "",
    ].join("\n"),
  );
}));

test("step show: not found; API error", sandboxTest(async (sb) => {
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: null });
  let r = await sb.run(["step", "show", "s-9"]);
  assert.equal(r.stdout, "Step with ID s-9 not found.\n");
  sb.api.on("GET_STEP_QUERY", gqlError("denied"));
  r = await sb.run(["step", "show", "s-9"]);
  assert.match(r.stderr, /Error fetching step details: denied/);
  assert.equal(r.code, 0);
}));

// --------------------------------------------------------------------- add

test("step add: creates the step with a trimmed name and the nocode type", sandboxTest(async (sb) => {
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  const r = await sb.run(["step", "add", "  my step ", "-t", "http"]);
  assert.equal(r.stdout, "Created step [my step] with ID: s-new\n");
  assert.deepEqual(ops(sb), [["CREATE_STEP_MUTATION", { name: "my step", environment_id: "ws-sel", nocode_type: "http" }]]);
}));

test("step add -f: parses the file, validates the condition, saves content as version 0", sandboxTest(async (sb) => {
  sb.write("s.js", stepFile("{ status: 'new', }", "  data.x = 1;\n  data.y = 2;"));
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const r = await sb.run(["step", "add", "s", "-f", "s.js"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "Created step [s] with ID: s-new\nSuccessfully added step content from file: s.js\n");
  assert.deepEqual(ops(sb), [
    ["CREATE_STEP_MUTATION", { name: "s", environment_id: "ws-sel", nocode_type: null }],
    ["VALIDATE_IF_QUERY", { content: "{\n  status: 'new'\n}" }],
    ["SAVE_STEP_MUTATION", {
      id: "s-new", name: "s", if: "{\n  status: 'new'\n}", do: "data.x = 1;\n  data.y = 2;",
      enabled: true, version: 0, nocode_content: null, config_content: null,
    }],
  ]);
}));

test("step add -f: file without condition/content, or invalid condition, leaves an empty step", sandboxTest(async (sb) => {
  sb.write("bad.js", "export const nothing = 1;\n");
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  let r = await sb.run(["step", "add", "s", "-f", "bad.js"]);
  assert.equal(r.code, 0);
  // PINS SUSPECT BEHAVIOUR: the step is created first; a bad file only prints an error, so an
  // empty step remains in the workspace and the exit code is 0.
  assert.match(r.stderr, /Error reading or parsing file: Error parsing step file\. Could not parse condition from file/);
  assert.deepEqual(sb.api.ops(), ["CREATE_STEP_MUTATION"]);

  sb.write("inv.js", stepFile("{ a: 1 }", "data.a = 2;"));
  sb.api.on("VALIDATE_IF_QUERY", { validateAutomationIf: false });
  r = await sb.run(["step", "add", "s", "-f", "inv.js"]);
  assert.match(r.stderr, /Condition is invalid, not a valid JSON object/);
  assert.ok(!sb.api.ops().includes("SAVE_STEP_MUTATION"));

  r = await sb.run(["step", "add", "s", "-f", "missing.js"]);
  assert.match(r.stderr, /Error reading or parsing file: Error parsing step file\. ENOENT/);
}));

test("step add: save refused by API prints no success line", sandboxTest(async (sb) => {
  sb.write("s.js", stepFile("{ a: 1 }", "data.a = 2;"));
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: false });
  const r = await sb.run(["step", "add", "s", "-f", "s.js"]);
  assert.equal(r.stdout, "Created step [s] with ID: s-new\n");
}));

test("step add: create error", sandboxTest(async (sb) => {
  sb.api.on("CREATE_STEP_MUTATION", gqlError("exists"));
  const r = await sb.run(["step", "add", "s"]);
  assert.match(r.stderr, /Error creating step: exists/);
  assert.equal(r.code, 0);
}));

// ------------------------------------------------------------------ delete

test("step delete: sends id and workspace; reports success and refusal", sandboxTest(async (sb) => {
  sb.api.on("DELETE_STEP_MUTATION", { deleteAutomationStep: true });
  let r = await sb.run(["step", "delete", "s-1"]);
  assert.equal(r.stdout, "Successfully deleted step with ID: s-1\n");
  assert.deepEqual(ops(sb), [["DELETE_STEP_MUTATION", { id: "s-1", environment_id: "ws-sel" }]]);
  sb.api.on("DELETE_STEP_MUTATION", { deleteAutomationStep: false });
  r = await sb.run(["step", "delete", "s-1"]);
  assert.equal(r.stdout, "Step with ID s-1 not found or could not be deleted.\n");
  sb.api.on("DELETE_STEP_MUTATION", gqlError("in use"));
  r = await sb.run(["step", "delete", "s-1"]);
  assert.match(r.stderr, /Error deleting step: in use/);
  assert.equal(r.code, 0);
}));

// ------------------------------------------------------------------- clone

test("step clone: creates a same-named step in the workspace and copies content at version 0", sandboxTest(async (sb) => {
  sb.api.on("GET_STEP_QUERY", {
    getAutomationStep: { id: "s-1", name: "orig", enabled: false, version: 7, nocode_type: "http",
      content: { if: "{ a: 1 }", do: "data.a = 2;" }, nocode_content: { n: 1 }, config_content: { c: 1 } },
  });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-copy" });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const r = await sb.run(["step", "clone", "s-1"]);
  assert.equal(r.stdout, "Successfully cloned step to workspace: ws-sel\n");
  assert.deepEqual(ops(sb), [
    ["GET_STEP_QUERY", { id: "s-1" }],
    ["CREATE_STEP_MUTATION", { name: "orig", environment_id: "ws-sel", nocode_type: "http" }],
    ["SAVE_STEP_MUTATION", { id: "s-copy", name: "orig", if: "{ a: 1 }", do: "data.a = 2;", enabled: false, version: 0, nocode_content: { n: 1 }, config_content: { c: 1 } }],
  ]);
}));

test("step clone: a step without content is created empty; unknown id", sandboxTest(async (sb) => {
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-1", name: "orig", enabled: true, content: null } });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-copy" });
  await sb.run(["step", "clone", "s-1"]);
  assert.deepEqual(sb.api.ops(), ["GET_STEP_QUERY", "CREATE_STEP_MUTATION"]);
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: null });
  const r = await sb.run(["step", "clone", "s-1"]);
  assert.equal(r.stdout, "Step with ID s-1 not found.\n");
}));

// -------------------------------------------------------------------- edit

const editorScript = (sb, from, to) =>
  sb.write("editor.mjs", `import fs from "node:fs"; const f = process.argv[2]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(${JSON.stringify(from)}, ${JSON.stringify(to)}));\n`);

test("step edit: writes a temp file, waits for the editor, saves the edit, removes the temp file", { skip: !canFakeOpen && "needs the fake `open` (macOS only)" }, sandboxTest(async (sb) => {
  sb.api.on("GET_STEP_QUERY", {
    getAutomationStep: { id: "s-1", name: "group/orig", enabled: true, version: 3, nocode_content: null, config_content: { k: 1 },
      content: { if: "{ a: 1 }", do: "data.old = 1;" } },
  });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const script = editorScript(sb, "data.old = 1;", "data.edited = 2;");
  const r = await sb.run(["step", "edit", "s-1"], { env: { TEST_EDITOR_SCRIPT: script } });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "Opening editor for step: group/orig\nSuccessfully updated step: group/orig\n");
  const tmpFile = path.join(sb.root, "tmp", "orig.js"); // only the last name segment is used
  const opened = sb.openCalls();
  assert.equal(opened.length, 1);
  assert.equal(opened[0], `--wait-apps --new ${tmpFile}`);
  assert.equal(sb.exists(tmpFile), false);
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    id: "s-1", name: "group/orig", if: "{\n  a: 1\n}", do: "data.edited = 2;", enabled: true, version: 3,
    nocode_content: null, config_content: { k: 1 },
  });
}));

test("step edit: an unparsable edit is reported and nothing is saved", { skip: !canFakeOpen && "needs the fake `open` (macOS only)" }, sandboxTest(async (sb) => {
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-1", name: "orig", enabled: true, version: 1, content: { if: "{}", do: "x" } } });
  const script = editorScript(sb, "export const condition", "export const nothing");
  const r = await sb.run(["step", "edit", "s-1"], { env: { TEST_EDITOR_SCRIPT: script } });
  assert.match(r.stderr, /Error parsing or updating step: Error parsing step file\. Could not parse condition from file/);
  assert.ok(!sb.api.ops().includes("SAVE_STEP_MUTATION"));
  assert.equal(sb.exists(path.join(sb.root, "tmp", "orig.js")), false);
}));

test("step edit: unknown step never opens an editor", sandboxTest(async (sb) => {
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: null });
  const r = await sb.run(["step", "edit", "s-1"]);
  assert.equal(r.stdout, "Step with ID s-1 not found.\n");
  assert.deepEqual(sb.openCalls(), []);
}));

// -------------------------------------------------------------------- pull

const FULL = (id, name, ifs, dos, extra = {}) => ({ id, name, content: ifs === undefined ? null : { if: ifs, do: dos }, ...extra });
const mockSteps = (sb, steps) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: steps.map((s) => ({ id: s.id, name: s.name })) });
  sb.api.on("GET_STEP_QUERY", (v) => ({ getAutomationStep: steps.find((s) => s.id === v.id) ?? null }));
};

test("step pull (all): lists with includeDisabled, fetches each, writes <name>.js into the cwd", sandboxTest(async (sb) => {
  mockSteps(sb, [FULL("s-1", "alpha", "{ a: 1 }", "data.a = 2;"), FULL("s-2", "group/beta", "{ b: 1 }", "data.b = 2;")]);
  const r = await sb.run(["step", "pull"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `Successfully pulled 2 steps to: ${sb.work}\n`);
  assert.deepEqual(ops(sb), [
    ["LIST_STEPS_QUERY", { id: "ws-sel", includeDisabled: true }],
    ["GET_STEP_QUERY", { id: "s-1" }],
    ["GET_STEP_QUERY", { id: "s-2" }],
  ]);
  assert.deepEqual(sb.list(), ["alpha.js", "group"]);
  assert.equal(
    sb.read("alpha.js"),
    HEADER("alpha", "s-1") + "\nexport const condition = { a: 1 };\n\nexport const content = async () => {\ndata.a = 2;\n};\n",
  );
  assert.deepEqual(sb.list("group"), ["beta.js"]);
}));

test("step pull -p <dir>: creates the directory; -s pulls one step", sandboxTest(async (sb) => {
  mockSteps(sb, [FULL("s-1", "alpha", "{}", "x();"), FULL("s-2", "beta", "{}", "y();")]);
  const r = await sb.run(["step", "pull", "-s", "s-2", "-p", "out/deep"]);
  assert.equal(r.stdout, "Successfully pulled step: beta\n");
  assert.deepEqual(sb.list("out/deep"), ["beta.js"]);
  assert.deepEqual(ops(sb), [["GET_STEP_QUERY", { id: "s-2" }]]);
}));

test("step pull: a step without content becomes an empty condition and body", sandboxTest(async (sb) => {
  mockSteps(sb, [FULL("s-1", "empty", undefined)]);
  await sb.run(["step", "pull"]);
  assert.equal(sb.read("empty.js"), HEADER("empty", "s-1") + "\nexport const condition = {};\n\nexport const content = async () => {\n\n};\n");
}));

test("step pull: steps with the same name overwrite each other (last one wins)", sandboxTest(async (sb) => {
  mockSteps(sb, [
    FULL("s-1", "dup", "{ first: 1 }", "first();"),
    FULL("s-2", "dup", "{ second: 1 }", "second();"),
    FULL("s-3", "other", "{}", "o();"),
  ]);
  const r = await sb.run(["step", "pull", "-p", "out"]);
  // PINS SUSPECT BEHAVIOUR (known gap): one file is written per step *name*, so same-named
  // steps silently overwrite each other, yet the summary still reports all three steps.
  assert.deepEqual(sb.list("out"), ["dup.js", "other.js"]);
  assert.match(sb.read("out/dup.js"), /ID: s-2/);
  assert.match(sb.read("out/dup.js"), /second\(\);/);
  assert.doesNotMatch(sb.read("out/dup.js"), /first/);
  assert.match(r.stdout, /Successfully pulled 3 steps to:/);
}));

// SECURITY (was PINS SUSPECT BEHAVIOUR: names come from the server and were not sanitised, so
// "../escaped" was written outside the target folder). Unsafe names are skipped, the rest pulled.
test("SECURITY: step pull never writes outside the target folder", sandboxTest(async (sb) => {
  mockSteps(sb, [
    FULL("s-1", "../escaped", "{}", "x();"),
    FULL("s-2", "grp/../../escaped2", "{}", "x();"),
    FULL("s-3", "/abs/escaped3", "{}", "x();"),
    FULL("s-4", "a//b", "{}", "x();"),
    FULL("s-5", "..", "{}", "x();"),
    FULL("s-6", "grp\\..\\escaped4", "{}", "x();"),
    FULL("s-7", "ok/inside", "{}", "fine();"),
  ]);
  const r = await sb.run(["step", "pull", "-p", "out"]);
  for (const f of ["escaped.js", "escaped2.js", "out/escaped.js", "abs", "out/abs", "escaped4.js"]) {
    assert.equal(sb.exists(f), false, f);
  }
  assert.deepEqual(sb.list(), ["out"], "nothing next to the target folder");
  assert.deepEqual(sb.list("out"), ["ok"]);
  assert.match(sb.read("out/ok/inside.js"), /fine\(\);/);
  assert.equal((r.out.match(/Skipped step s-\d: unsafe name/g) || []).length, 6, r.out);
}));

test("SECURITY: step pull -s with an unsafe name writes nothing and says why", sandboxTest(async (sb) => {
  mockSteps(sb, [FULL("s-1", "../escaped", "{}", "x();")]);
  const r = await sb.run(["step", "pull", "-s", "s-1", "-p", "out"]);
  assert.equal(sb.exists("escaped.js"), false);
  assert.match(r.stderr, /Error pulling steps: unsafe step name/);
  assert.doesNotMatch(r.stdout, /Successfully pulled/);
}));

// SECURITY: a name or id cannot close the header comment and inject code at the top of the file.
// SECURITY: a name or id cannot close the header comment and inject code at the top of the file.
test("SECURITY: step pull: name and id cannot break out of the header comment", sandboxTest(async (sb) => {
  mockSteps(sb, [FULL("s-1 */\nglobalThis.pwnedId = 1;\n/*", "x*/ globalThis.pwned = 1; /* y", "{}", "x();")]);
  await sb.run(["step", "pull", "-p", "out"]);
  const file = "out/x*/ globalThis.pwned = 1; /* y.js";
  assert.ok(sb.exists(file), sb.list("out").join());
  const text = sb.read(file);
  const header = text.slice(0, text.indexOf("export const condition"));
  assert.equal(header.split("*/").length, 2, "only the header's own closing */");
  assert.doesNotMatch(text, /^globalThis\.pwned/m);
  assert.doesNotMatch(header.slice(0, -4), /\*\//, "no early end of the comment");
}));

test("SECURITY: step pull: a name with control characters (newlines) is skipped", sandboxTest(async (sb) => {
  mockSteps(sb, [FULL("s-1", "evil\nname", "{}", "x();")]);
  const r = await sb.run(["step", "pull", "-p", "out"]);
  assert.deepEqual(sb.list("out"), []);
  assert.match(r.out, /Skipped step s-1: unsafe name/);
}));

test("step pull: empty workspace, unknown step id, API error", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  let r = await sb.run(["step", "pull"]);
  assert.equal(r.stdout, "No steps found in workspace.\n");
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: null });
  r = await sb.run(["step", "pull", "-s", "nope"]);
  assert.equal(r.stdout, "Step with ID nope not found.\n");
  sb.api.on("LIST_STEPS_QUERY", gqlError("denied"));
  r = await sb.run(["step", "pull"]);
  assert.match(r.stderr, /Error pulling steps: denied/);
  assert.equal(r.code, 0);
}));

// -------------------------------------------------------------------- sync

test("step sync (all): updates matching names, creates the rest, after one y/N prompt", sandboxTest(async (sb) => {
  sb.write("src/alpha.js", stepFile("{ a: 1 }", "data.a = 2;"));
  sb.write("src/group/beta.js", stepFile("{ b: 1 }", "data.b = 2;"));
  sb.write("src/notes.txt", "ignored");
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [{ id: "s-1", name: "alpha" }] });
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-1", name: "alpha", enabled: false, version: 9, nocode_content: { n: 1 }, config_content: null } });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  const r = await sb.run(["step", "sync", "-p", "src"], { answers: [{ when: /\(y\/N\): /, send: "y\n" }] });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Are you sure you want to overwrite steps in the workspace with the contents of 2 file\(s\) from 'src'\? \(y\/N\): /);
  assert.match(r.stdout, /Successfully synced steps from: src\nUpdated: 1, Created: 1\n$/);
  const saves = sb.api.calls.filter((c) => c.op === "SAVE_STEP_MUTATION").map((c) => c.variables);
  // readdir order is not guaranteed, so look the saves up by id
  assert.equal(saves.length, 2);
  assert.deepEqual(saves.find((s) => s.id === "s-1"), { id: "s-1", name: "alpha", if: "{\n  a: 1\n}", do: "data.a = 2;", enabled: false, version: 9, nocode_content: { n: 1 }, config_content: null });
  assert.deepEqual(saves.find((s) => s.id === "s-new"), { id: "s-new", name: "group/beta", if: "{\n  b: 1\n}", do: "data.b = 2;", enabled: true, version: 0, nocode_content: null, config_content: null });
  assert.deepEqual(sb.api.calls.find((c) => c.op === "CREATE_STEP_MUTATION").variables, { name: "group/beta", environment_id: "ws-sel", nocode_type: null });
}));

test("step sync: answering anything but y/yes cancels without a request", sandboxTest(async (sb) => {
  sb.write("src/alpha.js", stepFile("{ a: 1 }", "data.a = 2;"));
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  for (const answer of ["n\n", "\n", "maybe\n"]) {
    const r = await sb.run(["step", "sync", "-p", "src"], { answers: [{ when: /\(y\/N\): /, send: answer }] });
    assert.match(r.stdout, /Sync cancelled by user\.\n$/);
  }
  assert.deepEqual(sb.api.ops(), ["LIST_STEPS_QUERY", "LIST_STEPS_QUERY", "LIST_STEPS_QUERY"]);
}));

test("step sync: 'yes' (any case) is accepted", sandboxTest(async (sb) => {
  sb.write("src/alpha.js", stepFile("{ a: 1 }", "data.a = 2;"));
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const r = await sb.run(["step", "sync", "-p", "src"], { answers: [{ when: /\(y\/N\): /, send: " YeS \n" }] });
  assert.match(r.stdout, /Updated: 0, Created: 1\n$/);
}));

test("step sync: missing folder and folder without .js files", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  let r = await sb.run(["step", "sync", "-p", "nowhere"]);
  assert.equal(r.stdout, "Workspace folder not found: nowhere\n");
  sb.write("empty/readme.md", "x");
  r = await sb.run(["step", "sync", "-p", "empty"]);
  assert.equal(r.stdout, "No .js step files found in workspace folder.\n");
}));

test("step sync: a file that fails to parse is reported by name and does not stop the others", sandboxTest(async (sb) => {
  sb.write("src/bad.js", "export const nothing = 1;\n");
  sb.write("src/good.js", stepFile("{ a: 1 }", "data.a = 2;"));
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const r = await sb.run(["step", "sync", "-p", "src"], { answers: [{ when: /\(y\/N\): /, send: "y\n" }] });
  assert.match(r.stdout, /Error creating step: bad\n/);
  assert.match(r.stdout, /Updated: 0, Created: 1\n$/);
}));

test("step sync: an update refused by the API is still counted as updated", sandboxTest(async (sb) => {
  sb.write("src/alpha.js", stepFile("{ a: 1 }", "data.a = 2;"));
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [{ id: "s-1", name: "alpha" }] });
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-1", name: "alpha", enabled: true, version: 1 } });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: false });
  const r = await sb.run(["step", "sync", "-p", "src"], { answers: [{ when: /\(y\/N\): /, send: "y\n" }] });
  // PINS SUSPECT BEHAVIOUR: "Failed to update" is a yellow warning, the summary still says Updated: 1.
  assert.match(r.stdout, /Failed to update step: alpha\n/);
  assert.match(r.stdout, /Updated: 1, Created: 0\n$/);
}));

test("step sync -s <id>: syncs one step from <path>/<last name segment>.js", sandboxTest(async (sb) => {
  sb.write("src/beta.js", stepFile("{ b: 1 }", "data.b = 2;"));
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-2", name: "group/beta", enabled: true, version: 5 } });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  // PINS SUSPECT BEHAVIOUR: with a nested name the file is looked up in src/group/beta.js.
  let r = await sb.run(["step", "sync", "-s", "s-2", "-p", "src"]);
  assert.match(r.stdout, /Step file not found: src\/group\/beta\.js\n$/);
  sb.write("src/group/beta.js", stepFile("{ b: 1 }", "data.b = 3;"));
  r = await sb.run(["step", "sync", "-s", "s-2", "-p", "src"], { answers: [{ when: /\(y\/N\): /, send: "y\n" }] });
  assert.match(r.stdout, /Are you sure you want to overwrite the step 'group\/beta' with the contents of 'src\/group\/beta\.js'\? \(y\/N\): /);
  assert.match(r.stdout, /Successfully synced step: group\/beta\n$/);
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    id: "s-2", name: "group/beta", if: "{\n  b: 1\n}", do: "data.b = 3;", enabled: true, version: 5,
  });
}));

test("step sync -s: unknown id", sandboxTest(async (sb) => {
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: null });
  sb.write("src/x.js", "");
  const r = await sb.run(["step", "sync", "-s", "nope", "-p", "src"]);
  assert.equal(r.stdout, "Step with ID nope not found.\n");
}));

test("step pull then sync round-trips: the pulled file is accepted and normalised", sandboxTest(async (sb) => {
  mockSteps(sb, [FULL("s-1", "alpha", "{ a: 1, }", "  data.a = 2;")]);
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  await sb.run(["step", "pull", "-p", "rt"]);
  const r = await sb.run(["step", "sync", "-p", "rt"], { answers: [{ when: /\(y\/N\): /, send: "y\n" }] });
  assert.match(r.stdout, /Updated: 1, Created: 0/);
  const v = sb.api.calls.at(-1).variables;
  assert.equal(v.if, "{\n  a: 1\n}");
  assert.equal(v.do, "data.a = 2;");
}));

// ---------------------------------------------------------------- generate

test("step generate: -f is required", sandboxTest(async (sb) => {
  const r = await sb.run(["step", "generate"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /required option '-f, --file <path>' not specified/);
}));

const GEN = (step, extra = {}) => ({ generateAutomationStep: { success: true, chatMessage: "done", step, ...extra } });

test("step generate: writes the generated step to the file, sends history on the next turn", sandboxTest(async (sb) => {
  sb.api.sequence(
    "GENERATE_STEP_MUTATION",
    GEN({ id: "s-g", name: "Gen", description: "does a thing", condition: { ready: true }, content: "data.ok = true;", chatMessage: "m" }),
    GEN({ name: "Gen2", condition: "{}", content: "data.two = true;" }, { chatMessage: "second" }),
  );
  const r = await sb.run(["step", "generate", "-f", "gen/out.js"], {
    answers: [
      { when: /You: /, send: "make a step\n" },
      { when: /You: /, send: "now change it\n" },
      { when: /You: /, send: "exit\n" },
    ],
  });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Creating new file: gen\/out\.js/);
  assert.match(r.stdout, /🤖 Assistant: done/);
  assert.match(r.stdout, /✓ Code written to gen\/out\.js/);
  assert.match(r.stdout, /Ending session\. Goodbye!/);
  const gens = sb.api.calls.filter((c) => c.op === "GENERATE_STEP_MUTATION").map((c) => c.variables);
  assert.deepEqual(gens[0], { userInput: "make a step", environmentId: "ws-sel", chatHistory: [] });
  assert.deepEqual(gens[1], {
    userInput: "now change it", environmentId: "ws-sel",
    chatHistory: [{ role: "user", content: "make a step" }, { role: "assistant", content: "done" }],
  });
  // second answer overwrote the file
  assert.equal(
    sb.read("gen/out.js"),
    "/**\n * Step: Gen2\n * Edit the condition and content below.\n * The condition should be a valid JavaScript object (trailing commas are allowed).\n * The content should be JavaScript code that will be executed.\n */\n\nexport const condition = {};\n\nexport const content = async () => {\ndata.two = true;\n};\n",
  );
}));

test("step generate: first result file layout (id, description, object condition as JSON)", sandboxTest(async (sb) => {
  sb.api.on("GENERATE_STEP_MUTATION", GEN({ id: "s-g", name: "Gen", description: "does a thing", condition: { ready: true }, content: "data.ok = true;" }));
  await sb.run(["step", "generate", "-f", "out.js"], { answers: [{ when: /You: /, send: "go\n" }, { when: /You: /, send: "quit\n" }] });
  assert.equal(
    sb.read("out.js"),
    '/**\n * Step: Gen\n * ID: s-g\n * does a thing\n *\n * Edit the condition and content below.\n * The condition should be a valid JavaScript object (trailing commas are allowed).\n * The content should be JavaScript code that will be executed.\n */\n\nexport const condition = {\n  "ready": true\n};\n\nexport const content = async () => {\ndata.ok = true;\n};\n',
  );
}));

test("step generate: a failed generation is reported and the file stays untouched; empty input ends the session", sandboxTest(async (sb) => {
  sb.write("out.js", "// mine\n");
  sb.api.on("GENERATE_STEP_MUTATION", { generateAutomationStep: { success: false, explanation: "too vague" } });
  const r = await sb.run(["step", "generate", "-f", "out.js"], { answers: [{ when: /You: /, send: "go\n" }, { when: /You: /, send: "\n" }] });
  assert.match(r.stdout, /Reading existing file: out\.js/);
  assert.match(r.stdout, /❌ Error: too vague/);
  assert.equal(sb.read("out.js"), "// mine\n");
  assert.equal(r.code, 0);
}));

test("step generate: API error is shown and the session continues", sandboxTest(async (sb) => {
  sb.api.on("GENERATE_STEP_MUTATION", gqlError("quota"));
  const r = await sb.run(["step", "generate", "-f", "out.js"], { answers: [{ when: /You: /, send: "go\n" }, { when: /You: /, send: "exit\n" }] });
  assert.match(r.stderr, /❌ Error: quota/);
  assert.match(r.stdout, /Goodbye!/);
  assert.equal(sb.exists("out.js"), false);
}));

// -------------------------------------------------------- shared behaviour

test("step commands without a selected workspace stop before any request", sandboxTest({ session: { token: "t" } }, async (sb) => {
  for (const args of [["list"], ["add", "x"], ["delete", "s"], ["edit", "s"], ["clone", "s"], ["pull"], ["sync"]]) {
    const r = await sb.run(["step", ...args]);
    assert.equal(r.stdout, "No workspace selected. Use `aloma workspace switch` to select one.\n", args.join(" "));
  }
  assert.deepEqual(sb.api.calls, []);
}));
