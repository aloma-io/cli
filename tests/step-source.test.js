// PLAT-287: the condition and content of a step file are cut out of the file as written, never
// regenerated (Babel used to rewrite them), so what is validated and pushed is what the user wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitStepSource } from "../src/step-source.js";

const file = (cond, body) =>
  `/** header */\nexport const condition = ${cond};\n\nexport const content = async () => {\n${body}\n};\n`;

test("splitStepSource: condition is the exact text, comments, spacing and trailing comma kept", () => {
  const cond = "{\n  a: 1,   // keep me\n  b: 'x',\n}";
  const { condition } = splitStepSource(file(cond, "data.a = 2;"));
  assert.equal(condition, cond);
});

test("splitStepSource: content is the exact body, formatting and comments kept", () => {
  const body = "  const x = {a:1,\n  b:2};   // keep\n  return 0x1F;";
  const { content } = splitStepSource(file("{}", body));
  assert.equal(content, body);
});

test("splitStepSource: the content round trip is byte for byte, leading and trailing blanks included", () => {
  for (const body of ["x();", "\n  x();\n", "x();\n  ", "  indented();\r\n  more();"]) {
    assert.equal(splitStepSource(file("{}", body)).content, body, JSON.stringify(body));
  }
});

test("splitStepSource: an empty or blank content body is refused like before", () => {
  for (const body of ["", "   ", "\n\n"]) {
    assert.throws(() => splitStepSource(file("{}", body)), /Could not parse content from file/, JSON.stringify(body));
  }
});

test("splitStepSource: an indented closing brace is not part of the content", () => {
  const src = "export const condition = {};\nexport const content = async () => {\n  a();\n  };\n";
  assert.equal(splitStepSource(src).content, "  a();");
});

test("splitStepSource: a one-line body and an expression body are cut as written", () => {
  assert.equal(
    splitStepSource("export const condition = {};\nexport const content = async () => {  a( 1 );  };").content,
    "  a( 1 );  ",
  );
  assert.equal(
    splitStepSource("export const condition = {};\nexport const content = async () => a( 1 );").content,
    "a( 1 )",
  );
});

test("splitStepSource: a missing condition or content is named", () => {
  assert.throws(() => splitStepSource("export const nothing = 1;"), /Could not parse condition from file/);
  assert.throws(() => splitStepSource("export const condition = {};"), /Could not parse content from file/);
});

test("splitStepSource: source that is not JavaScript is refused", () => {
  assert.throws(() => splitStepSource("export const condition = ;"));
});
