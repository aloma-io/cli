// Regression tests for `aloma workspace ...` (src/commands/workspace): what the commands do when no
// workspace resolves, which optional lines `show` prints, the stats defaults, and how `update`,
// `source` and `delete --days` build their requests.
// The CLI runs as a child process against a local fake API (see helpers/cli-harness.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, FAKE_TOKEN } from "./helpers/cli-harness.js";

const wsState = (o) => ({ getAutomationEnvironment: { id: "ws-sel", name: "Dev Space", ...o } });
const stats = (o) => ({ getAutomationEnvironmentWithStats: { id: "ws-sel", name: "N", ...o } });
const NO_SELECTION = { session: { token: FAKE_TOKEN, selectedWorkspace: null } };

// 1. nothing resolves: no further request, no mutation, exit code as for a cancelled pick

const RESOLVING = [
  ["show", ["workspace", "show"]],
  ["show --stats", ["workspace", "show", "--stats"]],
  ["show --source", ["workspace", "show", "--source"]],
  ["update", ["workspace", "update", "-n", "New"]],
  ["delete", ["workspace", "delete"]],
  ["archive", ["workspace", "archive"]],
  ["source", ["workspace", "source", "--branch", "x"]],
  ["sync", ["workspace", "sync"]],
];
for (const [label, args] of RESOLVING) {
  test(`workspace ${label}: with no workspace selected nothing further is sent and it exits 1`, sandboxTest(NO_SELECTION, async (sb) => {
    const r = await sb.run(args);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "No workspace selected. Use `aloma workspace switch` to select one.\n");
    assert.deepEqual(sb.api.calls, []);
  }));
}

test("workspace delete <unknown name>: the lookup is the only request and nothing is deleted", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [{ id: "ws-2", name: "Other" }] });
  const r = await sb.run(["workspace", "delete", "nope"]);
  assert.equal(r.code, 1);
  assert.deepEqual(sb.api.ops(), ["LIST_ENVIRONMENTS_QUERY"]);
}));

// 2. show: each optional line only when its field is present and of the right type

test("workspace show: autoclean Disabled, archived Yes, deleting without a time, health checks Disabled", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ autoclean: false, archived: true, deleting: true, health_enabled: false }));
  const r = await sb.run(["workspace", "show"]);
  assert.equal(r.code, 0);
  assert.equal(
    r.stdout,
    [
      "", "Dev Space  (ID: ws-sel)", "Tags: None", "Autoclean: Disabled", "Archived: Yes",
      "This workspace is being deleted.", "Health Checks: Disabled", "Task Notification Groups: Disabled", "",
    ].join("\n"),
  );
}));

test("workspace show: the deletion time is added when there is one", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ deleting: true, deleting_at: "2030-01-01" }));
  const r = await sb.run(["workspace", "show"]);
  assert.match(r.stdout, /^This workspace is being deleted\. \(at: 2030-01-01\)$/m);
}));

test("workspace show: a workspace with none of the optional fields prints none of those lines", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ deleting: false, deleting_at: "2030-01-01" }));
  const r = await sb.run(["workspace", "show"]);
  assert.equal(r.stdout, "\nDev Space  (ID: ws-sel)\nTags: None\nTask Notification Groups: Disabled\n");
}));

test("workspace show: fields of the wrong type print no line", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ autoclean: "yes", archived: "no", deleting: "true", health_enabled: 1 }));
  const r = await sb.run(["workspace", "show"]);
  assert.equal(r.stdout, "\nDev Space  (ID: ws-sel)\nTags: None\nTask Notification Groups: Disabled\n");
}));

// 3. stats

test("workspace show --stats: a missing or non-numeric test percentage counts as 0", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_STATS_QUERY", stats({}));
  let r = await sb.run(["workspace", "show", "--stats"]);
  assert.equal(r.stdout.match(/Automated: 0% {3}\| {3}Manual: 100%/g).length, 2);
  sb.api.on("GET_WORKSPACE_STATS_QUERY", stats({ testPercentage7: "abc", testPercentage30: "abc" }));
  r = await sb.run(["workspace", "show", "--stats"]);
  assert.equal(r.stdout.match(/Automated: 0% {3}\| {3}Manual: 100%/g).length, 2);
}));

test("workspace show --stats: numeric percentages are shown with their complement", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_STATS_QUERY", stats({ testPercentage7: 25, testPercentage30: 80 }));
  const r = await sb.run(["workspace", "show", "--stats"]);
  assert.match(r.stdout, /last 7 days\):\n {2}Automated: 25% {3}\| {3}Manual: 75%/);
  assert.match(r.stdout, /last 30 days\):\n {2}Automated: 80% {3}\| {3}Manual: 20%/);
}));

test("workspace show --stats: connector issues are singular for 1 and plural for 2", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_STATS_QUERY", stats({ connectorIssues: 1 }));
  let r = await sb.run(["workspace", "show", "--stats"]);
  assert.match(r.stdout, /^ {2}1 connector with health issues$/m);
  sb.api.on("GET_WORKSPACE_STATS_QUERY", stats({ connectorIssues: 2 }));
  r = await sb.run(["workspace", "show", "--stats"]);
  assert.match(r.stdout, /^ {2}2 connectors with health issues$/m);
}));

test("workspace show --stats: no connector issues prints no health section", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_STATS_QUERY", stats({ connectorIssues: 0 }));
  const r = await sb.run(["workspace", "show", "--stats"]);
  assert.doesNotMatch(r.stdout, /HEALTH ISSUES/);
}));

// 4. update keeps what is stored

test("workspace update: without --tags the stored tags are sent again", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ tags: ["a", "b"] }));
  sb.api.on("SAVE_WORKSPACE_MUTATION", { saveAutomationEnvironment: true });
  const r = await sb.run(["workspace", "update", "-n", "Renamed"]);
  assert.equal(r.stdout, "Workspace [Dev Space] updated successfully.\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    id: "ws-sel", name: "Renamed", tags: ["a", "b"], task_notification_groups: null,
  });
}));

test("workspace update: without --tags and without stored tags an empty list is sent", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({}));
  sb.api.on("SAVE_WORKSPACE_MUTATION", { saveAutomationEnvironment: true });
  await sb.run(["workspace", "update"]);
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    id: "ws-sel", name: "Dev Space", tags: [], task_notification_groups: null,
  });
}));

// 5. source update: option, else stored value, else default

const STORED = { url: "https://example.invalid/stored.git", username: "stored-user", branch: "stored-branch", enabled: false, source_automatic: false };
const sourceRun = async (sb, source, args) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", name: "N", source } });
  sb.api.on("SAVE_SOURCE_MUTATION", { saveAutomationEnvironmentSource: true });
  const r = await sb.run(["workspace", "source", ...args]);
  assert.equal(r.code, 0);
  return sb.api.calls.at(-1).variables;
};

test("workspace source: every option given wins over the stored value", sandboxTest(async (sb) => {
  const v = await sourceRun(sb, STORED, [
    "--url", "https://example.invalid/new.git", "--username", "new-user", "--apikey", "not-a-token",
    "--branch", "new-branch", "--enabled", "true", "--source-automatic", "true",
  ]);
  assert.deepEqual(v, {
    id: "ws-sel", url: "https://example.invalid/new.git", username: "new-user", apikey: "not-a-token",
    branch: "new-branch", enabled: true, source_automatic: true,
  });
}));

test("workspace source: a missing option keeps the stored value", sandboxTest(async (sb) => {
  const stored = { ...STORED, enabled: true, source_automatic: true };
  const v = await sourceRun(sb, stored, ["--branch", "other"]);
  assert.deepEqual(v, {
    id: "ws-sel", url: stored.url, username: "stored-user", apikey: null, branch: "other",
    enabled: true, source_automatic: true,
  });
}));

test("workspace source: with neither option nor stored value, text fields are null and flags false", sandboxTest(async (sb) => {
  const v = await sourceRun(sb, {}, []);
  assert.deepEqual(v, {
    id: "ws-sel", url: null, username: null, apikey: null, branch: null, enabled: false, source_automatic: false,
  });
}));

test("workspace source --file: the file's keys are sent as they are, with the workspace id", sandboxTest(async (sb) => {
  sb.write("src.json", JSON.stringify({ branch: "from-file", username: null }));
  sb.api.on("SAVE_SOURCE_MUTATION", { saveAutomationEnvironmentSource: true });
  const r = await sb.run(["workspace", "source", "-f", "src.json"]);
  assert.equal(r.code, 0);
  assert.deepEqual(sb.api.calls.map((c) => [c.op, c.variables]), [
    ["SAVE_SOURCE_MUTATION", { id: "ws-sel", branch: "from-file", username: null }],
  ]);
}));

// 6. delete --days

test("workspace delete --days 12: the day count is sent as a number", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({}));
  sb.api.on("DELETE_WORKSPACE_MUTATION", { deleteAutomationEnvironment: true });
  const r = await sb.run(["workspace", "delete", "--days", "12"]);
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "ws-sel", delete: true, deletionDays: 12 });
  assert.equal(typeof sb.api.calls.at(-1).variables.deletionDays, "number");
  assert.match(r.stdout, /Workspace will be permanently deleted in 12 days\./);
}));

test("workspace delete --days '': no day count is sent and no schedule is printed", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({}));
  sb.api.on("DELETE_WORKSPACE_MUTATION", { deleteAutomationEnvironment: true });
  const r = await sb.run(["workspace", "delete", "--days", ""]);
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "ws-sel", delete: true });
  assert.equal(r.stdout, "Deletion started for workspace [Dev Space]\n");
}));
