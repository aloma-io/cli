// Regression tests for the step command's failure and edge paths (src/commands/step/index.js): edit with an
// unknown or unsaved step and its temporary folder, the edit template for a step with and without content,
// the Enabled / Disabled line of show, and the interactive generate command's usage, file and error paths.
// Offline: the API is the harness's local stub on 127.0.0.1; `open` is the editor stand-in of the harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sandboxTest } from "./helpers/cli-harness.js";

const HELPERS = path.join(path.dirname(new URL(import.meta.url).pathname), "helpers");
const hook = (name) => `--import ${pathToFileURL(path.join(HELPERS, name)).href}`;
const withEditor = [hook("preload-fetch.mjs"), hook("editor-open-hook.mjs")].join(" ");

const ok = { validateAutomationIf: true };
const LISTED = (...steps) => ({ listAutomationSteps: steps.map(([id, name]) => ({ id, name })) });
const calls = (sb, op) => sb.api.calls.filter((c) => c.op === op).map((c) => c.variables);

// An "editor" that records the file it is given (path and text) and leaves it unchanged.
function recordingEditor(sb) {
  const log = path.join(sb.root, "editor.log");
  const script = sb.write(
    "editor.mjs",
    `import fs from "node:fs"; const f = process.argv[2];
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ file: f, text: fs.readFileSync(f, "utf8") }) + "\\n");\n`,
  );
  return {
    env: { NODE_OPTIONS: withEditor, TEST_EDITOR_SCRIPT: script },
    opened: () =>
      fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [],
  };
}

const mockStep = (sb, step) => {
  sb.api.on("LIST_STEPS_QUERY", LISTED([step.id, step.name]));
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: step });
  sb.api.on("VALIDATE_IF_QUERY", ok);
};

// ---------------------------------------------------------------- step edit

test("step edit: an id the API does not know is reported; no editor, no update", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", LISTED(["s-1", "orig"]));
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: null });
  const ed = recordingEditor(sb);
  const r = await sb.run(["step", "edit", "s-1"], { env: ed.env });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Step with ID s-1 not found.\n");
  assert.equal(r.stdout, "");
  assert.deepEqual(ed.opened(), []);
  assert.ok(!sb.api.ops().includes("SAVE_STEP_MUTATION"));
}));

test("step edit: the update refused by the API is reported, and the temporary folder is gone", sandboxTest(async (sb) => {
  mockStep(sb, { id: "s-1", name: "orig", enabled: true, version: 1, content: { if: "{}", do: "x" } });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: false });
  const ed = recordingEditor(sb);
  const r = await sb.run(["step", "edit", "s-1"], { env: ed.env });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Failed to update step: orig\n");
  assert.equal(r.stdout, "Opening editor for step: orig\n");
  assert.equal(calls(sb, "SAVE_STEP_MUTATION").length, 1);
  const [{ file }] = ed.opened();
  assert.equal(path.basename(file), "orig.js");
  assert.equal(fs.existsSync(path.dirname(file)), false);
}));

test("step edit: after a saved update the temporary folder is gone", sandboxTest(async (sb) => {
  mockStep(sb, { id: "s-1", name: "orig", enabled: true, version: 1, content: { if: "{}", do: "x" } });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const ed = recordingEditor(sb);
  const r = await sb.run(["step", "edit", "s-1"], { env: ed.env });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "Opening editor for step: orig\nSuccessfully updated step: orig\n");
  const [{ file }] = ed.opened();
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.dirname(file)), false);
}));

// A preload for the child only: removing the edit's temporary folder fails; every other removal is the real one.
const failingRemoval = (sb) =>
  pathToFileURL(
    sb.write(
      "failing-removal.mjs",
      `import fsp from "node:fs/promises";
const realRm = fsp.rm;
fsp.rm = async (target, ...rest) => {
  if (String(target).includes("aloma-step-")) throw new Error("not removable");
  return realRm(target, ...rest);
};\n`,
    ),
  ).href;

test("step edit: a temporary folder that cannot be removed only warns; a saved edit still exits 0", sandboxTest(async (sb) => {
  mockStep(sb, { id: "s-1", name: "orig", enabled: true, version: 1, content: { if: "{}", do: "x" } });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const ed = recordingEditor(sb);
  const env = { ...ed.env, NODE_OPTIONS: `${ed.env.NODE_OPTIONS} --import ${failingRemoval(sb)}` };
  const r = await sb.run(["step", "edit", "s-1"], { env });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "Opening editor for step: orig\nSuccessfully updated step: orig\n");
  assert.equal(r.stderr, "Warning: Could not delete temporary file: not removable\n");
}));

test("step edit: a temporary folder that cannot be removed only warns; a refused update still exits 1", sandboxTest(async (sb) => {
  mockStep(sb, { id: "s-1", name: "orig", enabled: true, version: 1, content: { if: "{}", do: "x" } });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: false });
  const ed = recordingEditor(sb);
  const env = { ...ed.env, NODE_OPTIONS: `${ed.env.NODE_OPTIONS} --import ${failingRemoval(sb)}` };
  const r = await sb.run(["step", "edit", "s-1"], { env });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^Warning: Could not delete temporary file: not removable$/m);
  assert.match(r.stderr, /^Failed to update step: orig$/m);
}));

test("step edit: a step without content starts from the default condition and an empty body", sandboxTest(async (sb) => {
  mockStep(sb, { id: "s-1", name: "empty", enabled: true, version: 0, content: null });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const ed = recordingEditor(sb);
  const r = await sb.run(["step", "edit", "s-1"], { env: ed.env });
  // an edit that adds no code is refused today: the empty body cannot be saved
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Could not parse content from file/);
  assert.ok(!sb.api.ops().includes("SAVE_STEP_MUTATION"));
  const [{ text }] = ed.opened();
  assert.ok(text.includes(" * Step: empty\n * ID: s-1\n"));
  assert.ok(text.endsWith("export const condition = {};\n\n\nexport const content = async () => {\n\n};\n"));
}));

test("step edit: a step whose condition is empty text also starts from the default condition", sandboxTest(async (sb) => {
  mockStep(sb, { id: "s-1", name: "blank", enabled: true, version: 0, content: { if: "", do: "" } });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const ed = recordingEditor(sb);
  await sb.run(["step", "edit", "s-1"], { env: ed.env });
  assert.ok(ed.opened()[0].text.endsWith("export const condition = {};\n\n\nexport const content = async () => {\n\n};\n"));
}));

test("step edit: a step with content gets its condition and body unchanged", sandboxTest(async (sb) => {
  mockStep(sb, { id: "s-1", name: "full", enabled: true, version: 2, content: { if: "{ a: 1 }", do: "data.old = 1;" } });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const ed = recordingEditor(sb);
  await sb.run(["step", "edit", "s-1"], { env: ed.env });
  assert.ok(ed.opened()[0].text.endsWith("export const condition = { a: 1 };\n\n\nexport const content = async () => {\ndata.old = 1;\n};\n"));
}));

// ---------------------------------------------------------------- step show

test("step show: an enabled step prints Enabled, a disabled one prints Disabled", sandboxTest(async (sb) => {
  const step = { id: "s-1", name: "first", valid: true, version: 1, nocode_type: null, content: null };
  sb.api.on("LIST_STEPS_QUERY", LISTED(["s-1", "first"]));
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { ...step, enabled: true } });
  let r = await sb.run(["step", "show", "s-1"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Status: Enabled$/m);
  assert.doesNotMatch(r.stdout, /Disabled/);
  sb.api.on("GET_STEP_QUERY", { getAutomationStep: { ...step, enabled: false, valid: false } });
  r = await sb.run(["step", "show", "s-1"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Status: Disabled$/m);
  assert.match(r.stdout, /^Valid: No$/m);
  assert.doesNotMatch(r.stdout, /Enabled/);
}));

// ------------------------------------------------------------ step generate

const ask = (...lines) => lines.map((send) => ({ when: /You: /, send }));
const GEN = (step, extra = {}) => ({ generateAutomationStep: { success: true, chatMessage: "done", step, ...extra } });

test("step generate: an empty file path is a usage error (exit 2)", sandboxTest(async (sb) => {
  const r = await sb.run(["step", "generate", "-f", ""]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr, "⚠ Please provide a file path with -f or --file\n");
  assert.deepEqual(sb.api.calls, []);
}));

test("step generate: a file that does not exist is created and announced", sandboxTest(async (sb) => {
  sb.api.on("GENERATE_STEP_MUTATION", GEN({ name: "Gen", condition: "{}", content: "data.ok = true;" }));
  const r = await sb.run(["step", "generate", "-f", "fresh.js"], { answers: ask("go\n", "exit\n") });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Creating new file: fresh\.js$/m);
  assert.doesNotMatch(r.stdout, /Reading existing file/);
  assert.ok(sb.exists("fresh.js"));
}));

test("step generate: a file path that cannot be read (a folder) is reported, exit 1, no request", sandboxTest(async (sb) => {
  fs.mkdirSync(path.join(sb.work, "folder"));
  const r = await sb.run(["step", "generate", "-f", "folder"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^Error in step generation: EISDIR/);
  assert.doesNotMatch(r.stdout, /Creating new file|Reading existing file|Starting interactive/);
  assert.deepEqual(sb.api.calls, []);
}));

test("step generate: success false without an explanation prints the default error line", sandboxTest(async (sb) => {
  sb.api.on("GENERATE_STEP_MUTATION", { generateAutomationStep: { success: false } });
  const r = await sb.run(["step", "generate", "-f", "out.js"], { answers: ask("go\n", "exit\n") });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^❌ Error: Failed to generate step$/m);
  assert.equal(sb.exists("out.js"), false);
}));

test("step generate: success false with an explanation prints it", sandboxTest(async (sb) => {
  sb.api.on("GENERATE_STEP_MUTATION", { generateAutomationStep: { success: false, explanation: "too vague" } });
  const r = await sb.run(["step", "generate", "-f", "out.js"], { answers: ask("go\n", "exit\n") });
  assert.match(r.stdout, /^❌ Error: too vague$/m);
  assert.doesNotMatch(r.stdout, /Failed to generate step/);
}));

test("step generate: an answer without a chat message adds the default assistant message to the history", sandboxTest(async (sb) => {
  sb.api.sequence(
    "GENERATE_STEP_MUTATION",
    GEN({ name: "Gen", condition: "{}", content: "data.one = true;" }, { chatMessage: undefined }),
    { generateAutomationStep: { success: false } },
    GEN({ name: "Gen", condition: "{}", content: "data.two = true;" }),
  );
  const r = await sb.run(["step", "generate", "-f", "out.js"], { answers: ask("one\n", "two\n", "three\n", "exit\n") });
  assert.equal(r.code, 0);
  const gens = calls(sb, "GENERATE_STEP_MUTATION");
  assert.equal(gens.length, 3);
  assert.deepEqual(gens[1].chatHistory, [
    { role: "user", content: "one" },
    { role: "assistant", content: "I've generated a step based on your request." },
  ]);
  // a refused request also leaves a default assistant message behind
  assert.deepEqual(gens[2].chatHistory.slice(2), [
    { role: "user", content: "two" },
    { role: "assistant", content: "I encountered an error generating the step." },
  ]);
}));
