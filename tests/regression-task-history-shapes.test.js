// Regression tests for the history-field fallbacks of `aloma task log` (src/commands/task/index.js):
// per-entry duration, console/audit sources, entry error line, entry data and the synthetic "created" entry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest } from "./helpers/cli-harness.js";

const TASK = {
  id: "t-1", name: "order", state: "completed", duration: 1500, tags: [],
  createdAt: "2024-03-05T10:00:00Z", updatedAt: "2024-03-05T10:05:00Z", content: { data: { from: "task" } },
};
const TS = Date.parse("2024-03-05T10:00:01Z");
const SEP = "─".repeat(74);

// A history entry that survives the filter (it has a rule). `ctx` is merged into context, `extra` into the item.
const entry = (name, ctx = {}, extra = {}) => ({
  id: `h-${name}`, event: "rule", state: "done", rule: { id: `r-${name}`, name },
  updatedAt: "2024-03-05T10:00:01Z",
  context: { timestamp: TS, content: {}, ...ctx },
  ...extra,
});
const withContent = (content, ctx = {}) => ({ content, ...ctx });

const mockTask = (sb, history, task = TASK) =>
  sb.api.on("GET_TASK_QUERY", () => ({
    getAutomationEnvironmentTask: task,
    getAutomationEnvironmentTaskHistory: JSON.parse(JSON.stringify(history)),
  }));

// The printed blocks of the execution history, by card title.
const blocks = (out) => {
  const body = out.slice(out.indexOf("Execution History"));
  const result = {};
  for (const chunk of body.split(SEP)) {
    const title = chunk.split("\n").find((l, i) => i > 0 && l && !/^━/.test(l) && !/^Execution History/.test(l));
    if (title) result[title] = chunk;
  }
  return result;
};
const run = async (sb, history, flags = [], task = TASK) => {
  mockTask(sb, history, task);
  const r = await sb.run(["task", "log", "t-1", ...flags]);
  assert.equal(r.code, 0);
  return r;
};

// ------------------------------------------------------------ 1. duration

test("task log: the Duration line comes from the applied rule with the entry's rule id", sandboxTest(async (sb) => {
  const applied = (id, extra) => ({ content: { context: { appliedRules: [{ id: "other", executionDuration: 9 }, { id, ...extra }] } } });
  const history = [
    entry("found", applied("r-found", { executionDuration: 42 })),
    entry("noapplied"),
    entry("norule", applied("not-this-one", { executionDuration: 7 })),
    entry("nodur", applied("r-nodur", {})),
    entry("zero", applied("r-zero", { executionDuration: 0 })),
  ];
  const b = blocks((await run(sb, history)).stdout);
  assert.match(b.found, /\nDuration: 42ms\n/);
  assert.doesNotMatch(b.noapplied, /Duration:/);
  assert.doesNotMatch(b.norule, /Duration:/);
  assert.doesNotMatch(b.nodur, /Duration:/);
  // today the line is guarded by truthiness, so a duration of 0 is not printed
  assert.doesNotMatch(b.zero, /Duration:/);
}));

// ------------------------------------------------- 2. console and audit source

test("task log --logs: console lines come from _currentConsoleLog, else the legacy consoleLog, else none", sandboxTest(async (sb) => {
  const log = (msg) => [{ ts: TS, msg }];
  const history = [
    entry("both", { content: { _currentConsoleLog: log("from current") }, consoleLog: log("from legacy") }),
    entry("legacy", { consoleLog: log("legacy only") }),
    entry("none"),
    entry("emptycurrent", { content: { _currentConsoleLog: [] }, consoleLog: log("hidden legacy") }),
  ];
  const b = blocks((await run(sb, history, ["--logs"])).stdout);
  assert.match(b.both, /Console Log:\n\[[^\]]+\] from current\n/);
  assert.doesNotMatch(b.both, /from legacy/);
  assert.match(b.legacy, /Console Log:\n\[[^\]]+\] legacy only\n/);
  assert.doesNotMatch(b.none, /Console Log:/);
  // an empty array is truthy, so it still wins over the legacy source
  assert.doesNotMatch(b.emptycurrent, /Console Log:|hidden legacy/);
}));

test("task log --logs: audit lines come from _currentAuditLog, else the legacy auditLog, else none", sandboxTest(async (sb) => {
  const msg = (m) => [{ type: "message", msg: m }];
  const history = [
    entry("both", { content: { _currentAuditLog: msg("audit current") }, auditLog: msg("audit legacy") }),
    entry("legacy", { auditLog: msg("audit legacy only") }),
    entry("none"),
  ];
  const b = blocks((await run(sb, history, ["--logs"])).stdout);
  assert.match(b.both, /Audit Log:\naudit current\n/);
  assert.doesNotMatch(b.both, /audit legacy/);
  assert.match(b.legacy, /Audit Log:\naudit legacy only\n/);
  assert.doesNotMatch(b.none, /Audit Log:/);
}));

// ----------------------------------------------------------- 3. error line

test("task log: the entry error line prefers item.error over context.error, and also shows for incomplete entries", sandboxTest(async (sb) => {
  const history = [
    entry("both", { error: "from context" }, { error: "from item" }),
    entry("ctxonly", { error: "context only" }),
    entry("neither"),
    entry("inc", { error: "inc context" }, { state: "incomplete", error: "inc item" }),
  ];
  const b = blocks((await run(sb, history, ["--logs", "--inspect"])).stdout);
  assert.match(b.both, /\nError: from item\n/);
  assert.doesNotMatch(b.both, /from context/);
  assert.match(b.ctxonly, /\nError: context only\n/);
  assert.doesNotMatch(b.neither, /Error:/);
  assert.match(b.inc, /\nError: inc item\n/);
  assert.doesNotMatch(b.inc, /Step Data/);
}));

// ------------------------------------------------------------ 4. entry data

test("task log --inspect: step data is content.data, else item.data, else {}; the last step shows none", sandboxTest(async (sb) => {
  const history = [
    entry("a", withContent({ data: { src: "content" } }), { data: { src: "item-ignored" } }),
    entry("b", {}, { data: { src: "item" } }),
    entry("c"),
    entry("last", withContent({ data: { src: "last-data" } })),
  ];
  const r = await run(sb, history, ["--inspect"]);
  const b = blocks(r.stdout);
  assert.match(b.a, /Step Data:\n\{\n {2}"src": "content"\n\}/);
  assert.match(b.b, /Step Data:\n\{\n {2}"src": "item"\n\}/);
  assert.match(b.c, /Step Data:\n\{\}\n/);
  assert.doesNotMatch(b.last, /Step Data/);
  assert.doesNotMatch(r.stdout, /last-data|item-ignored/);
}));

// ------------------------------------------------- 5. synthetic created entry

test("task log: a 'created' entry is added first with the task's time, error and data", sandboxTest(async (sb) => {
  const task = { ...TASK, error: "task failed", content: { data: { from: "task" } } };
  const r = await run(sb, [entry("one"), entry("two")], ["--inspect"], task);
  const titles = [...r.stdout.matchAll(/^\n?(created|one|two)$/gm)].map((m) => m[1]);
  assert.deepEqual(titles, ["created", "one", "two"]);
  assert.equal((r.stdout.match(/^State: /gm) || []).length, 3);
  const b = blocks(r.stdout);
  assert.ok(b.created.includes(`Time: ${new Date(task.createdAt).toLocaleTimeString()}`));
  assert.match(b.created, /Step Data:\n\{\n {2}"from": "task"\n\}/);
  assert.match(b.created, /\nError: task failed\n/);
}));

test("task log: the added 'created' entry has {} data when the task has no content", sandboxTest(async (sb) => {
  const r = await run(sb, [entry("one"), entry("two")], ["--inspect"], { ...TASK, content: null });
  assert.match(blocks(r.stdout).created, /Step Data:\n\{\}\n/);
  assert.doesNotMatch(blocks(r.stdout).created, /Error:/);
}));

test("task log: a history that already has a 'created' entry gets none added", sandboxTest(async (sb) => {
  const own = { id: "own-created", event: "created", state: "created", updatedAt: "2024-03-05T10:00:00Z", context: { timestamp: TS, content: {} } };
  const r = await run(sb, [own, entry("one")], [], { ...TASK, error: "task failed" });
  assert.equal((r.stdout.match(/^State: /gm) || []).length, 2);
  assert.equal((r.stdout.match(/^\n?created$/gm) || []).length, 1);
  assert.doesNotMatch(r.stdout, /task failed/);
}));
