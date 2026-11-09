// Workspace selection (src/context.js and src/commands/workspace/index.js): what the CLI does when the
// selected workspace cannot be saved or read, when an account has no workspaces, when the interactive
// pick is cancelled, and the stats and source-settings error paths. The CLI runs as a child process
// against the local fake API (see helpers/cli-harness.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sandboxTest, gqlError, REPO } from "./helpers/cli-harness.js";

const WS = (...pairs) => ({ listAutomationEnvironmentWithStats: pairs.map(([id, name]) => ({ id, name })) });
const ME = {
  me: {
    id: "u-1", groups: ["developer"],
    realm: { id: "r-1", name: "Alpha Co" },
    realms: [{ id: "r-1", name: "Alpha Co" }, { id: "r-2", name: "Beta Co" }],
  },
};
const COOKIE = (v) => JSON.stringify({ "set-cookie": [`Authorization=${v}; Path=/; HttpOnly`] });
const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);

// The session file becomes a directory while the first request is being answered: the token was
// read already, the next read or write of the file fails.
const breakSessionFileDuring = (sb, reply) => (variables) => {
  fs.rmSync(sb.sessionFile);
  fs.mkdirSync(sb.sessionFile);
  return typeof reply === "function" ? reply(variables) : reply;
};

// Raw mode is faked in the child so the picker can run on piped input.
const TTY_ENV = {
  NODE_OPTIONS: [
    `--import ${pathToFileURL(path.join(REPO, "tests", "helpers", "preload-fetch.mjs")).href}`,
    `--import ${pathToFileURL(path.join(REPO, "tests", "helpers", "fake-raw-mode.mjs")).href}`,
  ].join(" "),
};
const PICKER = /Select a workspace to switch to:[\s\S]*Other/;
const KEYS = { down: "\u001b[B", enter: "\r", escape: "\u001b" };

// ---------------------------------------------------------------- saving and reading the selection

test("workspace switch: a selection that cannot be saved exits 1 with the save error", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", breakSessionFileDuring(sb, WS(["ws-sel", "Dev Space"], ["ws-2", "Other"])));
  const r = await sb.run(["workspace", "switch", "Other"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^Failed to update session data: .*EISDIR/m);
  assert.match(r.stderr, /^Failed to save workspace selection: .*EISDIR/m);
  assert.doesNotMatch(r.stdout, /Switched to workspace/);
  assert.doesNotMatch(r.stderr, /Error switching workspace/);
}));

test("workspace add: a created workspace whose selection cannot be saved exits 1 with the save error", sandboxTest(async (sb) => {
  sb.api.on("CREATE_WORKSPACE_MUTATION", breakSessionFileDuring(sb, { createAutomationEnvironment: { id: "ws-new" } }));
  const r = await sb.run(["workspace", "add", "Fresh"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^Failed to save workspace selection: .*EISDIR/m);
  assert.equal(r.stdout, "Created workspace [Fresh]\nID: ws-new\n");
}));

test("workspace show: a selection that cannot be read exits 1 with the read error and sends no request", sandboxTest({ session: null }, async (sb) => {
  fs.mkdirSync(sb.sessionFile);
  const r = await sb.run(["workspace", "show"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^Failed to read session data: .*EISDIR/m);
  assert.match(r.stderr, /^Failed to read workspace selection: .*EISDIR/m);
  assert.equal(r.stdout, "");
  assert.deepEqual(sb.api.calls, []);
}));

test("workspace list: a selection that cannot be read after the list arrives exits 1 with the read error", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", breakSessionFileDuring(sb, WS(["ws-sel", "Dev Space"])));
  const r = await sb.run(["workspace", "list"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^Failed to read workspace selection: .*EISDIR/m);
  assert.equal(r.stdout, "");
}));

// ---------------------------------------------------------------- an account with no workspaces

test("company switch: an account with no workspaces gets the getting-started workspace created and selected", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME);
  sb.api.sequence("LIST_WORKSPACES_QUERY", WS(), WS(["ws-gs", "Getting Started"]));
  sb.api.on("CREATE_GETTING_STARTED_MUTATION", { createGettingStarted: true });
  const r = await sb.run(["company", "switch", "Beta Co"], { env: { TEST_REALM_HEADERS: COOKIE("Bearer%20new-token-fake") } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(sb.api.ops(), ["ME_QUERY", "LIST_WORKSPACES_QUERY", "CREATE_GETTING_STARTED_MUTATION", "LIST_WORKSPACES_QUERY"]);
  assert.match(r.stdout, /Switched to workspace \[Getting Started\]\n/);
  assert.equal(sb.readSession().selectedWorkspace, "ws-gs");
}));

test("company switch: when the getting-started workspace is not created no workspace is selected and none is announced", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME);
  sb.api.on("LIST_WORKSPACES_QUERY", WS());
  sb.api.on("CREATE_GETTING_STARTED_MUTATION", { createGettingStarted: false });
  const r = await sb.run(["company", "switch", "Beta Co"], { env: { TEST_REALM_HEADERS: COOKIE("Bearer%20new-token-fake") } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(sb.api.ops(), ["ME_QUERY", "LIST_WORKSPACES_QUERY", "CREATE_GETTING_STARTED_MUTATION"]);
  assert.doesNotMatch(r.stdout, /Switched to workspace/);
  assert.equal(sb.readSession().selectedWorkspace, null);
}));

// ---------------------------------------------------------------- the interactive pick

test("workspace switch without an argument: an empty list prints the empty-list message and changes nothing", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", WS());
  const r = await sb.run(["workspace", "switch"], { env: TTY_ENV });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "No workspaces found.\n");
  assert.equal(r.stderr, "");
  assert.equal(sb.readSession().selectedWorkspace, "ws-sel");
}));

test("workspace switch without an argument: Escape cancels, exits 1 and leaves the selection alone", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", WS(["ws-sel", "Dev Space"], ["ws-2", "Other"]));
  const r = await sb.run(["workspace", "switch"], { env: TTY_ENV, answers: [{ when: PICKER, send: KEYS.down }, { when: /❯ Other/, send: KEYS.escape }] });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "\nSelection cancelled.\n");
  assert.doesNotMatch(r.stdout, /Switched to workspace/);
  assert.equal(sb.readSession().selectedWorkspace, "ws-sel");
}));

test("workspace switch without an argument: Enter on the arrowed-to workspace saves it", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", WS(["ws-sel", "Dev Space"], ["ws-2", "Other"]));
  const r = await sb.run(["workspace", "switch"], { env: TTY_ENV, answers: [{ when: PICKER, send: KEYS.down }, { when: /❯ Other/, send: KEYS.enter }] });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Selected: Other\n/);
  assert.match(r.stdout, /Switched to workspace \[Other\]\n$/);
  assert.equal(sb.readSession().selectedWorkspace, "ws-2");
}));

// ---------------------------------------------------------------- stats and source settings

test("workspace show --stats: a workspace with no stats exits 1 with a not-found message", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_STATS_QUERY", { getAutomationEnvironmentWithStats: null });
  const r = await sb.run(["workspace", "show", "--stats"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Workspace not found or no stats available.\n");
  assert.equal(r.stdout, "");
  assert.deepEqual(ops(sb), [["GET_WORKSPACE_STATS_QUERY", { id: "ws-sel" }]]);
}));

test("workspace show --stats: health lines for unused steps, webhooks and connectors", sandboxTest(async (sb) => {
  const stats = (unused) => ({ getAutomationEnvironmentWithStats: { id: "ws-sel", name: "N", health: { enabled: true, unused } } });
  sb.api.on("GET_WORKSPACE_STATS_QUERY", stats({ steps: 3, webhooks: 2, connectors: 1 }));
  let r = await sb.run(["workspace", "show", "--stats"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /HEALTH ISSUES:\n {2}3 unused steps\n {2}2 unused webhooks\n {2}1 unused connectors\n\n/);
  assert.doesNotMatch(r.stdout, /No health issues detected/);
  for (const [unused, line] of [
    [{ steps: 0, webhooks: 1, connectors: 0 }, "  1 unused webhooks\n"],
    [{ steps: 1, webhooks: 0, connectors: 0 }, "  1 unused steps\n"],
    [{ steps: 0, webhooks: 0, connectors: 1 }, "  1 unused connectors\n"],
  ]) {
    sb.api.on("GET_WORKSPACE_STATS_QUERY", stats(unused));
    r = await sb.run(["workspace", "show", "--stats"]);
    assert.match(r.stdout, new RegExp(`HEALTH ISSUES:\\n${line}\\n`), line);
    assert.equal(r.stdout.match(/ unused /g).length, 1, line);
  }
  sb.api.on("GET_WORKSPACE_STATS_QUERY", stats({ steps: 0, webhooks: 0, connectors: 0 }));
  r = await sb.run(["workspace", "show", "--stats"]);
  assert.match(r.stdout, /No health issues detected\./);
  assert.doesNotMatch(r.stdout, /unused/);
}));

test("workspace source: a failed save of the settings exits 1 and says so", sandboxTest(async (sb) => {
  sb.api.on("GET_SOURCE_QUERY", { getAutomationEnvironment: { id: "ws-sel", name: "N", source: { url: "https://example.invalid/r.git" } } });
  sb.api.on("SAVE_SOURCE_MUTATION", gqlError("rejected"));
  let r = await sb.run(["workspace", "source", "--branch", "dev"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error updating source configuration: rejected\n");
  assert.doesNotMatch(r.stdout, /updated successfully/);
  sb.write("src.json", JSON.stringify({ url: "https://example.invalid/f.git" }));
  r = await sb.run(["workspace", "source", "--file", "src.json"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error updating source configuration: rejected\n");
}));
