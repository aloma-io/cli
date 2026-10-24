// Characterisation tests for `aloma library ...` (src/commands/library).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, gqlError } from "./helpers/cli-harness.js";

const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);
const libFile = (types, body) =>
  `export const types = () => {\n  return \`${types}\`;\n};\n\nexport const content = () => {\n${body}\n};\n`;
const LIB_HEADER = (name, id) => `/**
 * Library: ${name}
 * ID: ${id}
 * 
 * Edit the types and content below.
 * The types should be a function that returns type definitions.
 * The content should be JavaScript code with function implementations and exports.
 * 
 * Example:
 * types = () => {
 *   return "function processData(data: any): any";
 * };
 * 
 * content = () => {
 *   const processData = (data) => {
 *     return data.map(item => ({ ...item, processed: true }));
 *   };
 *   module.exports = { processData };
 * };
 */
`;
const FULL = (id, name, types, content, extra = {}) => ({
  id, name, namespace: name.split("/")[0], enabled: true, tags: ["t"], version: 2, types, content: content === null ? null : { content }, ...extra,
});
const mockLibs = (sb, libs) => {
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", { listAutomationLibs: libs.map((l) => ({ id: l.id, name: l.name })) });
  sb.api.on("GET_AUTOMATION_LIB_QUERY", (v) => ({ getAutomationLib: libs.find((l) => l.id === v.id) ?? null }));
};
const YES = [{ when: /\(y\/N\): /, send: "y\n" }];

test("library list: default and --name filter", sandboxTest(async (sb) => {
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", {
    listAutomationLibs: [
      { id: "l-1", name: "util/strings", namespace: "util", enabled: true, tags: ["a", "b"], version: 3, createdAt: "c1", updatedAt: "u1" },
      { id: "l-2", name: "other", namespace: "other", enabled: false, tags: null, version: 1, createdAt: "c2", updatedAt: "u2" },
    ],
  });
  let r = await sb.run(["library", "list"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["LIST_AUTOMATION_LIBS_QUERY", { id: "ws-sel", name: null }]]);
  assert.equal(
    r.stdout,
    [
      "", "📚 Libraries in Current Workspace", "",
      "util/strings", "   ID: l-1", "   Namespace: util", "   Enabled: Yes", "   Tags: a, b", "   Version: 3", "   Created: c1", "   Updated: u1", "",
      "other", "   ID: l-2", "   Namespace: other", "   Enabled: No", "   Tags: None", "   Version: 1", "   Created: c2", "   Updated: u2", "", "",
    ].join("\n"),
  );
  r = await sb.run(["library", "list", "-n", "util"]);
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "ws-sel", name: "util" });
}));

test("library list: empty and error", sandboxTest(async (sb) => {
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", { listAutomationLibs: [] });
  let r = await sb.run(["library", "list"]);
  assert.equal(r.stdout, "No libraries found in current workspace.\n");
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", gqlError("denied"));
  r = await sb.run(["library", "list"]);
  assert.match(r.stderr, /Error fetching libraries: denied/);
  assert.equal(r.code, 0);
}));

test("library show: details, types and code; the workspace option is unused", sandboxTest(async (sb) => {
  sb.api.on("GET_AUTOMATION_LIB_QUERY", {
    getAutomationLib: { id: "l-1", name: "util", namespace: null, version: 4, enabled: false, tags: [], types: "declare const x: 1;", content: { content: "const x = 1;" } },
  });
  const r = await sb.run(["library", "show", "l-1", "-w", "anything"]);
  assert.deepEqual(ops(sb), [["GET_AUTOMATION_LIB_QUERY", { id: "l-1" }]]);
  assert.equal(
    r.stdout,
    ["", "📚 Library Details", "", "Name: util", "ID: l-1", "Namespace: N/A", "Version: 4", "Enabled: No", "Tags: None",
      "", "Types:", "declare const x: 1;", "", "Content:", "const x = 1;", ""].join("\n"),
  );
}));

test("library show: not found / error", sandboxTest(async (sb) => {
  sb.api.on("GET_AUTOMATION_LIB_QUERY", { getAutomationLib: null });
  let r = await sb.run(["library", "show", "l-9"]);
  assert.equal(r.stdout, "Library with ID l-9 not found.\n");
  sb.api.on("GET_AUTOMATION_LIB_QUERY", gqlError("denied"));
  r = await sb.run(["library", "show", "l-9"]);
  assert.match(r.stderr, /Error fetching library details: denied/);
}));

test("library add: creates the library; with --file also saves types and content", sandboxTest(async (sb) => {
  sb.write("lib.js", libFile("declare function f(): void;", "  const f = () => 1;\n  module.exports = { f };"));
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "l-new" });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  const r = await sb.run(["library", "add", " util/f ", "util", "-f", "lib.js", "-t", "a, b", "-e", "false"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "Created library [util/f] with ID: l-new\nSuccessfully added library content from file: lib.js\n");
  assert.deepEqual(ops(sb), [
    ["ADD_AUTOMATION_LIB_MUTATION", { name: "util/f", environment_id: "ws-sel" }],
    ["UPDATE_AUTOMATION_LIB_MUTATION", {
      id: "l-new", name: "util/f", namespace: "util", content: "const f = () => 1;\nmodule.exports = {\n  f\n};",
      types: "declare function f(): void;", version: 0, tags: ["a", "b"], enabled: false,
    }],
  ]);
}));

test("library add: without --file the namespace, tags and enabled flag are dropped", sandboxTest(async (sb) => {
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "l-new" });
  const r = await sb.run(["library", "add", "x", "ns", "-t", "a", "-e", "false"]);
  // PINS SUSPECT BEHAVIOUR: only the name reaches the API; the other options are ignored silently.
  assert.equal(r.stdout, "Created library [x] with ID: l-new\n");
  assert.deepEqual(ops(sb), [["ADD_AUTOMATION_LIB_MUTATION", { name: "x", environment_id: "ws-sel" }]]);
}));

test("library add: enabled defaults to true, anything but 'true' is false", sandboxTest(async (sb) => {
  sb.write("lib.js", libFile("t", "  const a = 1;"));
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "l-new" });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  await sb.run(["library", "add", "x", "ns", "-f", "lib.js"]);
  assert.equal(sb.api.calls.at(-1).variables.enabled, true);
  assert.deepEqual(sb.api.calls.at(-1).variables.tags, []);
  await sb.run(["library", "add", "x", "ns", "-f", "lib.js", "-e", "no"]);
  assert.equal(sb.api.calls.at(-1).variables.enabled, false);
}));

test("library add: both name and namespace are required", sandboxTest(async (sb) => {
  const r = await sb.run(["library", "add", "x"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /missing required argument 'namespace'/);
}));

test("library add --file: bad file leaves the created library empty", sandboxTest(async (sb) => {
  sb.write("bad.js", "export const types = () => { return ''; };\n");
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "l-new" });
  let r = await sb.run(["library", "add", "x", "ns", "-f", "bad.js"]);
  // PINS SUSPECT BEHAVIOUR: library is created before the file is validated; exit code stays 0.
  assert.equal(r.code, 0);
  assert.match(r.stderr, /Error reading or parsing file: Error parsing library file\. Could not parse types from file/);
  assert.deepEqual(sb.api.ops(), ["ADD_AUTOMATION_LIB_MUTATION"]);
  sb.write("bad2.js", "export const types = () => { return 'T'; };\nexport const content = () => {};\n");
  r = await sb.run(["library", "add", "x", "ns", "-f", "bad2.js"]);
  assert.match(r.stderr, /Could not parse content from file/);
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", gqlError("exists"));
  r = await sb.run(["library", "add", "x", "ns"]);
  assert.match(r.stderr, /Error creating library: exists/);
}));

test("library file parser: string literal / arrow-return forms of types", sandboxTest(async (sb) => {
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "l-new" });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  const cases = [
    ["export const types = () => { return 'single'; };\nexport const content = () => { const a = 1; };\n", "single", "const a = 1;"],
    ['export const types = () => { return "double"; };\nexport const content = () => { const a = 1; };\n', "double", "const a = 1;"],
    ['export const types = "direct";\nexport const content = "raw code";\n', "direct", "raw code"],
    ['export const types = () => "implicit";\nexport const content = () => { const a = 1; };\n', "implicit", "const a = 1;"],
  ];
  for (const [src, expectedTypes, expectedContent] of cases) {
    sb.write("l.js", src);
    const r = await sb.run(["library", "add", "x", "ns", "-f", "l.js"]);
    assert.equal(r.code, 0);
    assert.equal(sb.api.calls.at(-1).variables.types, expectedTypes, src);
    assert.equal(sb.api.calls.at(-1).variables.content, expectedContent, src);
  }
}));

test("library update: only the given fields change; content/types/version come from the stored library", sandboxTest(async (sb) => {
  sb.api.on("GET_AUTOMATION_LIB_QUERY", { getAutomationLib: FULL("l-1", "util", "T", "const a = 1;") });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  let r = await sb.run(["library", "update", "l-1", "-n", "newns"]);
  assert.equal(r.stdout, "Successfully updated library: util\n");
  assert.deepEqual(ops(sb).at(-1), ["UPDATE_AUTOMATION_LIB_MUTATION", {
    id: "l-1", name: "util", namespace: "newns", content: "const a = 1;", types: "T", version: 2, tags: ["t"], enabled: true,
  }]);
  r = await sb.run(["library", "update", "l-1", "-t", "x, y", "-e", "false"]);
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    id: "l-1", name: "util", namespace: "util", content: "const a = 1;", types: "T", version: 2, tags: ["x", "y"], enabled: false,
  });
  r = await sb.run(["library", "update", "l-1"]);
  assert.equal(sb.api.calls.at(-1).variables.enabled, true);
}));

test("library update --file: replaces content and types; a failing parse sends nothing", sandboxTest(async (sb) => {
  sb.api.on("GET_AUTOMATION_LIB_QUERY", { getAutomationLib: FULL("l-1", "util", "T", "old();") });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  sb.write("new.js", libFile("NT", "  new_();"));
  await sb.run(["library", "update", "l-1", "-f", "new.js"]);
  const v = sb.api.calls.at(-1).variables;
  assert.equal(v.content, "new_();");
  assert.equal(v.types, "NT");
  sb.write("bad.js", "nothing");
  const n = sb.api.calls.length;
  const r = await sb.run(["library", "update", "l-1", "-f", "bad.js"]);
  assert.match(r.stderr, /Error updating library: Error parsing library file\. Could not parse types from file/);
  assert.equal(sb.api.calls.filter((c) => c.op === "UPDATE_AUTOMATION_LIB_MUTATION").length, 1);
  assert.ok(sb.api.calls.length > n); // only the GET happened
}));

test("library update: not found; refused by API", sandboxTest(async (sb) => {
  sb.api.on("GET_AUTOMATION_LIB_QUERY", { getAutomationLib: null });
  let r = await sb.run(["library", "update", "l-9"]);
  assert.equal(r.stdout, "Library with ID l-9 not found.\n");
  sb.api.on("GET_AUTOMATION_LIB_QUERY", { getAutomationLib: FULL("l-1", "util", "T", null) });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: false });
  r = await sb.run(["library", "update", "l-1"]);
  assert.equal(r.stdout, "Failed to update library.\n");
  // a library without stored content is saved with empty content
  assert.equal(sb.api.calls.at(-1).variables.content, "");
}));

test("library delete: success, refusal, error", sandboxTest(async (sb) => {
  sb.api.on("REMOVE_AUTOMATION_LIB_MUTATION", { deleteAutomationLib: true });
  let r = await sb.run(["library", "delete", "l-1"]);
  assert.equal(r.stdout, "Successfully deleted library with ID: l-1\n");
  assert.deepEqual(ops(sb), [["REMOVE_AUTOMATION_LIB_MUTATION", { id: "l-1", environment_id: "ws-sel" }]]);
  sb.api.on("REMOVE_AUTOMATION_LIB_MUTATION", { deleteAutomationLib: false });
  r = await sb.run(["library", "delete", "l-1"]);
  assert.equal(r.stdout, "Library with ID l-1 not found or could not be deleted.\n");
  sb.api.on("REMOVE_AUTOMATION_LIB_MUTATION", gqlError("in use"));
  r = await sb.run(["library", "delete", "l-1"]);
  assert.match(r.stderr, /Error deleting library: in use/);
}));

test("library pull (all): one file per library name, nested for 'a/b' names", sandboxTest(async (sb) => {
  mockLibs(sb, [FULL("l-1", "flat", "declare 1;", "const a = 1;"), FULL("l-2", "grp/inner", "", "const b = 2;")]);
  const r = await sb.run(["library", "pull", "-p", "out"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "Successfully pulled 2 libraries to: out\n");
  assert.deepEqual(ops(sb), [
    ["LIST_AUTOMATION_LIBS_QUERY", { id: "ws-sel" }],
    ["GET_AUTOMATION_LIB_QUERY", { id: "l-1" }],
    ["GET_AUTOMATION_LIB_QUERY", { id: "l-2" }],
  ]);
  assert.equal(
    sb.read("out/flat.js"),
    LIB_HEADER("flat", "l-1") + "\nexport const types = () => {\n  return `declare 1;`;\n};\n\nexport const content = () => {\nconst a = 1;\n};\n",
  );
  assert.deepEqual(sb.list("out/grp"), ["inner.js"]);
}));

test("library pull -l <id>: one library; unknown id; empty workspace", sandboxTest(async (sb) => {
  mockLibs(sb, [FULL("l-1", "flat", "T", "c();")]);
  let r = await sb.run(["library", "pull", "-l", "l-1", "-p", "out"]);
  assert.equal(r.stdout, "Successfully pulled library: flat\n");
  r = await sb.run(["library", "pull", "-l", "nope", "-p", "out"]);
  assert.equal(r.stdout, "Library with ID nope not found.\n");
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", { listAutomationLibs: [] });
  r = await sb.run(["library", "pull", "-p", "out"]);
  assert.equal(r.stdout, "No libraries found in workspace.\n");
}));

// SECURITY: library pull never writes outside the target folder (finding 3; same code shape as
// step pull).
test("SECURITY: library pull never writes outside the target folder", sandboxTest(async (sb) => {
  mockLibs(sb, [
    FULL("l-1", "../escaped", "T", "x();"),
    FULL("l-2", "ns/../../escaped2", "T", "x();"),
    FULL("l-3", "/abs/escaped3", "T", "x();"),
    FULL("l-4", "ok/inside", "T", "fine();"),
  ]);
  const r = await sb.run(["library", "pull", "-p", "out"]);
  for (const f of ["escaped.js", "escaped2.js", "abs", "out/abs"]) assert.equal(sb.exists(f), false, f);
  assert.deepEqual(sb.list(), ["out"]);
  assert.deepEqual(sb.list("out"), ["ok"]);
  assert.equal((r.out.match(/Skipped library l-\d: unsafe name/g) || []).length, 3, r.out);
}));

// SECURITY: a name or id cannot close the header comment and inject code at the top of the file.
test("SECURITY: library pull: name and id cannot break out of the header comment", sandboxTest(async (sb) => {
  mockLibs(sb, [FULL("l-1 */\nglobalThis.pwnedId = 1;\n/*", "x*/ globalThis.pwned = 1; /* y", "T", "x();")]);
  await sb.run(["library", "pull", "-p", "out"]);
  const file = "out/x*/ globalThis.pwned = 1; /* y.js";
  assert.ok(sb.exists(file), sb.list("out").join());
  const text = sb.read(file);
  const header = text.slice(0, text.indexOf("export const types"));
  assert.equal(header.split("*/").length, 2, "only the header's own closing */");
  assert.doesNotMatch(text, /^globalThis\.pwned/m);
  assert.doesNotMatch(header.slice(0, -4), /\*\//, "no early end of the comment");
}));

test("SECURITY: library pull: a name with control characters (newlines) is skipped", sandboxTest(async (sb) => {
  mockLibs(sb, [FULL("l-1", "evil\nname", "T", "x();")]);
  const r = await sb.run(["library", "pull", "-p", "out"]);
  assert.deepEqual(sb.list("out"), []);
  assert.match(r.out, /Skipped library l-1: unsafe name/);
}));

test("library pull: libraries with the same name overwrite each other", sandboxTest(async (sb) => {
  mockLibs(sb, [FULL("l-1", "dup", "T1", "one();"), FULL("l-2", "dup", "T2", "two();")]);
  const r = await sb.run(["library", "pull", "-p", "out"]);
  // PINS SUSPECT BEHAVIOUR: same gap as `step pull`; two libraries, one file, "pulled 2" printed.
  assert.deepEqual(sb.list("out"), ["dup.js"]);
  assert.match(sb.read("out/dup.js"), /two\(\);/);
  assert.match(r.stdout, /Successfully pulled 2 libraries/);
}));

test("library pull: a library without stored content aborts the whole pull", sandboxTest(async (sb) => {
  mockLibs(sb, [FULL("l-1", "ok", "T", "a();"), FULL("l-2", "nocontent", "T", null), FULL("l-3", "later", "T", "c();")]);
  const r = await sb.run(["library", "pull", "-p", "out"]);
  // PINS SUSPECT BEHAVIOUR: library.content.content throws on null content; earlier files are
  // already written, later ones are not, and the exit code is 0.
  assert.equal(r.code, 0);
  assert.match(r.stderr, /Error pulling libraries: Cannot read properties of null/);
  assert.deepEqual(sb.list("out"), ["ok.js"]);
}));

test("library pull: types containing a backtick produce a file that cannot be synced back", sandboxTest(async (sb) => {
  mockLibs(sb, [FULL("l-1", "tick", "type A = `x`;", "a();")]);
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  await sb.run(["library", "pull", "-p", "out"]);
  const r = await sb.run(["library", "sync", "-p", "out"], { answers: YES });
  // PINS SUSPECT BEHAVIOUR: backticks in types are not escaped when the file is written.
  assert.match(r.stdout, /Error updating library: tick\n/);
  assert.match(r.stderr, /Missing semicolon/);
  // ... and the run still ends with a "Successfully synced" banner.
  assert.match(r.stdout, /Successfully synced libraries from: out\nUpdated: 0, Created: 0\n$/);
  assert.ok(!sb.api.ops().includes("UPDATE_AUTOMATION_LIB_MUTATION"));
}));

test("library sync (all): updates by name, creates new ones with the first path segment as namespace", sandboxTest(async (sb) => {
  sb.write("src/exists.js", libFile("T1", "  e();"));
  sb.write("src/grp/fresh.js", libFile("T2", "  f();"));
  sb.write("src/plain.js", libFile("T3", "  p();"));
  mockLibs(sb, [FULL("l-1", "exists", "old", "old();", { enabled: false, tags: ["k"], version: 8, namespace: "nsx" })]);
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "l-new" });
  const r = await sb.run(["library", "sync", "-p", "src"], { answers: YES });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Are you sure you want to overwrite libraries in the workspace with the contents of 3 file\(s\) from 'src'\? \(y\/N\): /);
  assert.match(r.stdout, /Successfully synced libraries from: src\nUpdated: 1, Created: 2\n$/);
  const saves = sb.api.calls.filter((c) => c.op === "UPDATE_AUTOMATION_LIB_MUTATION").map((c) => c.variables);
  assert.equal(saves.length, 3);
  assert.deepEqual(saves.find((s) => s.id === "l-1"), {
    id: "l-1", name: "exists", namespace: "nsx", content: "e();", types: "T1", enabled: false, version: 8, tags: ["k"],
  });
  assert.deepEqual(saves.find((s) => s.name === "grp/fresh"), {
    id: "l-new", name: "grp/fresh", namespace: "grp", content: "f();", types: "T2", version: 0, tags: [], enabled: true,
  });
  // PINS SUSPECT BEHAVIOUR: a top-level library's namespace is its own name ("plain"), the
  // "default" fallback can never apply because "".split("/")[0] is "".
  assert.equal(saves.find((s) => s.name === "plain").namespace, "plain");
}));

test("library sync: always asks for confirmation; n cancels", sandboxTest(async (sb) => {
  sb.write("src/a.js", libFile("T", "  a();"));
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", { listAutomationLibs: [] });
  const r = await sb.run(["library", "sync", "-p", "src"], { answers: [{ when: /\(y\/N\): /, send: "n\n" }] });
  assert.match(r.stdout, /Sync cancelled by user\.\n$/);
  assert.deepEqual(sb.api.ops(), ["LIST_AUTOMATION_LIBS_QUERY"]);
}));

test("library sync: missing folder, no .js files, unparsable file", sandboxTest(async (sb) => {
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", { listAutomationLibs: [] });
  let r = await sb.run(["library", "sync", "-p", "nowhere"]);
  assert.equal(r.stdout, "Workspace folder not found: nowhere\n");
  sb.write("none/readme.txt", "x");
  r = await sb.run(["library", "sync", "-p", "none"]);
  assert.equal(r.stdout, "No .js library files found in workspace folder.\n");
  sb.write("bad/bad.js", "const x = 1;\n");
  r = await sb.run(["library", "sync", "-p", "bad"], { answers: YES });
  assert.match(r.stdout, /Error creating library: bad\n/);
  assert.match(r.stdout, /Updated: 0, Created: 0\n$/);
}));

test("library sync -l <id>: nested name maps to a nested file; missing file; update", sandboxTest(async (sb) => {
  mockLibs(sb, [FULL("l-1", "grp/inner", "old", "old();")]);
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  sb.write("src/placeholder.txt", "");
  let r = await sb.run(["library", "sync", "-l", "l-1", "-p", "src"]);
  assert.match(r.stdout, /Library file not found: src\/grp\/inner\.js\n$/);
  sb.write("src/grp/inner.js", libFile("NT", "  n();"));
  r = await sb.run(["library", "sync", "-l", "l-1", "-p", "src"], { answers: YES });
  assert.match(r.stdout, /overwrite the library 'grp\/inner' with the contents of 'src\/grp\/inner\.js'\? \(y\/N\): /);
  assert.match(r.stdout, /Successfully synced library: grp\/inner\n$/);
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    id: "l-1", name: "grp/inner", namespace: "grp", content: "n();", types: "NT", enabled: true, version: 2, tags: ["t"],
  });
  mockLibs(sb, []);
  r = await sb.run(["library", "sync", "-l", "zzz", "-p", "src"]);
  assert.equal(r.stdout, "Library with ID zzz not found.\n");
}));

test("library pull then sync round-trips", sandboxTest(async (sb) => {
  mockLibs(sb, [FULL("l-1", "lib", "declare x;", "const x = 1;\nmodule.exports = { x };")]);
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  await sb.run(["library", "pull", "-p", "rt"]);
  const r = await sb.run(["library", "sync", "-p", "rt"], { answers: YES });
  assert.match(r.stdout, /Updated: 1, Created: 0/);
  const v = sb.api.calls.at(-1).variables;
  assert.equal(v.types, "declare x;");
  assert.equal(v.content, "const x = 1;\nmodule.exports = {\n  x\n};");
}));
