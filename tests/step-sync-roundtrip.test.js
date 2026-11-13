// PLAT-78: `step sync` / `add -f` end to end: exact bytes in and out, unchanged steps skipped by
// content_hash, and a `$` condition reported by name before anything is written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest } from "./helpers/cli-harness.js";
import { stepContentHash } from "../src/resources/step-file.js";

const ok = { validateAutomationIf: true };
const yes = { answers: [{ when: /\(y\/N\): /, send: "y\n" }] };
const stepFile = (cond, body) =>
  `export const condition = ${cond};\n\nexport const content = async () => {\n${body}\n};\n`;
const STEP = (id, name, ifs, dos, extra = {}) => ({
  id, name, enabled: true, version: 4, nocode_content: null, config_content: null,
  content: { if: ifs, do: dos }, ...extra,
});
const mock = (sb, steps) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: steps.map((s) => ({ id: s.id, name: s.name })) });
  sb.api.on("GET_STEP_QUERY", (v) => ({ getAutomationStep: steps.find((s) => s.id === v.id) ?? null }));
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
};
const saves = (sb) => sb.api.calls.filter((c) => c.op === "SAVE_STEP_MUTATION").map((c) => c.variables);

const ODD = "{\n    a:   1,   // odd\n\t\"b\" : [1,2 ,3],\n  }";

test("step sync: a condition with unusual formatting is sent byte for byte", sandboxTest(async (sb) => {
  mock(sb, [STEP("s-1", "alpha", "{}", "")]);
  sb.write("src/alpha.js", stepFile(ODD, "  data.x  =  1;"));
  const r = await sb.run(["step", "sync", "-p", "src"], yes);
  assert.equal(r.code, 0);
  assert.equal(saves(sb)[0].if, ODD);
  assert.equal(saves(sb)[0].do, "  data.x  =  1;");
}));

test("step add -f: the condition and content are sent byte for byte", sandboxTest(async (sb) => {
  mock(sb, []);
  sb.write("s.js", stepFile(ODD, "  data.x  =  1;\n"));
  const r = await sb.run(["step", "add", "s", "-f", "s.js"]);
  assert.equal(r.code, 0);
  assert.equal(saves(sb)[0].if, ODD);
  assert.equal(saves(sb)[0].do, "  data.x  =  1;\n");
}));

test("step pull then sync: an odd condition survives the round trip with no save", sandboxTest(async (sb) => {
  mock(sb, [STEP("s-1", "alpha", ODD, "  data.a  =  2;")]);
  await sb.run(["step", "pull", "-p", "rt"]);
  const r = await sb.run(["step", "sync", "-p", "rt"], yes);
  assert.equal(r.code, 0);
  assert.equal(saves(sb).length, 0);
  assert.match(r.stdout, /Unchanged: 1/);
}));

test("step sync: N unchanged steps (same content_hash) make zero save calls", sandboxTest(async (sb) => {
  const steps = [1, 2, 3, 4].map((n) => {
    const s = STEP(`s-${n}`, `st${n}`, `{ n: ${n} }`, `data.n = ${n};`);
    // the stored text differs in layout from the file; the API's hash says it is the same content
    s.content_hash = stepContentHash(`{   n:${n}   }`, `data.n = ${n};  `);
    sb.write(`src/st${n}.js`, stepFile(`{   n:${n}   }`, `data.n = ${n};  `));
    return s;
  });
  mock(sb, steps);
  const r = await sb.run(["step", "sync", "-p", "src"], yes);
  assert.equal(r.code, 0);
  assert.equal(saves(sb).length, 0);
  assert.match(r.stdout, /Updated: 0, Created: 0, Unchanged: 4/);
}));

test("step sync: a step whose content_hash differs is saved, an unchanged one is not", sandboxTest(async (sb) => {
  const same = STEP("s-1", "same", "{ a: 1 }", "x();", { content_hash: stepContentHash("{ a: 1 }", "x();") });
  const diff = STEP("s-2", "diff", "{ a: 1 }", "x();", { content_hash: stepContentHash("{ a: 1 }", "x();") });
  mock(sb, [same, diff]);
  sb.write("src/same.js", stepFile("{ a: 1 }", "x();"));
  sb.write("src/diff.js", stepFile("{ a: 1 }", "y();"));
  const r = await sb.run(["step", "sync", "-p", "src"], yes);
  assert.equal(r.code, 0);
  assert.deepEqual(saves(sb).map((v) => v.name), ["diff"]);
}));

test("step sync: a $ condition is reported by name before any write; valid steps are not half written", sandboxTest(async (sb) => {
  mock(sb, [STEP("s-1", "good", "{}", ""), STEP("s-2", "bad", "{}", "")]);
  sb.write("src/a-good.js", stepFile("{ a: 1 }", "x();"));
  sb.write("src/bad.js", stepFile("{ a: { $in: [1] } }", "x();"));
  sb.write("src/new-one.js", stepFile("{ n: 1 }", "x();"));
  sb.write("src/z-also-bad.js", stepFile("{ $or: [] }", "x();"));
  const r = await sb.run(["step", "sync", "-p", "src"], yes);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /bad: .*\$in/);
  assert.match(r.stderr, /z-also-bad: .*\$or/);
  assert.equal(saves(sb).length, 0);
  assert.equal(sb.api.calls.filter((c) => c.op === "CREATE_STEP_MUTATION").length, 0);
}));

test("step sync -s: a $ condition is refused by name, nothing saved", sandboxTest(async (sb) => {
  mock(sb, [STEP("s-1", "bad", "{}", "")]);
  sb.write("src/bad.js", stepFile("{ a: { $gt: 1 } }", "x();"));
  const r = await sb.run(["step", "sync", "-s", "bad", "-p", "src"], yes);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /bad: .*\$gt/);
  assert.equal(saves(sb).length, 0);
}));
