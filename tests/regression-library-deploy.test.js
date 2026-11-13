// Regression tests: the library and step file parsers, the library resource defaults and the entry
// checks of `aloma deploy`. Parser tests run in process on files in a temp folder; deploy tests use the sandbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sandboxTest, gqlError } from "./helpers/cli-harness.js";
import { parseLibraryFile, libraryResource } from "../src/resources/library.js";
import { parseStepFile } from "../src/resources/step.js";

const WS = (...names) => ({ listAutomationEnvironmentWithStats: names.map(([id, name]) => ({ id, name })) });
const FAILED_1 = /Deployment failed: 1 item\(s\) could not be deployed\.\n$/;

// Write `text` to a file in a fresh temp folder, hand its path to `fn`, remove the folder afterwards.
async function withFile(text, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-parse-"));
  try {
    const file = path.join(dir, "file.js");
    fs.writeFileSync(file, text);
    return await fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- library file parser

test("library parser: a block body takes its statements joined by new lines", async () => {
  const text = 'export const types = () => {\n  return "declare x: 1;";\n};\nexport const content = () => {\n  const a = 1;\n  const b = 2;\n};\n';
  const parsed = await withFile(text, parseLibraryFile);
  assert.deepEqual(parsed, { types: "declare x: 1;", content: "const a = 1;\nconst b = 2;" });
});

test("library parser: an implicit string return takes the string", async () => {
  const text = 'export const types = () => "declare y: 2;";\nexport const content = () => "const c = 3;";\n';
  const parsed = await withFile(text, parseLibraryFile);
  assert.deepEqual(parsed, { types: "declare y: 2;", content: "const c = 3;" });
});

test("library parser: a direct string assignment takes the string", async () => {
  const text = 'export const types = "declare z: 3;";\nexport const content = "const d = 4;";\n';
  const parsed = await withFile(text, parseLibraryFile);
  assert.deepEqual(parsed, { types: "declare z: 3;", content: "const d = 4;" });
});

test("library parser: a file with none of these is refused with the parser's message", async () => {
  await assert.rejects(
    withFile("export const other = 1;\n", parseLibraryFile),
    { message: "Error parsing library file. Could not parse types from file" },
  );
  await assert.rejects(
    withFile('export const types = "t";\nexport const content = 5;\n', parseLibraryFile),
    { message: "Error parsing library file. Could not parse content from file" },
  );
});

// ---------------------------------------------------------------- libraryResource

const CURRENT = {
  id: "lib-1",
  name: "util",
  namespace: "current-ns",
  content: { content: "const current = 1;" },
  types: "declare current: 1;",
  tags: ["current"],
  enabled: false,
  version: 7,
};

test("libraryResource.saveVars: with nothing desired every field is the library's own", () => {
  assert.deepEqual(libraryResource.saveVars(CURRENT), {
    id: "lib-1",
    name: "util",
    namespace: "current-ns",
    content: "const current = 1;",
    types: "declare current: 1;",
    version: 7,
    tags: ["current"],
    enabled: false,
  });
});

// [field, the library's own value in the save variables, a desired value]
const FIELDS = [
  ["namespace", "current-ns", "desired-ns"],
  ["content", "const current = 1;", "const desired = 2;"],
  ["types", "declare current: 1;", "declare desired: 2;"],
  ["tags", ["current"], ["desired"]],
  ["enabled", false, true],
];
for (const [field, own, desired] of FIELDS) {
  test(`libraryResource.saveVars: ${field} is kept when left out and taken when desired`, () => {
    assert.deepEqual(libraryResource.saveVars(CURRENT, {})[field], own);
    assert.deepEqual(libraryResource.saveVars(CURRENT, { [field]: desired })[field], desired);
  });
}

test("libraryResource.saveVars: a false enabled and an empty tag list are values, not gaps", () => {
  const vars = libraryResource.saveVars({ ...CURRENT, enabled: true }, { enabled: false, tags: [] });
  assert.equal(vars.enabled, false);
  assert.deepEqual(vars.tags, []);
});

test("libraryResource.list: an API answer without a list is an empty list", sandboxTest(async (sb) => {
  sb.write("lib.js", 'export const types = () => {\n  return "declare q: 1;";\n};\nexport const content = () => {\n  const q = 1;\n};\n');
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    libraries:\n      - name: util\n        file: lib.js\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", {});
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "lib-new" });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(sb.api.ops().includes("ADD_AUTOMATION_LIB_MUTATION"), sb.api.ops().join());
  assert.match(r.stdout, /\n {2}library +util +created\n/);
}));

// ---------------------------------------------------------------- step file parser

test("step parser: a file without a parsable condition is refused", async () => {
  await assert.rejects(
    withFile("export const content = async () => {\n  data.a = 1;\n};\n", parseStepFile),
    { message: "Error parsing step file. Could not parse condition from file" },
  );
});

test("step parser: a file without a parsable content is refused", async () => {
  await assert.rejects(
    withFile("export const condition = { a: 1 };\n", parseStepFile),
    { message: "Error parsing step file. Could not parse content from file" },
  );
});

// ---------------------------------------------------------------- deploy entry checks

test("deploy: a step or library entry with neither name nor syncPath is a failed item", sandboxTest(async (sb) => {
  sb.write("d.yaml", [
    "workspaces:", "  - name: Dev",
    "    steps:", "      - file: s.js",
    "    libraries:", "      - file: l.js",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^A step entry must have 'name' or 'syncPath'\.\n/);
  assert.match(r.stderr, /\nA library entry must have 'name' or 'syncPath'\.\n/);
  assert.match(r.stderr, /\nDeployment failed: 2 item\(s\) could not be deployed\.\n$/);
  assert.match(r.stdout, /\n {2}step +\(unnamed\) +failed\n/);
  assert.match(r.stdout, /\n {2}library +\(unnamed\) +failed\n/);
  assert.doesNotMatch(r.stdout, /completed successfully/);
}));

test("deploy: a secret entry without name or value is a failed item", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    secrets:\n      - description: nothing else\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Secret entry must have 'name' and 'value'.\n\nDeployment failed: 1 item(s) could not be deployed.\n");
  assert.match(r.stdout, /\n {2}secret +\(unnamed\) +failed\n/);
}));

test("deploy: a secret entry with a value but no name is a failed item", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    secrets:\n      - value: not-a-value\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^Secret entry must have 'name' and 'value'\.\n/);
  assert.match(r.stderr, FAILED_1);
}));

test("deploy: a connector entry shows its name, or its id when it has no name", sandboxTest(async (sb) => {
  sb.write("d.yaml", [
    "workspaces:", "  - name: Dev", "    connectors:",
    "      - connectorId: m-1", "        connectorName: Mailer",
    "      - connectorId: m-2",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("ADD_CONNECTOR_MUTATION", gqlError("refused"));
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\n {2}- Mailer\n/);
  assert.match(r.stdout, /\n {2}- m-2\n/);
  assert.match(r.stdout, /\n {2}connector +Mailer +failed\n/);
  assert.match(r.stdout, /\n {2}connector +m-2 +failed\n/);
}));

// ---------------------------------------------------------------- deploy abort wording

test("deploy: a failure before anything is deployed reads \"Deployment failed: <message>\"", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    webhooks:\n      - name: w\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", gqlError("lookup refused"));
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Deployment failed: lookup refused\n");
  assert.ok(!sb.api.ops().includes("CREATE_WEBHOOK_MUTATION"));
}));
