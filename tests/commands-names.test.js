// PLAT-115: step and library names are unique per workspace. Every command that takes a step or library
// by id or name resolves it with one resolver (src/names.js): an exact id first, then an exact name in the
// workspace. More than one name match is refused with the ids listed, no match is refused, and the name
// is never sent on as an id. `add` refuses a name that already exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, canFakeOpen } from "./helpers/cli-harness.js";

const ok = { validateAutomationIf: true };
const stepFile = (cond, body) =>
  `export const condition = ${cond};\n\nexport const content = async () => {\n${body}\n};\n`;
const libFile = (types, body) =>
  `export const types = () => {\n  return \`${types}\`;\n};\n\nexport const content = () => {\n${body}\n};\n`;
const YES = [{ when: /\(y\/N\): /, send: "y\n" }];

const STEPS = [
  { id: "s-1", name: "dup", enabled: true, version: 1, content: { if: "{}", do: "a();" } },
  { id: "s-2", name: "dup", enabled: true, version: 1, content: { if: "{}", do: "b();" } },
  { id: "s-3", name: "solo", enabled: true, version: 1, content: { if: "{}", do: "c();" } },
];
const LIBS = [
  { id: "l-1", name: "dup", namespace: "dup", enabled: true, version: 1, tags: [], types: "T", content: { content: "a();" } },
  { id: "l-2", name: "dup", namespace: "dup", enabled: true, version: 1, tags: [], types: "T", content: { content: "b();" } },
  { id: "l-3", name: "solo", namespace: "solo", enabled: true, version: 1, tags: [], types: "T", content: { content: "c();" } },
];

// The fake workspace "ws-sel" holds `steps`; other workspaces are empty.
const mockSteps = (sb, steps = STEPS) => {
  sb.api.on("LIST_STEPS_QUERY", (v) => ({
    listAutomationSteps: v.id === "ws-sel" ? steps.map(({ id, name }) => ({ id, name })) : [],
  }));
  sb.api.on("GET_STEP_QUERY", (v) => ({ getAutomationStep: steps.find((s) => s.id === v.id) ?? null }));
  sb.api.on("DELETE_STEP_MUTATION", { deleteAutomationStep: true });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  sb.api.on("VALIDATE_IF_QUERY", ok);
};
const mockLibs = (sb, libs = LIBS) => {
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", (v) => ({
    listAutomationLibs: v.id === "ws-sel" ? libs.map(({ id, name }) => ({ id, name })) : [],
  }));
  sb.api.on("GET_AUTOMATION_LIB_QUERY", (v) => ({ getAutomationLib: libs.find((l) => l.id === v.id) ?? null }));
  sb.api.on("REMOVE_AUTOMATION_LIB_MUTATION", { deleteAutomationLib: true });
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "l-new" });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
};

const opIds = (sb, op) => sb.api.calls.filter((c) => c.op === op).map((c) => c.variables.id);
const sentAsId = (sb, ref) => sb.api.calls.some((c) => c.variables?.id === ref);
const WRITES = ["DELETE_STEP_MUTATION", "CREATE_STEP_MUTATION", "SAVE_STEP_MUTATION",
  "REMOVE_AUTOMATION_LIB_MUTATION", "ADD_AUTOMATION_LIB_MUTATION", "UPDATE_AUTOMATION_LIB_MUTATION"];
const wrote = (sb) => sb.api.calls.some((c) => WRITES.includes(c.op));

function assertAmbiguous(r, kind, ids) {
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, new RegExp(`${kind} name "dup" is ambiguous`));
  assert.match(r.stderr, new RegExp(ids.join(", ")));
  assert.match(r.stderr, /use the id/i);
}
function assertNoMatch(r, kind, ref) {
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, new RegExp(`No ${kind} with the id or name "${ref}" in this workspace`));
}

// -------------------------------------------------------------------- steps

test("PLAT-115 step show: two steps with the name are refused, the ids listed, nothing fetched", sandboxTest(async (sb) => {
  mockSteps(sb);
  const r = await sb.run(["step", "show", "dup"]);
  assertAmbiguous(r, "step", ["s-1", "s-2"]);
  assert.deepEqual(opIds(sb, "GET_STEP_QUERY"), []);
}));

test("PLAT-115 step show: an id works, a unique name works", sandboxTest(async (sb) => {
  mockSteps(sb);
  let r = await sb.run(["step", "show", "s-2"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /ID: s-2/);
  r = await sb.run(["step", "show", "solo"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Name: solo\nID: s-3/);
  assert.deepEqual(opIds(sb, "GET_STEP_QUERY"), ["s-2", "s-3"]);
}));

test("PLAT-115 step show: no match is refused and the name is never sent as an id", sandboxTest(async (sb) => {
  mockSteps(sb);
  const r = await sb.run(["step", "show", "nope"]);
  assertNoMatch(r, "step", "nope");
  assert.equal(sentAsId(sb, "nope"), false);
}));

test("PLAT-115 step delete: ambiguous and unknown names delete nothing; a unique name deletes its id", sandboxTest(async (sb) => {
  mockSteps(sb);
  let r = await sb.run(["step", "delete", "dup"]);
  assertAmbiguous(r, "step", ["s-1", "s-2"]);
  r = await sb.run(["step", "delete", "nope"]);
  assertNoMatch(r, "step", "nope");
  assert.equal(wrote(sb), false);
  assert.equal(sentAsId(sb, "nope"), false);
  r = await sb.run(["step", "delete", "solo"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(opIds(sb, "DELETE_STEP_MUTATION"), ["s-3"]);
}));

test("PLAT-115 step edit: ambiguous and unknown names are refused before any editor opens", sandboxTest(async (sb) => {
  mockSteps(sb);
  let r = await sb.run(["step", "edit", "dup"]);
  assertAmbiguous(r, "step", ["s-1", "s-2"]);
  r = await sb.run(["step", "edit", "nope"]);
  assertNoMatch(r, "step", "nope");
  assert.equal(wrote(sb), false);
  assert.equal(sentAsId(sb, "nope"), false);
  assert.deepEqual(sb.openCalls(), []);
}));

test("PLAT-115 step edit: a unique name edits that step", { skip: !canFakeOpen && "needs the fake `open` (macOS only)" }, sandboxTest(async (sb) => {
  mockSteps(sb);
  const r = await sb.run(["step", "edit", "solo"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(opIds(sb, "SAVE_STEP_MUTATION"), ["s-3"]);
}));

test("PLAT-115 step clone: ambiguous source refused; a unique name clones; a name taken in the target is refused", sandboxTest(async (sb) => {
  mockSteps(sb);
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [{ id: "ws-2", name: "Two" }] });
  let r = await sb.run(["step", "clone", "dup", "-w", "ws-2"]);
  assertAmbiguous(r, "step", ["s-1", "s-2"]);
  assert.equal(wrote(sb), false);
  r = await sb.run(["step", "clone", "nope", "-w", "ws-2"]);
  assertNoMatch(r, "step", "nope");
  assert.equal(sentAsId(sb, "nope"), false);
  r = await sb.run(["step", "clone", "solo"]); // into its own workspace: the name is taken
  assert.equal(r.code, 1);
  assert.match(r.stderr, /A step named "solo" already exists in this workspace \(id: s-3\)/);
  assert.equal(wrote(sb), false);
  r = await sb.run(["step", "clone", "solo", "-w", "ws-2"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(sb.api.calls.find((c) => c.op === "CREATE_STEP_MUTATION").variables,
    { name: "solo", environment_id: "ws-2" });
}));

test("PLAT-115 step pull -s / sync -s: resolved by id or unique name; ambiguity refused", sandboxTest(async (sb) => {
  mockSteps(sb);
  let r = await sb.run(["step", "pull", "-s", "dup", "-p", "out"]);
  assertAmbiguous(r, "step", ["s-1", "s-2"]);
  r = await sb.run(["step", "pull", "-s", "nope", "-p", "out"]);
  assertNoMatch(r, "step", "nope");
  assert.equal(sentAsId(sb, "nope"), false);
  r = await sb.run(["step", "pull", "-s", "solo", "-p", "out"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(sb.exists("out/solo.js"));
  r = await sb.run(["step", "sync", "-s", "dup", "-p", "out"], { answers: YES });
  assertAmbiguous(r, "step", ["s-1", "s-2"]);
  // PLAT-118 (B5): a file equal to the stored step is not saved, so the pulled file is edited first.
  sb.write("out/solo.js", stepFile("{ edited: 1 }", "edited();"));
  r = await sb.run(["step", "sync", "-s", "solo", "-p", "out"], { answers: YES });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(opIds(sb, "SAVE_STEP_MUTATION"), ["s-3"]);
}));

test("PLAT-115 step sync (all): a file whose name two steps share updates neither and fails the run", sandboxTest(async (sb) => {
  mockSteps(sb);
  sb.write("src/dup.js", stepFile("{ x: 1 }", "x();"));
  sb.write("src/solo.js", stepFile("{ y: 1 }", "y();"));
  const r = await sb.run(["step", "sync", "-p", "src"], { answers: YES });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /step name "dup" is ambiguous.*s-1, s-2/);
  assert.match(r.stderr, /Updated: 1, Created: 0, Failed: 1/);
  assert.deepEqual(opIds(sb, "SAVE_STEP_MUTATION"), ["s-3"]);
  assert.equal(sb.api.calls.some((c) => c.op === "CREATE_STEP_MUTATION"), false);
}));

test("PLAT-115 step sync (all): file names are matched by name only, never by id", sandboxTest(async (sb) => {
  mockSteps(sb);
  sb.write("src/s-3.js", stepFile("{ y: 1 }", "y();"));
  const r = await sb.run(["step", "sync", "-p", "src"], { answers: YES });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Updated: 0, Created: 1/);
}));

test("PLAT-115 step pull (all): steps sharing a name are not written and fail the run; the rest are pulled", sandboxTest(async (sb) => {
  mockSteps(sb);
  const r = await sb.run(["step", "pull", "-p", "out"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /step name "dup" is ambiguous.*s-1, s-2/);
  assert.deepEqual(sb.list("out"), ["solo.js"]);
}));

test("PLAT-115 step add: an existing name is refused, nothing is created; a new name is created", sandboxTest(async (sb) => {
  mockSteps(sb);
  let r = await sb.run(["step", "add", " solo "]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /A step named "solo" already exists in this workspace \(id: s-3\)\. Names are unique per workspace\./);
  r = await sb.run(["step", "add", "dup"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /A step named "dup" already exists in this workspace \(ids: s-1, s-2\)/);
  assert.equal(wrote(sb), false);
  r = await sb.run(["step", "add", "fresh"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Created step \[fresh\] with ID: s-new/);
}));

// ---------------------------------------------------------------- libraries

test("PLAT-115 library show: ambiguous refused with ids; id and unique name work; no match refused", sandboxTest(async (sb) => {
  mockLibs(sb);
  let r = await sb.run(["library", "show", "dup"]);
  assertAmbiguous(r, "library", ["l-1", "l-2"]);
  r = await sb.run(["library", "show", "nope"]);
  assertNoMatch(r, "library", "nope");
  assert.equal(sentAsId(sb, "nope"), false);
  r = await sb.run(["library", "show", "l-1"]);
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run(["library", "show", "solo"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(opIds(sb, "GET_AUTOMATION_LIB_QUERY"), ["l-1", "l-3"]);
}));

test("PLAT-115 library update / delete: ambiguous and unknown refused; unique name acts on its id", sandboxTest(async (sb) => {
  mockLibs(sb);
  for (const cmd of ["update", "delete"]) {
    let r = await sb.run(["library", cmd, "dup"]);
    assertAmbiguous(r, "library", ["l-1", "l-2"]);
    r = await sb.run(["library", cmd, "nope"]);
    assertNoMatch(r, "library", "nope");
  }
  assert.equal(wrote(sb), false);
  assert.equal(sentAsId(sb, "nope"), false);
  let r = await sb.run(["library", "update", "solo", "-n", "ns2"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(opIds(sb, "UPDATE_AUTOMATION_LIB_MUTATION"), ["l-3"]);
  r = await sb.run(["library", "delete", "solo"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(opIds(sb, "REMOVE_AUTOMATION_LIB_MUTATION"), ["l-3"]);
}));

test("PLAT-115 library pull -l / sync -l: resolved by unique name; ambiguity refused", sandboxTest(async (sb) => {
  mockLibs(sb);
  let r = await sb.run(["library", "pull", "-l", "dup", "-p", "out"]);
  assertAmbiguous(r, "library", ["l-1", "l-2"]);
  r = await sb.run(["library", "pull", "-l", "nope", "-p", "out"]);
  assertNoMatch(r, "library", "nope");
  assert.equal(sentAsId(sb, "nope"), false);
  r = await sb.run(["library", "pull", "-l", "solo", "-p", "out"]);
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run(["library", "sync", "-l", "dup", "-p", "out"], { answers: YES });
  assertAmbiguous(r, "library", ["l-1", "l-2"]);
  // PLAT-118 (B5): a file equal to the stored library is not saved, so the pulled file is edited first.
  sb.write("out/solo.js", libFile("T2", "edited();"));
  r = await sb.run(["library", "sync", "-l", "solo", "-p", "out"], { answers: YES });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(opIds(sb, "UPDATE_AUTOMATION_LIB_MUTATION"), ["l-3"]);
}));

test("PLAT-115 library sync / pull (all): a shared name is refused, the rest go through, exit 1", sandboxTest(async (sb) => {
  mockLibs(sb);
  sb.write("src/dup.js", libFile("T", "x();"));
  sb.write("src/solo.js", libFile("T", "y();"));
  let r = await sb.run(["library", "sync", "-p", "src"], { answers: YES });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /library name "dup" is ambiguous.*l-1, l-2/);
  assert.deepEqual(opIds(sb, "UPDATE_AUTOMATION_LIB_MUTATION"), ["l-3"]);
  assert.equal(sb.api.calls.some((c) => c.op === "ADD_AUTOMATION_LIB_MUTATION"), false);
  r = await sb.run(["library", "pull", "-p", "out"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /library name "dup" is ambiguous.*l-1, l-2/);
  assert.deepEqual(sb.list("out"), ["solo.js"]);
}));

test("PLAT-115 library add: an existing name is refused, nothing is created", sandboxTest(async (sb) => {
  mockLibs(sb);
  let r = await sb.run(["library", "add", "solo", "ns"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /A library named "solo" already exists in this workspace \(id: l-3\)\. Names are unique per workspace\./);
  assert.equal(wrote(sb), false);
  r = await sb.run(["library", "add", "fresh", "ns"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Created library \[fresh\] with ID: l-new/);
}));

// ------------------------------------------------------------------- deploy

test("PLAT-115 deploy: an ambiguous step or library entry fails the deployment, exit 1", sandboxTest(async (sb) => {
  mockSteps(sb);
  mockLibs(sb);
  sb.write("s.js", stepFile("{ a: 1 }", "a();"));
  sb.write("l.js", libFile("T", "l();"));
  sb.write("d.yaml", [
    "workspaces:", "  - name: Sel",
    "    steps:", "      - name: dup", "        file: s.js", "      - name: fresh", "        file: s.js",
    "    libraries:", "      - name: dup", "        file: l.js",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [{ id: "ws-sel", name: "Sel" }] });
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.stdout, /completed successfully/);
  // Flipped (PLAT-118, B1): deploy finds by name (ensure) instead of adding, so two matches are an ambiguous
  // name, not a taken one (was "A step named "dup" already exists ...").
  assert.match(r.stderr, /The step name "dup" is ambiguous in this workspace \(ids: s-1, s-2\)\. Use the id\./);
  assert.match(r.stderr, /The library name "dup" is ambiguous in this workspace \(ids: l-1, l-2\)\. Use the id\./);
  assert.match(r.stderr, /Deployment failed: 2 item\(s\) could not be deployed/);
  // the unambiguous new entry is still deployed
  assert.deepEqual(sb.api.calls.filter((c) => c.op === "CREATE_STEP_MUTATION").map((c) => c.variables.name), ["fresh"]);
}));
