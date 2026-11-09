// Failure paths of the shared pull / sync / ensure engine (src/resources/engine.js), seen through
// `aloma step ...` and `aloma library ...`, plus the usage message of commands that take an ID.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest } from "./helpers/cli-harness.js";
import { ensure, ensureFolder } from "../src/resources/engine.js";

const YES = [{ when: /\(y\/N\): /, send: "y\n" }];
const NO = [{ when: /\(y\/N\): /, send: "n\n" }];
const ok = { validateAutomationIf: true };
const stepFile = (cond, body) =>
  `export const condition = ${cond};\n\nexport const content = async () => {\n${body}\n};\n`;
const libFile = (types, body) =>
  `export const types = () => {\n  return \`${types}\`;\n};\n\nexport const content = () => {\n${body}\n};\n`;

// One row per kind that goes through the engine.
const KINDS = [
  {
    kind: "step",
    plural: "steps",
    title: "Step",
    file: (n) => stepFile("{ a: 1 }", `data.a = ${n};`),
    list: "LIST_STEPS_QUERY",
    get: "GET_STEP_QUERY",
    listReply: (items) => ({ listAutomationSteps: items }),
    getReply: (item) => ({ getAutomationStep: item }),
    stored: (id, name) => ({ id, name, enabled: true, version: 1, content: { if: "{}", do: "" } }),
    save: "SAVE_STEP_MUTATION",
    saveReply: { saveAutomationStep: true },
    create: "CREATE_STEP_MUTATION",
    createReply: { createAutomationStep: "new-1" },
    flag: "-s",
    extra: (sb) => sb.api.on("VALIDATE_IF_QUERY", ok),
  },
  {
    kind: "library",
    plural: "libraries",
    title: "Library",
    file: (n) => libFile("declare x: 1;", `const a = ${n};`),
    list: "LIST_AUTOMATION_LIBS_QUERY",
    get: "GET_AUTOMATION_LIB_QUERY",
    listReply: (items) => ({ listAutomationLibs: items }),
    getReply: (item) => ({ getAutomationLib: item }),
    stored: (id, name) => ({ id, name, namespace: name, enabled: true, tags: [], version: 1, types: "", content: { content: "" } }),
    save: "UPDATE_AUTOMATION_LIB_MUTATION",
    saveReply: { saveAutomationLib: true },
    create: "ADD_AUTOMATION_LIB_MUTATION",
    createReply: { createAutomationLib: "new-1" },
    flag: "-l",
    extra: () => {},
  },
];

const writes = (sb, k) => sb.api.ops().filter((o) => o === k.save || o === k.create);

for (const k of KINDS) {
  // ------------------------------------------------------------------ sync

  test(`${k.kind} sync: a listed ${k.kind} that cannot be fetched is reported as failed while the other files are processed`, sandboxTest(async (sb) => {
    k.extra(sb);
    sb.write("src/alpha.js", k.file(1));
    sb.write("src/beta.js", k.file(2));
    sb.api.on(k.list, k.listReply([{ id: "i-1", name: "alpha" }]));
    sb.api.on(k.get, k.getReply(null));
    sb.api.on(k.create, k.createReply);
    sb.api.on(k.save, k.saveReply);
    const r = await sb.run([k.kind, "sync", "-p", "src"], { answers: YES });
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`^Error updating ${k.kind}: alpha: ${k.title} with ID i-1 not found\\.\\n`));
    assert.match(r.stderr, new RegExp(`failed for 1 file\\(s\\)\\nUpdated: 0, Created: 1, Failed: 1\\n$`));
    assert.doesNotMatch(r.stdout, /Successfully synced/);
    // beta was still created
    assert.deepEqual(sb.api.calls.filter((c) => c.op === k.create).map((c) => c.variables.name), ["beta"]);
  }));

  test(`${k.kind} sync ${k.flag}: a ${k.kind} that cannot be fetched is reported as not found (exit 1), nothing is written`, sandboxTest(async (sb) => {
    k.extra(sb);
    sb.write("src/alpha.js", k.file(1));
    sb.api.on(k.list, k.listReply([{ id: "i-1", name: "alpha" }]));
    sb.api.on(k.get, k.getReply(null));
    const r = await sb.run([k.kind, "sync", k.flag, "i-1", "-p", "src"], { answers: YES });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `${k.title} with ID i-1 not found.\n`);
    assert.deepEqual(writes(sb, k), []);
  }));

  test(`${k.kind} sync ${k.flag}: declining the prompt exits 1 and writes nothing`, sandboxTest(async (sb) => {
    k.extra(sb);
    sb.write("src/alpha.js", k.file(1));
    sb.api.on(k.list, k.listReply([{ id: "i-1", name: "alpha" }]));
    sb.api.on(k.get, k.getReply(k.stored("i-1", "alpha")));
    sb.api.on(k.save, k.saveReply);
    const r = await sb.run([k.kind, "sync", k.flag, "i-1", "-p", "src"], { answers: NO });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, "Sync cancelled by user.\n");
    assert.doesNotMatch(r.stdout, /Successfully synced/);
    assert.deepEqual(writes(sb, k), []);
  }));

  test(`${k.kind} sync (all): declining the prompt exits 1 and writes nothing`, sandboxTest(async (sb) => {
    k.extra(sb);
    sb.write("src/alpha.js", k.file(1));
    sb.write("src/beta.js", k.file(2));
    sb.api.on(k.list, k.listReply([{ id: "i-1", name: "alpha" }]));
    sb.api.on(k.get, k.getReply(k.stored("i-1", "alpha")));
    sb.api.on(k.save, k.saveReply);
    sb.api.on(k.create, k.createReply);
    const r = await sb.run([k.kind, "sync", "-p", "src"], { answers: NO });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, "Sync cancelled by user.\n");
    assert.deepEqual(writes(sb, k), []);
    assert.deepEqual(sb.api.ops().filter((o) => o === k.get), []);
  }));

  // ------------------------------------------------------------------ pull

  test(`${k.kind} pull ${k.flag} <id>: a ${k.kind} that cannot be fetched is reported as not found (exit 1), no file is written`, sandboxTest(async (sb) => {
    sb.api.on(k.list, k.listReply([{ id: "i-1", name: "alpha" }]));
    sb.api.on(k.get, k.getReply(null));
    const r = await sb.run([k.kind, "pull", k.flag, "i-1", "-p", "out"]);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `${k.title} with ID i-1 not found.\n`);
    assert.deepEqual(sb.list("out"), []);
  }));

  test(`${k.kind} pull (all): a ${k.kind} that cannot be fetched is left out and the others are written`, sandboxTest(async (sb) => {
    sb.api.on(k.list, k.listReply([{ id: "i-1", name: "alpha" }, { id: "i-2", name: "beta" }]));
    sb.api.on(k.get, (v) => k.getReply(v.id === "i-2" ? k.stored("i-2", "beta") : null));
    const r = await sb.run([k.kind, "pull", "-p", "out"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(sb.list("out"), ["beta.js"]);
    assert.equal(r.stdout, `Successfully pulled 2 ${k.plural} to: out\n`);
  }));
}

// ------------------------------------------------------------------ ensure (matching errors)

const fakeDesc = (overrides = {}) => ({
  kind: "thing",
  title: "Thing",
  key: (d) => d.name,
  list: async () => [],
  get: async () => null,
  create: async () => "new-id",
  save: async () => true,
  saveAfterCreate: () => false,
  saveVars: (cur, want = {}) => ({ ...cur, ...want }),
  blank: (id, name) => ({ id, name }),
  parse: async () => ({}),
  ...overrides,
});

test("ensure: an error while matching becomes a failed item with action 'match'", async () => {
  const boom = new Error("list down");
  const item = await ensure(fakeDesc({ list: async () => { throw boom; } }), "ws-1", { name: "x" });
  assert.equal(item.status, "failed");
  assert.equal(item.action, "match");
  assert.equal(item.error, boom);
  assert.equal(item.kind, "thing");
  assert.equal(item.name, "x");
});

test("ensure: a name shared by several items becomes a refused item with action 'match'", async () => {
  const desc = fakeDesc();
  const item = await ensure(desc, "ws-1", { name: "x" }, { items: [{ id: "1", name: "x" }, { id: "2", name: "X" }] });
  assert.equal(item.status, "refused");
  assert.equal(item.action, "match");
  assert.match(item.error.message, /ambiguous/);
});

test("ensure: a stored item that cannot be fetched becomes a failed item with action 'update'", async () => {
  const item = await ensure(fakeDesc(), "ws-1", { name: "x" }, { items: [{ id: "1", name: "x" }] });
  assert.equal(item.status, "failed");
  assert.equal(item.action, "update");
  assert.equal(item.error.message, "Thing with ID 1 not found.");
});

test("ensureFolder: an entry whose key cannot be computed is a refused item and the other entries are still processed", async (t) => {
  const { default: fs } = await import("node:fs");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aloma-engine-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "a.js"), "");
  fs.writeFileSync(path.join(dir, "b.js"), "");
  const created = [];
  const desc = fakeDesc({
    key: (d) => {
      if (d.name === "a") throw new Error("cannot match a");
      return d.name;
    },
    create: async (name) => { created.push(name); return "new-id"; },
  });
  const results = await ensureFolder(desc, "ws-1", dir);
  const by = Object.fromEntries(results.map((r) => [r.name, r]));
  assert.equal(by.a.status, "refused");
  assert.equal(by.a.action, "match");
  assert.equal(by.a.error.message, "cannot match a");
  assert.equal(by.b.status, "created");
  assert.deepEqual(created, ["b"]);
});

// ------------------------------------------------------------------ commands without an ID

const USAGE = [
  [["step", "show"], "⚠ Please provide a step ID.\n"],
  [["step", "edit"], "⚠ Please provide a step ID.\n"],
  [["step", "clone"], "Please provide a step ID to clone.\n"],
  [["step", "delete"], "⚠ Please provide a step ID.\n"],
  [["task", "log"], "⚠ Please provide a task ID\n"],
  [["task", "clone"], "⚠ Please provide a task ID\n"],
  [["task", "stop"], "⚠ Please provide a task ID\n"],
  [["task", "resume"], "⚠ Please provide a task ID\n"],
  [["webhook", "show"], "⚠ Please provide a webhook ID\n"],
  [["webhook", "delete"], "⚠ Please provide a webhook ID\n"],
  [["library", "show"], "⚠ Please provide a library ID.\n"],
  [["library", "update"], "⚠ Please provide a library ID.\n"],
  [["library", "delete"], "⚠ Please provide a library ID.\n"],
];

for (const [args, message] of USAGE) {
  test(`${args.join(" ")} with an empty ID prints the usage message and exits 2`, sandboxTest(async (sb) => {
    const r = await sb.run([...args, ""]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, message);
    assert.equal(r.stdout, "");
    assert.deepEqual(sb.api.calls.filter((c) => /MUTATION/.test(c.op)), []);
  }));
}

test("company switch with no identifier selects interactively and does not print a usage message", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", { me: { realm: { id: "r-1", name: "Alpha" }, realms: [] } });
  const r = await sb.run(["company", "switch"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "No companies found.\n");
}));

test("company add with an empty name from a non-administrator exits 1", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", { me: { realm: { id: "r-1", name: "Alpha" }, realms: [], groups: [] } });
  const r = await sb.run(["company", "add", ""]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error: Only administrators can add companies\n");
}));

// ------------------------------------------------------------------ task rule execution time

const task = { id: "t-1", name: "order", state: "completed", duration: 10, tags: [], createdAt: "2024-03-05T10:00:00Z", updatedAt: "2024-03-05T10:05:00Z", content: null };
const entry = (applied) => ({
  id: "h1", event: "rule", state: "done", rule: { id: "r1", name: "Step One" },
  updatedAt: "2024-03-05T10:00:01Z",
  context: { timestamp: Date.parse("2024-03-05T10:00:01Z"), content: { data: {}, context: { appliedRules: applied } } },
});
const showTask = (sb, applied) => {
  sb.api.on("GET_TASK_QUERY", { getAutomationEnvironmentTask: task, getAutomationEnvironmentTaskHistory: [entry(applied)] });
  return sb.run(["task", "log", "t-1"]);
};
const stepOne = (out) => out.slice(out.indexOf("Step One"));

test("task log: a rule's execution time is shown after its state when the applied rule has one", sandboxTest(async (sb) => {
  const r = await showTask(sb, [{ id: "r1", executionDuration: 42 }]);
  assert.equal(r.code, 0);
  assert.match(stepOne(r.stdout), /^Step One\nTime: .*\nState: ● done\nDuration: 42ms\n/);
}));

test("task log: no execution time line when the applied rule has none, or another rule was applied", sandboxTest(async (sb) => {
  for (const applied of [[{ id: "r1" }], [{ id: "other", executionDuration: 7 }], []]) {
    const r = await showTask(sb, applied);
    assert.equal(r.code, 0);
    assert.doesNotMatch(stepOne(r.stdout), /Duration:/);
  }
}));
