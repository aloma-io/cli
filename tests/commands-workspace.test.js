// Characterisation tests for `aloma workspace ...` (src/commands/workspace).
// Pins today's behaviour: arguments -> GraphQL requests -> printed output -> exit code.
// The CLI runs as a child process against a local fake API (see helpers/cli-harness.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, gqlError, FAKE_TOKEN } from "./helpers/cli-harness.js";

const ENVS = {
  listAutomationEnvironmentWithStats: [
    { id: "ws-sel", name: "Dev Space" },
    { id: "ws-2", name: "Other" },
  ],
};
const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);

test("workspace list: sends the list query with no filters and marks the current workspace", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", ENVS);
  const r = await sb.run(["workspace", "list"]);
  assert.equal(r.code, 0);
  assert.equal(
    r.stdout,
    "\nAvailable workspaces:\nDev Space (ID:ws-sel) [*]\nOther (ID:ws-2)\n",
  );
  assert.deepEqual(ops(sb), [["LIST_ENVIRONMENTS_QUERY", {}]]);
  assert.equal(sb.api.calls[0].headers.authorization, `Bearer ${FAKE_TOKEN}`);
}));

test("workspace list: --tags and --archived are passed as variables (tags stay one string)", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", ENVS);
  const r = await sb.run(["workspace", "list", "-t", "a,b", "-a"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["LIST_ENVIRONMENTS_QUERY", { tags: "a,b", archived: true }]]);
}));

test("workspace list: --filter-name is accepted but never sent or applied", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", ENVS);
  const r = await sb.run(["workspace", "list", "-f", "Other"]);
  assert.equal(r.code, 0);
  // PINS SUSPECT BEHAVIOUR: the filter option is dropped; both workspaces are listed.
  assert.match(r.stdout, /Dev Space/);
  assert.match(r.stdout, /Other/);
  assert.deepEqual(ops(sb), [["LIST_ENVIRONMENTS_QUERY", {}]]);
}));

test("workspace list: empty result and API error", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [] });
  let r = await sb.run(["workspace", "list"]);
  assert.equal(r.stdout, "No environments found.\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", gqlError("boom one", "boom two"));
  r = await sb.run(["workspace", "list"]);
  // PLAT-81: an API error exits 1 (was PINS SUSPECT BEHAVIOUR: printed but exit code 0).
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  // PLAT-81: the error is printed once (was a "GraphQL Error:" copy first).
  assert.equal(r.stderr, "Error fetching environments: boom one\nboom two\n");
}));

test("workspace show: default view queries the selected workspace and prints its settings", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", {
    getAutomationEnvironment: {
      id: "ws-sel", name: "Dev Space", type: "dev", tags: ["x", "y"], autoclean: true,
      clean_interval: 14, archived: false, deleting: false, health_enabled: true,
      task_notification_groups: ["ops"],
    },
  });
  const r = await sb.run(["workspace", "show"]);
  assert.equal(r.code, 0);
  assert.equal(
    r.stdout,
    [
      "", "Dev Space  (ID: ws-sel)", "Type: dev", "Tags: x, y", "Autoclean: Enabled",
      "Clean Interval: 14 days", "Archived: No", "Health Checks: Enabled",
      "Task Notification Groups: ops", "",
    ].join("\n"),
  );
  assert.deepEqual(ops(sb), [["GET_WORKSPACE_QUERY", { id: "ws-sel" }]]);
}));

test("workspace show: no tags / no groups / deleting workspace", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", {
    getAutomationEnvironment: {
      id: "ws-sel", name: null, tags: [], deleting: true, deleting_at: "2030-01-01",
      task_notification_groups: [],
    },
  });
  const r = await sb.run(["workspace", "show"]);
  assert.match(r.stdout, /Unnamed Workspace {2}\(ID: ws-sel\)/);
  assert.match(r.stdout, /Tags: None/);
  assert.match(r.stdout, /This workspace is being deleted\. \(at: 2030-01-01\)/);
  assert.match(r.stdout, /Task Notification Groups: Disabled/);
}));

test("workspace show: workspace not found", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", { getAutomationEnvironment: null });
  const r = await sb.run(["workspace", "show"]);
  // PLAT-81: a failure exits 1 and is printed on stderr (was stdout, exit 0).
  assert.equal(r.stderr, "Workspace not found.\n");
  assert.equal(r.code, 1);
}));

test("workspace show --stats: stats query and summary", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_STATS_QUERY", {
    getAutomationEnvironmentWithStats: {
      id: "ws-sel", name: "Dev Space", type: "dev", testPercentage7: 40, tasks7: 3,
      tasks30: 9, tasks: 20, steps7: 1, steps30: 2, steps: 5, connectors: 4, webhooks: 2,
      health: { enabled: false, unused: { steps: 2, webhooks: 0, connectors: 1 },
        failing: { tests: 3, connectors: [{ name: "c1", healthy: false, health_error: "down" }] } },
    },
  });
  const r = await sb.run(["workspace", "show", "--stats"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["GET_WORKSPACE_STATS_QUERY", { id: "ws-sel" }]]);
  assert.match(r.stdout, /Automated: 40%\s+\|\s+Manual: 60%/);
  // PINS SUSPECT BEHAVIOUR: the 30-day block reads testPercentage30, which the stats query
  // does not request, so it always shows 0% automated / 100% manual.
  assert.match(r.stdout, /Automated: 0%\s+\|\s+Manual: 100%/);
  assert.match(r.stdout, /3 \(7d\) {3}9 \(30d\) {3}20 \(All\)/);
  assert.match(r.stdout, /Health checks are disabled for this workspace\./);
  assert.match(r.stdout, /2 unused steps/);
  assert.match(r.stdout, /1 unused connectors/);
  assert.match(r.stdout, /Failing connector: c1 - down/);
  assert.match(r.stdout, /3 failing tests/);
  assert.match(r.stdout, /Connectors: 4 {2}Webhooks: 2/);
}));

test("workspace show --stats: healthy workspace and connectorIssues fallback", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_STATS_QUERY", {
    getAutomationEnvironmentWithStats: { id: "ws-sel", name: "N", health: { enabled: true } },
  });
  let r = await sb.run(["workspace", "show", "--stats"]);
  assert.match(r.stdout, /No health issues detected\./);
  sb.api.on("GET_WORKSPACE_STATS_QUERY", {
    getAutomationEnvironmentWithStats: { id: "ws-sel", name: "N", connectorIssues: 2 },
  });
  r = await sb.run(["workspace", "show", "--stats"]);
  assert.match(r.stdout, /2 connectors with health issues/);
}));

test("workspace show --source: prints each source field", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", {
    getAutomationEnvironment: { id: "ws-sel", name: "Dev Space",
      source: { url: "https://example.invalid/r.git", username: "u", has_apikey: true, branch: "main" } },
  });
  const r = await sb.run(["workspace", "show", "--source"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["GET_SOURCE_QUERY", { id: "ws-sel" }]]);
  assert.match(r.stdout, /Source configuration for workspace: Dev Space \(ID: ws-sel\)/);
  assert.match(r.stdout, /url: https:\/\/example\.invalid\/r\.git/);
  assert.match(r.stdout, /has_apikey: true/);
  assert.match(r.stdout, /branch: main/);
}));

test("workspace show --source: archived, no source, not found", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", archived: true } });
  let r = await sb.run(["workspace", "show", "--source"]);
  assert.match(r.stdout, /Workspace is archived, being deleted, or scheduled for deletion\. No source info shown\./);
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", source: null } });
  r = await sb.run(["workspace", "show", "--source"]);
  assert.equal(r.stdout, "No source configuration found for this workspace.\n");
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: null });
  r = await sb.run(["workspace", "show", "--source"]);
  // PLAT-81: a failure exits 1 and is printed on stderr (was stdout, exit 0).
  assert.equal(r.stderr, "Workspace not found.\n");
  assert.equal(r.code, 1);
}));

test("workspace show: --stats wins over --source when both are given", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_STATS_QUERY", { getAutomationEnvironmentWithStats: { id: "ws-sel", name: "N" } });
  await sb.run(["workspace", "show", "--stats", "--source"]);
  assert.deepEqual(sb.api.ops(), ["GET_WORKSPACE_STATS_QUERY"]);
}));

test("no workspace selected: command stops with a hint and sends no request", sandboxTest({ session: { token: "t" } }, async (sb) => {
  const r = await sb.run(["workspace", "show"]);
  // PLAT-81: a failure exits 1 and is printed on stderr (was stdout, exit 0).
  assert.equal(r.stderr, "No workspace selected. Use `aloma workspace switch` to select one.\n");
  assert.equal(r.code, 1);
  assert.deepEqual(sb.api.calls, []);
}));

test("-w <name>: resolves the name case-insensitively through the list query", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", ENVS);
  sb.api.on("GET_WORKSPACE_QUERY", { getAutomationEnvironment: { id: "ws-2", name: "Other" } });
  const r = await sb.run(["workspace", "show", "-w", "oTHer"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["LIST_ENVIRONMENTS_QUERY", {}], ["GET_WORKSPACE_QUERY", { id: "ws-2" }]]);
}));

test("-w <unknown>: the raw value is used as the id when nothing matches", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", ENVS);
  sb.api.on("GET_WORKSPACE_QUERY", { getAutomationEnvironment: null });
  await sb.run(["workspace", "show", "-w", "nope"]);
  assert.deepEqual(ops(sb)[1], ["GET_WORKSPACE_QUERY", { id: "nope" }]);
}));

test("workspace switch <name>: saves the id to the session file", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", ENVS);
  const r = await sb.run(["workspace", "switch", "other"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "Switched to workspace [Other]\n");
  assert.equal(sb.readSession().selectedWorkspace, "ws-2");
  assert.equal(sb.readSession().token, FAKE_TOKEN);
  assert.deepEqual(ops(sb), [["LIST_WORKSPACES_QUERY", {}]]);
}));

test("workspace switch <id>: matches on id as well", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", ENVS);
  await sb.run(["workspace", "switch", "ws-2"]);
  assert.equal(sb.readSession().selectedWorkspace, "ws-2");
}));

test("workspace switch: unknown name and empty account leave the selection alone", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", ENVS);
  let r = await sb.run(["workspace", "switch", "zzz"]);
  // PLAT-81: a failure exits 1 and is printed on stderr (was stdout, exit 0).
  assert.equal(r.stderr, "Workspace 'zzz' not found.\n");
  assert.equal(r.code, 1);
  assert.equal(sb.readSession().selectedWorkspace, "ws-sel");
  sb.api.on("LIST_WORKSPACES_QUERY", { listAutomationEnvironmentWithStats: [] });
  r = await sb.run(["workspace", "switch", "zzz"]);
  assert.equal(r.stderr, "No workspaces found.\n");
  assert.equal(r.code, 1);
}));

test("workspace switch without argument needs a terminal", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", ENVS);
  const r = await sb.run(["workspace", "switch"]);
  // PINS SUSPECT BEHAVIOUR: with piped stdin the interactive picker dies on setRawMode and
  // reports it as a fetch error. PLAT-81: exit code 1 (was 0).
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error fetching workspaces: process\.stdin\.setRawMode is not a function/);
  assert.equal(sb.readSession().selectedWorkspace, "ws-sel");
}));

test("workspace add: creates, then selects the new workspace", sandboxTest(async (sb) => {
  sb.api.on("CREATE_WORKSPACE_MUTATION", { createAutomationEnvironment: { id: "ws-new" } });
  const r = await sb.run(["workspace", "add", "  My Space ", "-t", "a, b"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "Created workspace [My Space]\nID: ws-new\nSwitched to workspace [My Space]\n");
  assert.deepEqual(ops(sb), [["CREATE_WORKSPACE_MUTATION", { name: "My Space", tags: ["a", "b"] }]]);
  assert.equal(sb.readSession().selectedWorkspace, "ws-new");
}));

test("workspace add: without tags sends null; API error keeps old selection", sandboxTest(async (sb) => {
  sb.api.on("CREATE_WORKSPACE_MUTATION", gqlError("name taken"));
  const r = await sb.run(["workspace", "add", "x"]);
  assert.deepEqual(ops(sb), [["CREATE_WORKSPACE_MUTATION", { name: "x", tags: null }]]);
  // PLAT-81: the error is printed once (was a "GraphQL Error:" copy first).
  assert.equal(r.stderr, "Error creating workspace: name taken\n");
  // PLAT-81: an API error exits 1 (was 0).
  assert.equal(r.code, 1);
  assert.equal(sb.readSession().selectedWorkspace, "ws-sel");
}));

test("workspace add: the name argument is required", sandboxTest(async (sb) => {
  const r = await sb.run(["workspace", "add"]);
  // PLAT-81: a usage error exits 2 (was commander's 1).
  assert.equal(r.code, 2);
  assert.match(r.stderr, /missing required argument 'name'/);
  assert.deepEqual(sb.api.calls, []);
}));

const wsState = (o) => ({ getAutomationEnvironment: { id: "ws-sel", name: "Dev Space", ...o } });

test("workspace delete: starts deletion with the default 30 days", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({}));
  sb.api.on("DELETE_WORKSPACE_MUTATION", { deleteAutomationEnvironment: true });
  const r = await sb.run(["workspace", "delete"]);
  assert.equal(r.code, 0);
  assert.equal(
    r.stdout,
    "Deletion started for workspace [Dev Space]\nWorkspace will be permanently deleted in 30 days.\n",
  );
  assert.deepEqual(ops(sb), [
    ["GET_WORKSPACE_QUERY", { id: "ws-sel" }],
    ["DELETE_WORKSPACE_MUTATION", { id: "ws-sel", delete: true, deletionDays: 30 }],
  ]);
}));

test("workspace delete --days 7 and an explicit workspace id", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", ENVS);
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ id: "ws-2", name: "Other" }));
  sb.api.on("DELETE_WORKSPACE_MUTATION", { deleteAutomationEnvironment: true });
  await sb.run(["workspace", "delete", "ws-2", "-d", "7"]);
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "ws-2", delete: true, deletionDays: 7 });
}));

test("workspace delete --days abc sends a null day count", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({}));
  sb.api.on("DELETE_WORKSPACE_MUTATION", { deleteAutomationEnvironment: true });
  const r = await sb.run(["workspace", "delete", "-d", "abc"]);
  // PINS SUSPECT BEHAVIOUR: parseInt("abc") is NaN; it is sent as null and the CLI says nothing.
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "ws-sel", delete: true, deletionDays: null });
  assert.equal(r.stdout, "Deletion started for workspace [Dev Space]\n");
}));

test("workspace delete: refuses when already being deleted; --cancel undoes it", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ deleting: true }));
  sb.api.on("DELETE_WORKSPACE_MUTATION", { deleteAutomationEnvironment: true });
  let r = await sb.run(["workspace", "delete"]);
  assert.equal(r.stdout, "Workspace is already being deleted.\nUse --cancel to cancel the deletion.\n");
  assert.deepEqual(sb.api.ops(), ["GET_WORKSPACE_QUERY"]);
  r = await sb.run(["workspace", "delete", "--cancel"]);
  assert.equal(r.stdout, "Deletion cancelled for workspace [Dev Space]\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "ws-sel", delete: false });
}));

test("workspace delete --cancel on a workspace that is not being deleted", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ deleting: false }));
  const r = await sb.run(["workspace", "delete", "-c"]);
  assert.equal(r.stdout, "Workspace is not being deleted.\n");
  assert.deepEqual(sb.api.ops(), ["GET_WORKSPACE_QUERY"]);
}));

test("workspace delete: not found, and API error on the mutation", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", { getAutomationEnvironment: null });
  let r = await sb.run(["workspace", "delete"]);
  // PLAT-81: a failure exits 1 and is printed on stderr (was stdout, exit 0).
  assert.equal(r.stderr, "Workspace not found.\n");
  assert.equal(r.code, 1);
  sb.api.on("GET_WORKSPACE_QUERY", wsState({}));
  sb.api.on("DELETE_WORKSPACE_MUTATION", gqlError("denied"));
  r = await sb.run(["workspace", "delete"]);
  assert.match(r.stderr, /Error managing workspace deletion: denied/);
  // PLAT-81: an API error exits 1 (was 0).
  assert.equal(r.code, 1);
}));

test("workspace archive / --unarchive", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ archived: false }));
  sb.api.on("ARCHIVE_WORKSPACE_MUTATION", { archiveAutomationEnvironment: true });
  let r = await sb.run(["workspace", "archive"]);
  assert.equal(r.stdout, "Workspace [Dev Space] archived successfully.\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "ws-sel", archive: true });

  r = await sb.run(["workspace", "archive", "--unarchive"]);
  assert.equal(r.stdout, "Workspace is not archived.\n");

  sb.api.on("GET_WORKSPACE_QUERY", wsState({ archived: true }));
  r = await sb.run(["workspace", "archive"]);
  assert.equal(r.stdout, "Workspace is already archived.\n");
  r = await sb.run(["workspace", "archive", "-u"]);
  assert.equal(r.stdout, "Workspace [Dev Space] unarchived successfully.\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "ws-sel", archive: false });
}));

test("workspace archive: not found and API error", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", { getAutomationEnvironment: null });
  let r = await sb.run(["workspace", "archive"]);
  // PLAT-81: a failure exits 1 and is printed on stderr (was stdout, exit 0).
  assert.equal(r.stderr, "Workspace not found.\n");
  assert.equal(r.code, 1);
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ archived: false }));
  sb.api.on("ARCHIVE_WORKSPACE_MUTATION", gqlError("nope"));
  r = await sb.run(["workspace", "archive"]);
  assert.match(r.stderr, /Error managing workspace archive: nope/);
  assert.equal(r.code, 1); // PLAT-81
}));

test("workspace update: only the given fields change, the rest come from the current state", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ tags: ["old"], health_enabled: true, task_notification_groups: ["g1"] }));
  sb.api.on("SAVE_WORKSPACE_MUTATION", { saveAutomationEnvironment: true });
  let r = await sb.run(["workspace", "update", "-n", "Renamed"]);
  assert.equal(r.stdout, "Workspace [Dev Space] updated successfully.\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    id: "ws-sel", name: "Renamed", tags: ["old"], health_enabled: true, task_notification_groups: ["g1"],
  });
  r = await sb.run(["workspace", "update", "-t", "a, b", "-h", "false", "-g", "x, y"]);
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    id: "ws-sel", name: "Dev Space", tags: ["a", "b"], health_enabled: false, task_notification_groups: ["x", "y"],
  });
}));

test("workspace update: empty strings clear tags (to []) and groups (to null)", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ tags: ["old"], health_enabled: true, task_notification_groups: ["g1"] }));
  sb.api.on("SAVE_WORKSPACE_MUTATION", { saveAutomationEnvironment: true });
  await sb.run(["workspace", "update", "-t", "", "-g", ""]);
  const v = sb.api.calls.at(-1).variables;
  assert.deepEqual(v.tags, []);
  assert.equal(v.task_notification_groups, null);
}));

test("workspace update --health-enabled: anything but 'true' means false", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ tags: [], health_enabled: true }));
  sb.api.on("SAVE_WORKSPACE_MUTATION", { saveAutomationEnvironment: true });
  const r = await sb.run(["workspace", "update", "-h", "yes"]);
  // PINS SUSPECT BEHAVIOUR: "yes"/"1"/typos silently switch health checks off.
  assert.equal(sb.api.calls.at(-1).variables.health_enabled, false);
  assert.equal(r.code, 0);
}));

test("workspace update: not found / API error", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", { getAutomationEnvironment: null });
  let r = await sb.run(["workspace", "update", "-n", "x"]);
  // PLAT-81: a failure exits 1 and is printed on stderr (was stdout, exit 0).
  assert.equal(r.stderr, "Workspace not found.\n");
  assert.equal(r.code, 1);
  sb.api.on("GET_WORKSPACE_QUERY", wsState({ tags: [] }));
  sb.api.on("SAVE_WORKSPACE_MUTATION", gqlError("invalid"));
  r = await sb.run(["workspace", "update", "-n", "x"]);
  assert.match(r.stderr, /Error updating workspace: invalid/);
  assert.equal(r.code, 1); // PLAT-81
}));

const SRC = { url: "https://example.invalid/r.git", username: "u", branch: "main", enabled: true, source_automatic: true };

test("workspace source: options override the stored source, other fields are carried over", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", name: "N", source: SRC } });
  sb.api.on("SAVE_SOURCE_MUTATION", { saveAutomationEnvironmentSource: true });
  const r = await sb.run(["workspace", "source", "--branch", "dev", "--apikey", "k-fake"]);
  assert.equal(r.stdout, "Source configuration updated successfully.\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    id: "ws-sel", url: SRC.url, username: "u", apikey: "k-fake", branch: "dev", enabled: true, source_automatic: true,
  });
}));

test("workspace source: without --apikey the request carries apikey null", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", name: "N", source: SRC } });
  sb.api.on("SAVE_SOURCE_MUTATION", { saveAutomationEnvironmentSource: true });
  await sb.run(["workspace", "source", "--url", "https://example.invalid/other.git"]);
  // PINS SUSPECT BEHAVIOUR: the query only returns has_apikey, so the stored key is
  // re-sent as null on every edit.
  assert.equal(sb.api.calls.at(-1).variables.apikey, null);
  assert.equal(sb.api.calls.at(-1).variables.url, "https://example.invalid/other.git");
}));

test("workspace source --enabled false cannot switch a source off", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", name: "N", source: SRC } });
  sb.api.on("SAVE_SOURCE_MUTATION", { saveAutomationEnvironmentSource: true });
  await sb.run(["workspace", "source", "--enabled", "false", "--source-automatic", "false"]);
  // PINS SUSPECT BEHAVIOUR: `false || stored` falls back to the stored (true) value.
  const v = sb.api.calls.at(-1).variables;
  assert.equal(v.enabled, true);
  assert.equal(v.source_automatic, true);
}));

test("workspace source --enabled true enables a disabled source", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", name: "N", source: { ...SRC, enabled: false, source_automatic: false } } });
  sb.api.on("SAVE_SOURCE_MUTATION", { saveAutomationEnvironmentSource: true });
  await sb.run(["workspace", "source", "--enabled", "true", "--source-automatic", "true"]);
  const v = sb.api.calls.at(-1).variables;
  assert.equal(v.enabled, true);
  assert.equal(v.source_automatic, true);
}));

test("workspace source --file (JSON): the file is sent as is, no lookup", sandboxTest(async (sb) => {
  sb.write("src.json", JSON.stringify({ url: "https://example.invalid/f.git", branch: "b", enabled: false }));
  sb.api.on("SAVE_SOURCE_MUTATION", { saveAutomationEnvironmentSource: true });
  const r = await sb.run(["workspace", "source", "-f", "src.json"]);
  assert.equal(r.stdout, "Source configuration updated successfully.\n");
  assert.deepEqual(sb.api.calls.map((c) => [c.op, c.variables]), [
    ["SAVE_SOURCE_MUTATION", { id: "ws-sel", url: "https://example.invalid/f.git", branch: "b", enabled: false }],
  ]);
}));

test("workspace source --file (YAML) and unreadable files", sandboxTest(async (sb) => {
  sb.write("src.yml", "url: https://example.invalid/y.git\nusername: yy\n");
  sb.api.on("SAVE_SOURCE_MUTATION", { saveAutomationEnvironmentSource: true });
  await sb.run(["workspace", "source", "-f", "src.yml"]);
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "ws-sel", url: "https://example.invalid/y.git", username: "yy" });
  const n = sb.api.calls.length;
  sb.write("bad.json", "{not json");
  let r = await sb.run(["workspace", "source", "-f", "bad.json"]);
  assert.match(r.stderr, /Failed to read or parse config file:/);
  r = await sb.run(["workspace", "source", "-f", "missing.json"]);
  assert.match(r.stderr, /Failed to read or parse config file: ENOENT/);
  assert.equal(sb.api.calls.length, n);
  // PLAT-81: an unreadable file exits 1 (was 0).
  assert.equal(r.code, 1);
}));

test("workspace source: states that block editing", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: null });
  let r = await sb.run(["workspace", "source", "--branch", "x"]);
  // PLAT-81: a failure exits 1 and is printed on stderr (was stdout, exit 0).
  assert.equal(r.stderr, "Workspace not found.\n");
  assert.equal(r.code, 1);
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", deleting: true, source: SRC } });
  r = await sb.run(["workspace", "source", "--branch", "x"]);
  // PINS SUSPECT BEHAVIOUR: the message says "Cannot sync" although this is the edit command.
  // PLAT-81: a failure exits 1 and is printed on stderr (was stdout, exit 0).
  assert.equal(r.stderr, "Workspace is archived, being deleted, or scheduled for deletion. Cannot sync.\n");
  assert.equal(r.code, 1);
  assert.ok(!sb.api.ops().includes("SAVE_SOURCE_MUTATION"));
}));

test("workspace source: a workspace with no source crashes with exit code 1", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", name: "N", source: null } });
  const r = await sb.run(["workspace", "source", "--branch", "x"]);
  // PINS SUSPECT BEHAVIOUR: ws.source.url throws outside the try block -> unhandled rejection.
  assert.equal(r.code, 1);
  assert.match(r.stderr, /TypeError: Cannot read properties of null/);
}));

test("workspace sync: triggers a sync with source_do_sync and a blank apikey", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", name: "Dev Space", source: { ...SRC, source_automatic: false } } });
  sb.api.on("SAVE_SOURCE_MUTATION", { saveAutomationEnvironmentSource: true });
  const r = await sb.run(["workspace", "sync"]);
  assert.equal(r.stdout, "Source sync triggered successfully for workspace: Dev Space (ID: ws-sel)\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    id: "ws-sel", url: SRC.url, username: "u", apikey: "", branch: "main", enabled: true,
    source_automatic: false, source_do_sync: true,
  });
}));

test("workspace sync: nothing is sent when automatic sync is on, no source, or blocked", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", name: "N", source: SRC } });
  let r = await sb.run(["workspace", "sync"]);
  // PLAT-81: no sync was triggered, so each of these exits 1 with the reason on stderr (was stdout, exit 0).
  assert.equal(r.stderr, "Source automatic sync is enabled for this workspace.\n");
  assert.equal(r.code, 1);
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", name: "N", source: null } });
  r = await sb.run(["workspace", "sync"]);
  assert.equal(r.stderr, "No source configuration found for this workspace.\n");
  assert.equal(r.code, 1);
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", archived: true } });
  r = await sb.run(["workspace", "sync"]);
  assert.match(r.stderr, /Cannot sync\./);
  assert.equal(r.code, 1);
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: null });
  r = await sb.run(["workspace", "sync"]);
  assert.equal(r.stderr, "Workspace not found.\n");
  assert.equal(r.code, 1);
  assert.ok(!sb.api.ops().includes("SAVE_SOURCE_MUTATION"));
}));

test("workspace sync: API error is reported, exit code 1", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", gqlError("down"));
  const r = await sb.run(["workspace", "sync"]);
  assert.match(r.stderr, /Error triggering source sync: down/);
  // PLAT-81: exit code 1 (was 0).
  assert.equal(r.code, 1);
}));
