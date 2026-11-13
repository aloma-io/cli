// Regression tests for the rendering and normalising branches of `aloma task log` / `task new`
// (src/commands/task/index.js). Crafted API answers go in, the printed text comes out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest } from "./helpers/cli-harness.js";

const TASK = {
  id: "t-1", name: "order", state: "done", duration: 10, tags: [],
  createdAt: "2024-03-05T10:00:00Z", updatedAt: "2024-03-05T10:05:00Z",
};
const mockTask = (sb, history, task = TASK) =>
  sb.api.on("GET_TASK_QUERY", () => ({
    getAutomationEnvironmentTask: task,
    getAutomationEnvironmentTaskHistory: JSON.parse(JSON.stringify(history)),
  }));
// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");
const ESC = "\u001b[";

const TS = Date.parse("2024-03-05T10:00:01Z");
const entry = (id, event, extra = {}, ctx = {}) => ({
  id, event, state: "done", updatedAt: "2024-03-05T10:00:01Z",
  context: { timestamp: TS, ...ctx }, ...extra,
});
// The card titles of the history, in order (each is a line of its own before "Time:").
const titles = (out) => {
  const lines = plain(out).split("\n");
  return lines.filter((l, i) => lines[i + 1]?.startsWith("Time: "));
};
const logTitles = async (sb, history, args = []) => {
  mockTask(sb, history);
  const r = await sb.run(["task", "log", "t-1", ...args]);
  assert.equal(r.code, 0, r.stderr);
  return titles(r.stdout);
};
const tail = entry("tail", "tail-entry");

// ------------------------------------------------- history normalising

test("history: an applying entry that is not the last is left out, even with a rule", sandboxTest(async (sb) => {
  const h = [entry("a", "applying", { rule: { id: "r1", name: "ApplyingWithRule" } }), tail];
  assert.deepEqual(await logTitles(sb, h), ["created", "tail-entry"]);
}));

test("history: an applying entry that is the last one is kept", sandboxTest(async (sb) => {
  const h = [entry("a", "plain-entry"), entry("b", "applying")];
  assert.deepEqual(await logTitles(sb, h), ["created", "applying"]);
}));

test("history: an applying entry with audit items is still left out when not the last", sandboxTest(async (sb) => {
  const h = [entry("a", "applying", {}, { auditLog: [{ type: "message", msg: "m" }] }), tail];
  assert.deepEqual(await logTitles(sb, h), ["created", "tail-entry"]);
}));

test("history: an entry with audit items is kept, one without is dropped", sandboxTest(async (sb) => {
  const h = [
    entry("a", "with-audit", {}, { auditLog: [{ type: "message", msg: "m" }] }),
    entry("b", "no-audit", {}, { auditLog: [] }),
    tail,
  ];
  assert.deepEqual(await logTitles(sb, h), ["created", "with-audit", "tail-entry"]);
}));

test("history: an entry with a rule is kept and shown under the rule name", sandboxTest(async (sb) => {
  const h = [entry("a", "ruled-event", { rule: { id: "r1", name: "RuleName" } }), entry("b", "no-rule"), tail];
  assert.deepEqual(await logTitles(sb, h), ["created", "RuleName", "tail-entry"]);
}));

test("history: an entry in state created is kept and no second created entry is added", sandboxTest(async (sb) => {
  const h = [entry("a", "first-event", { state: "created" }), entry("b", "dropped-event"), tail];
  assert.deepEqual(await logTitles(sb, h), ["first-event", "tail-entry"]);
}));

test("history: the last entry is kept without audit, rule or special state", sandboxTest(async (sb) => {
  const h = [entry("a", "dropped-event"), entry("b", "last-event")];
  assert.deepEqual(await logTitles(sb, h), ["created", "last-event"]);
}));

test("history: every other entry is dropped", sandboxTest(async (sb) => {
  const h = [entry("a", "other-one"), entry("b", "other-two", { state: "waiting" }), entry("c", "last-event")];
  assert.deepEqual(await logTitles(sb, h), ["created", "last-event"]);
}));

test("history: an entry without a context is ignored; today that also drops the last entry", sandboxTest(async (sb) => {
  // The "last" test compares the index among the entries that have a context with the full
  // history length, so one context-less entry makes the real last entry miss it.
  const h = [entry("a", "other-one"), { id: "x", event: "no-context", state: "done" }, entry("c", "last-event")];
  assert.deepEqual(await logTitles(sb, h), ["created"]);
  const withRule = [{ id: "x", event: "no-context", state: "done" }, entry("c", "ruled", { rule: { id: "r", name: "Ruled" } })];
  assert.deepEqual(await logTitles(sb, withRule), ["created", "Ruled"]);
}));

test("history: an entry without a rule name or event is titled by its state", sandboxTest(async (sb) => {
  const h = [entry("a", undefined, { state: "waiting", rule: { id: "r1" } }), tail];
  assert.deepEqual(await logTitles(sb, h), ["created", "waiting", "tail-entry"]);
}));

// ------------------------------------------------------ status mapping

test("status: running shows as Processing, completed as Done, unknown prints as is", sandboxTest(async (sb) => {
  for (const [state, text] of [["running", "Processing"], ["completed", "Done"], ["mystery", "Mystery"]]) {
    mockTask(sb, [tail], { ...TASK, state });
    const r = await sb.run(["task", "log", "t-1"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`\nStatus: ● ${text}\n`), state);
  }
}));

test("status: the colour of the status follows the mapped name, unknown is grey", sandboxTest(async (sb) => {
  const status = async (state) => {
    mockTask(sb, [tail], { ...TASK, state });
    const r = await sb.run(["task", "log", "t-1"], { env: { FORCE_COLOR: "3" } });
    return r.stdout.split("\n").find((l) => plain(l).startsWith("Status: "));
  };
  assert.ok((await status("running")).includes(`${ESC}38;2;221;143;0m`)); // processing
  assert.ok((await status("completed")).includes(`${ESC}38;2;42;161;61m`)); // done
  const unknown = await status("mystery");
  assert.ok(unknown.includes(`${ESC}38;2;204;204;204m`)); // grey default
  assert.equal(plain(unknown), "Status: ● Mystery");
}));

test("status: event rows print Time, State and the card title; running and completed map for colour only", sandboxTest(async (sb) => {
  const h = [
    entry("a", "ev-running", { state: "running", rule: { id: "r1", name: "Card A" } }),
    entry("b", "ev-completed", { state: "completed", rule: { id: "r2", name: "Card B" } }),
    entry("c", "ev-odd", { state: "mystery" }),
  ];
  mockTask(sb, h);
  const r = await sb.run(["task", "log", "t-1"], { env: { FORCE_COLOR: "3" } });
  const lines = r.stdout.split("\n");
  const rowOf = (card) => {
    const i = lines.findIndex((l) => plain(l) === card);
    return { time: lines[i + 1], state: lines[i + 2] };
  };
  const a = rowOf("Card A");
  assert.match(plain(a.time), /^Time: \d{1,2}:\d\d:\d\d/);
  assert.equal(plain(a.state), "State: ● running");
  assert.ok(a.state.includes(`${ESC}38;2;221;143;0m`));
  const b = rowOf("Card B");
  assert.equal(plain(b.state), "State: ● completed");
  assert.ok(b.state.includes(`${ESC}38;2;42;161;61m`));
  const c = rowOf("ev-odd");
  assert.equal(plain(c.state), "State: ● mystery");
  assert.ok(c.state.includes(`${ESC}38;2;204;204;204m`));
}));

// ---------------------------------------------------- timestamp choice

const clock = (iso) => new Date(Date.parse(iso)).toLocaleTimeString("en-US", { timeZone: "UTC" });
const timeOf = async (sb, item) => {
  mockTask(sb, [item]);
  const r = await sb.run(["task", "log", "t-1"]);
  assert.equal(r.code, 0, r.stderr);
  const lines = plain(r.stdout).split("\n");
  return lines[lines.findIndex((l) => l === "last") + 1];
};
const stamped = (ctx, updatedAt) => ({ id: "l", event: "last", state: "done", updatedAt, context: ctx });
const SNAP = "2024-03-05T01:00:00Z";
const CTX = "2024-03-05T02:00:00Z";
const UPD = "2024-03-05T03:00:00Z";

test("timestamp: the snapshot timestamp wins over the context timestamp", sandboxTest(async (sb) => {
  const t = await timeOf(sb, stamped({ snapshot: { timestamp: Date.parse(SNAP) }, timestamp: Date.parse(CTX) }, UPD));
  assert.equal(t, `Time: ${clock(SNAP)}`);
}));

test("timestamp: the context timestamp wins over updatedAt", sandboxTest(async (sb) => {
  const t = await timeOf(sb, stamped({ timestamp: Date.parse(CTX) }, UPD));
  assert.equal(t, `Time: ${clock(CTX)}`);
}));

test("timestamp: updatedAt is used when the context has no timestamp", sandboxTest(async (sb) => {
  const t = await timeOf(sb, stamped({}, UPD));
  assert.equal(t, `Time: ${clock(UPD)}`);
}));

// --------------------------------------------------- integration list

test("integrations: entries with and without a current integration render without error", sandboxTest(async (sb) => {
  const h = [
    entry("a", "v3-with", { v: 3, rule: { id: "r1", name: "V3 With" } }, {
      content: { _currentIntegration: { z: { alias: "zeta-int" }, a: { alias: "alpha-int" } } },
    }),
    entry("b", "v3-without", { v: 3, rule: { id: "r2", name: "V3 Without" } }, { content: {} }),
    entry("c", "legacy", { rule: { id: "r3", name: "Legacy" } }, {
      integrations: [{ alias: "b-int" }, { alias: "a-int" }],
    }),
    entry("d", "legacy-none", {}, {}),
  ];
  mockTask(sb, h);
  const r = await sb.run(["task", "log", "t-1", "--logs", "--inspect"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(titles(r.stdout), ["created", "V3 With", "V3 Without", "Legacy", "legacy-none"]);
  // The integration list is collected but not printed today.
  assert.doesNotMatch(r.stdout, /zeta-int|alpha-int|a-int|b-int/);
}));

// ------------------------------------------------------- diff parts

test("diff: removed and added parts print their text, unchanged parts keep theirs", sandboxTest(async (sb) => {
  const task = { ...TASK, content: { data: { gone: 1, keep: "same" } } };
  const h = [
    entry("a", "step", { rule: { id: "r1", name: "Step" } }, { content: { data: { keep: "same", fresh: 2 } } }),
    entry("b", "last-event", {}, { content: { data: { keep: "same", fresh: 2 } } }),
  ];
  mockTask(sb, h, task);
  const r = await sb.run(["task", "log", "t-1", "--changes"], { env: { FORCE_COLOR: "1" } });
  assert.equal(r.code, 0, r.stderr);
  // the diff of the "Step" entry is the last one printed
  const diff = r.stdout.slice(r.stdout.lastIndexOf("Step Data Diff:"));
  const part = (text) => diff.split("\n").find((l) => plain(l).includes(text));
  // chalk level 1: red 31, green 32, gray 90
  assert.equal(plain(part('"gone": 1')).trim(), '"gone": 1,');
  assert.ok(part('"gone": 1').includes(`${ESC}31m`), "removed part is red");
  assert.equal(plain(part('"fresh": 2')).trim(), '"fresh": 2,');
  assert.ok(part('"fresh": 2').includes(`${ESC}32m`), "added part is green");
  assert.equal(plain(part('"keep": "same"')).trim(), '"keep": "same"');
  assert.ok(part('"keep": "same"').includes(`${ESC}90m`), "unchanged part is grey");
}));

// -------------------------------------------------- audit reference

test("audit reference: uses the name, falls back to the role", sandboxTest(async (sb) => {
  const h = [
    entry("a", "audited", { rule: { id: "r1", name: "Audited" } }, {
      content: {
        _currentAuditLog: [
          { type: "reference", name: "ticket", role: "owner", url: "https://example.invalid/t/1" },
          { type: "reference", role: "owner", url: "https://example.invalid/t/2" },
          { type: "reference", name: "doc", id: "ref-1" },
          { type: "reference", role: "reviewer", id: "ref-2" },
          { type: "reference", name: "nothing" },
        ],
      },
    }),
    tail,
  ];
  mockTask(sb, h);
  const r = await sb.run(["task", "log", "t-1", "--logs"]);
  assert.equal(r.code, 0, r.stderr);
  const refs = plain(r.stdout).split("\n").filter((l) => l.startsWith("Reference: "));
  assert.deepEqual(refs, [
    "Reference: ticket - https://example.invalid/t/1",
    "Reference: owner - https://example.invalid/t/2",
    "Reference: doc - ref-1",
    "Reference: reviewer - ref-2",
  ]);
}));

// ------------------------------------------------------ task new

test("task new: an empty name is a usage error and nothing is sent", sandboxTest(async (sb) => {
  sb.api.on("CREATE_TASK_MUTATION", { createAutomationTask: "t-new" });
  const r = await sb.run(["task", "new", "", "-d", '{"a":1}']);
  assert.equal(r.stderr, "⚠ Please provide a task name\n");
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  assert.equal(sb.api.calls.filter((c) => c.op === "CREATE_TASK_MUTATION").length, 0);
}));
