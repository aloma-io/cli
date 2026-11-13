// PLAT-78: the pure rules for a step file (src/resources/step-file.js): the condition and content
// are taken from the file as written, never re-printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readStepFile, findDollarOperator, stepContentHash } from "../src/resources/step-file.js";

const file = (cond, body) =>
  `/**\n * Step: x\n */\n\nexport const condition = ${cond};\n\nexport const content = async () => {\n${body}\n};\n`;

test("readStepFile: the condition and body are the exact bytes between the markers", () => {
  const cond = "{\n    a:   1,   // keep\n\t\"b\" : [1,2 ,3],\n  }";
  const body = "  data.x  =  1;\n\n  if (x) {   y(); }\n";
  assert.deepEqual(readStepFile(file(cond, body)), { condition: cond, content: body });
});

test("readStepFile: a pulled file reads back to exactly what the API returned", () => {
  for (const [c, d] of [["{}", ""], ["{ a: 1, }", "data.a = 2;"], ["{ a: { $in: [1] } }", "x();\n\ny();"]]) {
    assert.deepEqual(readStepFile(file(c, d)), { condition: c, content: d });
  }
});

test("readStepFile: a body that contains braces and a closing '};' line is kept whole", () => {
  const body = "const f = () => {\n  return 1;\n};\ndata.f = f();";
  assert.equal(readStepFile(file("{}", body)).content, body);
});

test("readStepFile: CRLF files keep their line endings inside the condition and body", () => {
  const text = "export const condition = {\r\n  a: 1\r\n};\r\n\r\nexport const content = async () => {\r\ndata.a = 1;\r\n};\r\n";
  assert.deepEqual(readStepFile(text), { condition: "{\r\n  a: 1\r\n}", content: "data.a = 1;" });
});

test("readStepFile: no condition or no content is refused by name of the part", () => {
  assert.throws(() => readStepFile("export const nothing = 1;\n"), /Could not parse condition from file/);
  assert.throws(() => readStepFile("export const condition = {};\n"), /Could not parse content from file/);
  assert.throws(() => readStepFile("export const condition = ;\n\nexport const content = async () => {\n};\n"), /Could not parse condition from file/);
});

test("findDollarOperator: a $ key in the condition is found, at any depth, quoted or not", () => {
  assert.equal(findDollarOperator("{ a: { $in: [1] } }"), "$in");
  assert.equal(findDollarOperator('{ "$or": [] }'), "$or");
  assert.equal(findDollarOperator("{ a: 1,\n  $gt : 3 }"), "$gt");
});

test("findDollarOperator: plain conditions and $ inside values pass", () => {
  assert.equal(findDollarOperator("{ a: 1, b: 'cost $5: ok' }"), null);
  assert.equal(findDollarOperator("{}"), null);
  assert.equal(findDollarOperator("{ price$: 1 }"), null);
});

test("stepContentHash: stable sha256 hex of the exact condition and content, sensitive to every byte", () => {
  const h = stepContentHash("{ a: 1 }", "x();");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, stepContentHash("{ a: 1 }", "x();"));
  assert.notEqual(h, stepContentHash("{ a: 1  }", "x();"));
  assert.notEqual(h, stepContentHash("{ a: 1 }", "x(); "));
  assert.notEqual(stepContentHash("ab", "c"), stepContentHash("a", "bc"));
});
