// PLAT-287: `step add -f` and `step edit` push the step code as written, and the condition check
// (validateAutomationIf) runs on exactly the condition text that is pushed.
// The engine check is a stub: it accepts a condition only when it is the text the user wrote, which is what
// the engine's rejection of a Babel-rewritten condition amounts to for this CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, canFakeOpen } from "./helpers/cli-harness.js";

const COND = "{\n  a: 1,   // keep me\n  b: 'x',\n}";
const BODY = "  const x = {a:1,\n  b:2};   // keep\n  data.x = 0x1F;";
const SOURCE = `export const condition = ${COND};\n\nexport const content = async () => {\n${BODY}\n};\n`;

const engineStub = (sb) => {
  sb.api.on("VALIDATE_IF_QUERY", (v) => ({ validateAutomationIf: v.content === COND }));
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
};
const calls = (sb, op) => sb.api.calls.filter((c) => c.op === op);

test("step add -f: the pushed condition and content are the file's text, byte for byte", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  engineStub(sb);
  sb.write("s.js", SOURCE);
  const r = await sb.run(["step", "add", "s", "-f", "s.js"]);
  assert.equal(r.code, 0);
  const [save] = calls(sb, "SAVE_STEP_MUTATION");
  assert.equal(save.variables.if, COND);
  assert.equal(save.variables.do, BODY);
}));

test("step add -f: validation runs on the text that is pushed", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  engineStub(sb);
  sb.write("s.js", SOURCE);
  const r = await sb.run(["step", "add", "s", "-f", "s.js"]);
  assert.equal(r.code, 0);
  const [check] = calls(sb, "VALIDATE_IF_QUERY");
  const [save] = calls(sb, "SAVE_STEP_MUTATION");
  assert.equal(check.variables.content, save.variables.if);
}));

test("step add -f: a condition the engine rejects is reported invalid and nothing is saved", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  engineStub(sb);
  sb.write("s.js", SOURCE.replace("// keep me", "// changed"));
  const r = await sb.run(["step", "add", "s", "-f", "s.js"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Condition is invalid, not a valid JSON object/);
  assert.equal(calls(sb, "SAVE_STEP_MUTATION").length, 0);
}));

test("step edit: the saved condition and content are the edited file's text, validated as pushed", { skip: !canFakeOpen && "needs the fake `open` (macOS only)" }, sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [{ id: "s-1", name: "orig" }] });
  sb.api.on("GET_STEP_QUERY", {
    getAutomationStep: { id: "s-1", name: "orig", enabled: true, version: 3, nocode_content: null, config_content: null,
      content: { if: COND, do: BODY } },
  });
  engineStub(sb);
  const script = sb.write("editor.mjs", `import fs from "node:fs"; const f = process.argv[2]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("0x1F", "0x2F"));\n`);
  const r = await sb.run(["step", "edit", "s-1"], { env: { TEST_EDITOR_SCRIPT: script } });
  assert.equal(r.code, 0);
  const [check] = calls(sb, "VALIDATE_IF_QUERY");
  const [save] = calls(sb, "SAVE_STEP_MUTATION");
  assert.equal(save.variables.if, COND);
  assert.equal(save.variables.do, BODY.replace("0x1F", "0x2F"));
  assert.equal(check.variables.content, save.variables.if);
}));

test("step add -f then show: a step the engine rejected in Babel's form is saved as written and reads back valid", sandboxTest(async (sb) => {
  let stored = null;
  sb.api.on("LIST_STEPS_QUERY", (v) => ({ listAutomationSteps: stored ? [{ id: "s-new", name: "s" }] : [] }));
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  sb.api.on("VALIDATE_IF_QUERY", (v) => ({ validateAutomationIf: v.content === COND }));
  sb.api.on("SAVE_STEP_MUTATION", (v) => { stored = { if: v.if, do: v.do }; return { saveAutomationStep: true }; });
  // The engine marks a step valid only when its stored condition is the text as written
  sb.api.on("GET_STEP_QUERY", () => ({ getAutomationStep: { id: "s-new", name: "s", enabled: true, version: 1, nocode_type: null, valid: stored.if === COND, content: stored } }));
  sb.write("s.js", SOURCE);
  assert.equal((await sb.run(["step", "add", "s", "-f", "s.js"])).code, 0);
  const r = await sb.run(["step", "show", "s-new"]);
  assert.match(r.stdout, /Valid: Yes/);
}));

test("step show: a step the engine marks invalid prints Valid: No", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [{ id: "s-1", name: "s" }] });
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-1", name: "s", enabled: true, version: 1, nocode_type: null, valid: false, content: { if: "{}", do: "x" } } });
  const r = await sb.run(["step", "show", "s-1"]);
  assert.match(r.stdout, /Valid: No/);
  assert.doesNotMatch(r.stdout, /Valid: Yes/);
}));

test("step add -f: a file with an empty content body fails naming the content and saves nothing", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  engineStub(sb);
  sb.write("s.js", `export const condition = ${COND};\nexport const content = async () => {\n};\n`);
  const r = await sb.run(["step", "add", "s", "-f", "s.js"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Could not parse content from file/);
  assert.equal(calls(sb, "SAVE_STEP_MUTATION").length, 0);
}));

test("step add -f: a file that does not parse fails and saves nothing", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  engineStub(sb);
  sb.write("s.js", "export const condition = ;\n");
  const r = await sb.run(["step", "add", "s", "-f", "s.js"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error parsing step file/);
  assert.equal(calls(sb, "SAVE_STEP_MUTATION").length, 0);
}));

test("step edit: a rejected condition exits non-zero and saves nothing", { skip: !canFakeOpen && "needs the fake `open` (macOS only)" }, sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [{ id: "s-1", name: "orig" }] });
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { id: "s-1", name: "orig", enabled: true, version: 3, nocode_content: null, config_content: null, content: { if: COND, do: BODY } } });
  engineStub(sb);
  const script = sb.write("editor.mjs", `import fs from "node:fs"; const f = process.argv[2]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("keep me", "changed"));\n`);
  const r = await sb.run(["step", "edit", "s-1"], { env: { TEST_EDITOR_SCRIPT: script } });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Condition is invalid/);
  assert.equal(calls(sb, "SAVE_STEP_MUTATION").length, 0);
}));
