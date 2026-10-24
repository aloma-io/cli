// Characterisation tests for `aloma task ...` (src/commands/task).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, gqlError } from "./helpers/cli-harness.js";

const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);

// ------------------------------------------------------------------- list

const T = (o) => ({
  id: "t-1", name: "order", state: "done", duration: 1500, steps: 3, tags: ["x", "y"],
  createdAt: "2024-03-05T10:00:00Z", ...o,
});

test("task list: first page, 10 per page, prints status/duration/steps/tags/created", sandboxTest(async (sb) => {
  sb.api.on("LIST_TASKS_QUERY", {
    listAutomationEnvironmentTasks: [
      T({}),
      T({ id: "t-2", name: "refund", state: "completed", duration: null, tags: [] }),
      T({ id: "t-3", name: "sync", state: "RUNNING", tags: null }),
      T({ id: "t-4", name: "odd", state: "weird" }),
    ],
  });
  const r = await sb.run(["task", "list"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["LIST_TASKS_QUERY", { id: "ws-sel", state: null, name: null, offset: 0, limit: 10 }]]);
  const out = r.stdout.split("\n");
  assert.equal(out[1], "📊 Tasks in Current Workspace");
  const block = (name) => out.slice(out.indexOf(name), out.indexOf(name) + 7);
  assert.deepEqual(block("order").slice(0, 5), ["order", "   ID: t-1", "   Status: ● Done", "   Duration: 1500ms", "   Steps: 3"]);
  assert.equal(block("order")[5], "   Tags: x, y");
  assert.match(block("order")[6], /^ {3}Created: .*2024/);
  // "completed" is shown as Done, "RUNNING" as Processing, unknown states are capitalised
  assert.equal(block("refund")[2], "   Status: ● Done");
  assert.equal(block("refund")[3], "   Duration: N/A");
  assert.equal(block("sync")[2], "   Status: ● Processing");
  assert.equal(block("odd")[2], "   Status: ● Weird");
  // no tags -> no Tags line
  assert.match(block("refund")[5], /^ {3}Created:/);
}));

test("task list: --page, --state, --name map to offset and filters", sandboxTest(async (sb) => {
  sb.api.on("LIST_TASKS_QUERY", { listAutomationEnvironmentTasks: [] });
  const r = await sb.run(["task", "list", "-p", "3", "-s", "error", "-n", "order"]);
  assert.equal(r.stdout, "No tasks found in current workspace.\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "ws-sel", state: "error", name: "order", offset: 20, limit: 10 });
}));

test("task list: page 0 gives a negative offset, a non-number gives null", sandboxTest(async (sb) => {
  sb.api.on("LIST_TASKS_QUERY", { listAutomationEnvironmentTasks: [] });
  await sb.run(["task", "list", "-p", "0"]);
  // PINS SUSPECT BEHAVIOUR: no validation of the page number.
  assert.equal(sb.api.calls.at(-1).variables.offset, -10);
  await sb.run(["task", "list", "-p", "abc"]);
  assert.equal(sb.api.calls.at(-1).variables.offset, null);
}));

test("task list: a task without a state breaks the whole listing", sandboxTest(async (sb) => {
  sb.api.on("LIST_TASKS_QUERY", { listAutomationEnvironmentTasks: [T({}), T({ id: "t-2", state: null })] });
  const r = await sb.run(["task", "list"]);
  // PINS SUSPECT BEHAVIOUR: the first task was already printed, then the null state throws.
  assert.equal(r.code, 0);
  assert.match(r.stdout, /order/);
  assert.match(r.stderr, /Error listing tasks: Cannot read properties of null/);
}));

test("task list: API error; no workspace", sandboxTest(async (sb) => {
  sb.api.on("LIST_TASKS_QUERY", gqlError("denied"));
  let r = await sb.run(["task", "list"]);
  assert.match(r.stderr, /Error listing tasks: denied/);
  assert.equal(r.code, 0);
}));

test("task list: no workspace selected", sandboxTest({ session: { token: "t" } }, async (sb) => {
  const r = await sb.run(["task", "list"]);
  assert.equal(r.stdout, "No workspace selected. Use `aloma workspace switch` to select one.\n");
  assert.deepEqual(sb.api.calls, []);
}));

// --------------------------------------------------------------------- log

const TASK = {
  id: "t-1", name: "order", state: "completed", duration: 1500, tags: ["x"],
  createdAt: "2024-03-05T10:00:00Z", updatedAt: "2024-03-05T10:05:00Z", content: { data: { a: 1 } },
};
const HIST = () => [
  {
    id: "h1", event: "rule", state: "done", rule: { id: "r1", name: "Step One" },
    updatedAt: "2024-03-05T10:00:01Z",
    context: {
      timestamp: Date.parse("2024-03-05T10:00:01Z"),
      content: {
        data: { a: 1, b: 2 }, changes: [],
        _currentConsoleLog: [{ ts: Date.parse("2024-03-05T10:00:01Z"), msg: "hello console" }],
        _currentAuditLog: [
          { type: "message", msg: "audit one" },
          { type: "subtask", action: "add", name: "child", id: "sub-1" },
          { type: "subtask", action: "resolve", name: "child", id: "sub-1" },
          { type: "reference", name: "ticket", url: "https://example.invalid/t/1" },
          { type: "reference", role: "owner", id: "ref-9" },
        ],
      },
    },
  },
  {
    id: "h2", event: "rule", state: "error", error: "it broke", rule: { id: "r2", name: "Step Two" },
    updatedAt: "2024-03-05T10:00:02Z",
    context: { timestamp: Date.parse("2024-03-05T10:00:02Z"), content: { data: { a: 1, b: 2, c: 3 } } },
  },
];
const mockTask = (sb, task = TASK, history = HIST()) =>
  sb.api.on("GET_TASK_QUERY", () => ({
    getAutomationEnvironmentTask: task,
    getAutomationEnvironmentTaskHistory: JSON.parse(JSON.stringify(history)),
  }));

test("task log: details and execution history, a 'created' event is added up front", sandboxTest(async (sb) => {
  mockTask(sb);
  const r = await sb.run(["task", "log", "t-1"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["GET_TASK_QUERY", { id: "t-1" }]]);
  const out = r.stdout;
  assert.match(out, /^\n📊 Task Details\n\nName: order\nID: t-1\nStatus: ● Done\nCreated: .*2024.*\nUpdated: .*2024.*\nDuration: 1500ms\nTags: x\n/);
  assert.match(out, /\nContent:\n\{\n {2}"data": \{\n {4}"a": 1\n {2}\}\n\}\n/);
  assert.match(out, /\nExecution History\n━+\n/);
  const titles = [...out.matchAll(/^\n?(created|Step One|Step Two)$/gm)].map((m) => m[1]);
  assert.deepEqual(titles, ["created", "Step One", "Step Two"]);
  assert.match(out, /State: ● created/);
  assert.match(out, /State: ● done/);
  assert.match(out, /State: ● error/);
  assert.match(out, /Error: it broke/);
  // without --logs/--changes/--inspect nothing else is shown
  assert.doesNotMatch(out, /hello console|Step Data/);
}));

test("task log --logs: console log and audit entries per step", sandboxTest(async (sb) => {
  mockTask(sb);
  const r = await sb.run(["task", "log", "t-1", "--logs"]);
  assert.match(r.stdout, /Console Log:\n\[[^\]]+\] hello console\n/);
  assert.match(r.stdout, /Audit Log:\naudit one\nchild ● created\n {4}ID: sub-1\nchild ● completed\n {4}ID: sub-1\nReference: ticket - https:\/\/example\.invalid\/t\/1\nReference: owner - ref-9\n/);
}));

test("task log --changes / --inspect: diff and data for every step except the last", sandboxTest(async (sb) => {
  mockTask(sb);
  let r = await sb.run(["task", "log", "t-1", "--changes"]);
  assert.equal((r.stdout.match(/Step Data Diff:/g) || []).length, 2); // created, Step One (not the last)
  assert.match(r.stdout, /"b": 2/);
  r = await sb.run(["task", "log", "t-1", "--inspect"]);
  assert.equal((r.stdout.match(/Step Data:/g) || []).length, 2);
  assert.match(r.stdout, /Step Data:\n\{\n {2}"a": 1,\n {2}"b": 2\n\}/);
}));

test("task log --step <n>: restricts logs to that entry; out of range is refused", sandboxTest(async (sb) => {
  mockTask(sb);
  let r = await sb.run(["task", "log", "t-1", "--logs", "--step", "2"]);
  // entry 2 (Step Two) has no logs, so nothing from Step One appears
  assert.doesNotMatch(r.stdout, /hello console/);
  r = await sb.run(["task", "log", "t-1", "--logs", "--step", "1"]);
  assert.match(r.stdout, /hello console/);
  r = await sb.run(["task", "log", "t-1", "--step", "9"]);
  assert.match(r.stdout, /Task Details/);
  assert.match(r.stdout, /Invalid step number specified\.\n$/);
  assert.doesNotMatch(r.stdout, /Execution History/);
  r = await sb.run(["task", "log", "t-1", "--step", "x"]);
  assert.match(r.stdout, /Invalid step number specified\.\n$/);
  // the history has 3 entries (created, Step One, Step Two): index 3 is already out of range, 2 is the last valid one
  r = await sb.run(["task", "log", "t-1", "--step", "3"]);
  assert.match(r.stdout, /Invalid step number specified\.\n$/);
  r = await sb.run(["task", "log", "t-1", "--step", "2"]);
  assert.match(r.stdout, /Execution History/);
  r = await sb.run(["task", "log", "t-1", "--step", "-1"]);
  assert.match(r.stdout, /Invalid step number specified\.\n$/);
}));

test("task log: task without history, unknown task, API error", sandboxTest(async (sb) => {
  mockTask(sb, { ...TASK, content: null, tags: [], duration: null }, []);
  let r = await sb.run(["task", "log", "t-1"]);
  assert.match(r.stdout, /Duration: N\/A\n$/);
  mockTask(sb, null, []);
  r = await sb.run(["task", "log", "t-1"]);
  assert.equal(r.stdout, "⚠ Task with ID t-1 not found\n");
  sb.api.on("GET_TASK_QUERY", gqlError("denied"));
  r = await sb.run(["task", "log", "t-1"]);
  assert.match(r.stderr, /Error showing task: denied/);
  assert.equal(r.code, 0);
}));

// --------------------------------------------------------------------- new

test("task new -d: JSON is parsed and sent as content", sandboxTest(async (sb) => {
  sb.api.on("CREATE_TASK_MUTATION", { createAutomationTask: "t-new" });
  const r = await sb.run(["task", "new", "order", "-d", '{"test":true,"n":[1,2]}']);
  assert.equal(r.stdout, "✓ Task created successfully with ID: t-new\n");
  assert.deepEqual(ops(sb), [["CREATE_TASK_MUTATION", { name: "order", content: { test: true, n: [1, 2] }, environment_id: "ws-sel" }]]);
}));

test("task new -f: .json and .yaml/.yml files", sandboxTest(async (sb) => {
  sb.api.on("CREATE_TASK_MUTATION", { createAutomationTask: "t-new" });
  sb.write("d.json", '{"a":1}');
  sb.write("d.yaml", "a: 2\nlist:\n  - x\n");
  sb.write("d.YML", "a: 3\n");
  for (const [file, expected] of [["d.json", { a: 1 }], ["d.yaml", { a: 2, list: ["x"] }], ["d.YML", { a: 3 }]]) {
    const r = await sb.run(["task", "new", "n", "-f", file]);
    assert.equal(r.stdout, "✓ Task created successfully with ID: t-new\n", file);
    assert.deepEqual(sb.api.calls.at(-1).variables.content, expected, file);
  }
}));

test("task new: --data wins over --file", sandboxTest(async (sb) => {
  sb.api.on("CREATE_TASK_MUTATION", { createAutomationTask: "t-new" });
  sb.write("d.json", '{"from":"file"}');
  await sb.run(["task", "new", "n", "-d", '{"from":"flag"}', "-f", "d.json"]);
  assert.deepEqual(sb.api.calls.at(-1).variables.content, { from: "flag" });
}));

test("task new: no data, unsupported extension, bad JSON, bad YAML, missing file", sandboxTest(async (sb) => {
  sb.api.on("CREATE_TASK_MUTATION", { createAutomationTask: "t-new" });
  let r = await sb.run(["task", "new", "n"]);
  assert.equal(r.stdout, "⚠ No data provided\n");
  sb.write("d.txt", "x");
  r = await sb.run(["task", "new", "n", "-f", "d.txt"]);
  assert.equal(r.stdout, "⚠ Unsupported file extension. Only .json and .yaml/.yml are supported.\n");
  r = await sb.run(["task", "new", "n", "-d", "{nope"]);
  assert.match(r.stderr, /^Error parsing JSON\/YAML data: /);
  sb.write("bad.yaml", "a: [1\n");
  r = await sb.run(["task", "new", "n", "-f", "bad.yaml"]);
  assert.match(r.stderr, /^Error parsing JSON\/YAML data: /);
  r = await sb.run(["task", "new", "n", "-f", "missing.json"]);
  assert.match(r.stderr, /Error parsing JSON\/YAML data: ENOENT/);
  assert.deepEqual(sb.api.calls, []);
  assert.equal(r.code, 0);
}));

test("task new: API error; -w name is resolved", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [{ id: "ws-7", name: "Seven" }] });
  sb.api.on("CREATE_TASK_MUTATION", gqlError("bad content"));
  const r = await sb.run(["task", "new", "n", "-d", "{}", "-w", "seven"]);
  assert.match(r.stderr, /Error creating task: bad content/);
  assert.equal(sb.api.calls.at(-1).variables.environment_id, "ws-7");
}));

// ------------------------------------------------------- clone/stop/resume

test("task clone: plain clone sends the task id", sandboxTest(async (sb) => {
  sb.api.on("CLONE_TASK_MUTATION", { createAutomationTaskFromTask: "t-copy" });
  const r = await sb.run(["task", "clone", "t-1"]);
  assert.equal(r.stdout, "✓ Task cloned successfully with ID: t-copy\n");
  assert.deepEqual(ops(sb), [["CLONE_TASK_MUTATION", { id: "t-1" }]]);
}));

test("task clone --step n: creates a task from the n-th history entry", sandboxTest(async (sb) => {
  mockTask(sb);
  sb.api.on("NEW_TASK_FROM_HISTORY_MUTATION", { createAutomationTaskFromHistory: "t-from-h" });
  const r = await sb.run(["task", "clone", "t-1", "-s", "2"]);
  assert.equal(r.stdout, "✓ Task created successfully with ID: t-from-h\n");
  assert.deepEqual(ops(sb), [["GET_TASK_QUERY", { id: "t-1" }], ["NEW_TASK_FROM_HISTORY_MUTATION", { id: "h2" }]]);
}));

test("task clone --step 0 sends the synthetic id 'created'", sandboxTest(async (sb) => {
  mockTask(sb);
  sb.api.on("NEW_TASK_FROM_HISTORY_MUTATION", { createAutomationTaskFromHistory: "t-from-h" });
  await sb.run(["task", "clone", "t-1", "-s", "0"]);
  // PINS SUSPECT BEHAVIOUR: entry 0 is the made-up "created" event whose id is not a real history id.
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "created" });
}));

test("task clone --step: out-of-range step; API error", sandboxTest(async (sb) => {
  mockTask(sb);
  let r = await sb.run(["task", "clone", "t-1", "-s", "7"]);
  assert.equal(r.stdout, "Invalid step number specified.\n");
  r = await sb.run(["task", "clone", "t-1", "-s", "3"]); // 3 entries -> highest valid index is 2
  assert.equal(r.stdout, "Invalid step number specified.\n");
  r = await sb.run(["task", "clone", "t-1", "-s", "-1"]);
  assert.equal(r.stdout, "Invalid step number specified.\n");
  assert.ok(!sb.api.ops().includes("NEW_TASK_FROM_HISTORY_MUTATION"));
  sb.api.on("CLONE_TASK_MUTATION", gqlError("denied"));
  r = await sb.run(["task", "clone", "t-1"]);
  assert.match(r.stderr, /Error cloning task: denied/);
  assert.equal(r.code, 0);
}));

test("task stop: success, refusal, error", sandboxTest(async (sb) => {
  sb.api.on("STOP_TASK_MUTATION", { stopAutomationTask: true });
  let r = await sb.run(["task", "stop", "t-1"]);
  assert.equal(r.stdout, "✓ Task t-1 stopped successfully\n");
  assert.deepEqual(ops(sb), [["STOP_TASK_MUTATION", { id: "t-1" }]]);
  sb.api.on("STOP_TASK_MUTATION", { stopAutomationTask: false });
  r = await sb.run(["task", "stop", "t-1"]);
  assert.equal(r.stdout, "⚠ Task t-1 could not be stopped\n");
  sb.api.on("STOP_TASK_MUTATION", gqlError("denied"));
  r = await sb.run(["task", "stop", "t-1"]);
  assert.match(r.stderr, /Error stopping task: denied/);
}));

test("task resume: success, refusal, error", sandboxTest(async (sb) => {
  sb.api.on("RESUME_TASK_MUTATION", { resumeAutomationTaskFromHistory: true });
  let r = await sb.run(["task", "resume", "t-1"]);
  assert.equal(r.stdout, "✓ Task t-1 resumed successfully\n");
  assert.deepEqual(ops(sb), [["RESUME_TASK_MUTATION", { id: "t-1" }]]);
  sb.api.on("RESUME_TASK_MUTATION", { resumeAutomationTaskFromHistory: false });
  r = await sb.run(["task", "resume", "t-1"]);
  assert.equal(r.stdout, "⚠ Task t-1 could not be resumed\n");
  sb.api.on("RESUME_TASK_MUTATION", gqlError("denied"));
  r = await sb.run(["task", "resume", "t-1"]);
  assert.match(r.stderr, /Error resuming task: denied/);
}));
