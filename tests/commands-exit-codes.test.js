// PLAT-81: one exit-code rule for every `aloma` command (src/runtime.js, wired in src/cli.js).
// 0 = success, 1 = the operation failed, 2 = usage error (bad arguments or options).
// Errors are printed once, to stderr, without a stack trace unless DEBUG is set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, gqlError } from "./helpers/cli-harness.js";

const ME = { me: { realm: { id: "r-1", name: "Alpha Co" }, realms: [{ id: "r-1", name: "Alpha Co" }] } };
const STACK = /\n\s+at /;

// ---------------------------------------------------------------- runtime

test("PLAT-81 runtime: a missing argument is a usage error (exit 2)", sandboxTest(async (sb) => {
  const r = await sb.run(["step", "show"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /missing required argument 'id'/);
  assert.deepEqual(sb.api.calls, []);
}));

test("PLAT-81 runtime: an unknown option or command is a usage error (exit 2)", sandboxTest(async (sb) => {
  const opt = await sb.run(["webhook", "list", "--nope"]);
  assert.equal(opt.code, 2);
  assert.match(opt.stderr, /unknown option '--nope'/);
  const cmd = await sb.run(["workspace", "frobnicate"]);
  assert.equal(cmd.code, 2);
  assert.deepEqual(sb.api.calls, []);
}));

test("PLAT-81 runtime: --version and --help still exit 0", sandboxTest(async (sb) => {
  assert.equal((await sb.run(["--version"])).code, 0);
  assert.equal((await sb.run(["--help"])).code, 0);
  assert.equal((await sb.run(["step", "--help"])).code, 0);
}));

test("PLAT-81 runtime: an uncaught API error is printed once, without a stack, exit 1", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", gqlError("session expired"));
  const r = await sb.run(["company", "list"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "GraphQL Error: session expired\n");
  assert.equal(r.stdout, "");
}));

test("PLAT-81 runtime: with DEBUG set the stack trace is added", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", gqlError("session expired"));
  const r = await sb.run(["company", "list"], { env: { DEBUG: "1" } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^GraphQL Error: session expired\n/);
  assert.match(r.stderr, STACK);
}));

test("PLAT-81 runtime: a caught API error is printed once (no extra \"GraphQL Error\" line)", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", gqlError("boom"));
  const r = await sb.run(["workspace", "list"]);
  assert.equal(r.stderr, "Error fetching environments: boom\n");
}));

test("PLAT-81 runtime: success still exits 0", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME);
  const r = await sb.run(["company", "list"]);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
}));

// ---------------------------------------------------------------- workspace

const WS = { listAutomationEnvironmentWithStats: [{ id: "ws-1", name: "Dev" }] };

test("PLAT-81 workspace: list API error exits 1, printed once on stderr", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", gqlError("denied"));
  const r = await sb.run(["workspace", "list"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error fetching environments: denied\n");
}));

test("PLAT-81 workspace: switch to an unknown workspace exits 1", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", WS);
  const r = await sb.run(["workspace", "switch", "nope"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'No workspace with the id or name "nope" among your workspaces.\n'); // PLAT-116 wording
  assert.equal(sb.readSession().selectedWorkspace, "ws-sel");
}));

test("PLAT-81 workspace: no workspace selected exits 1", sandboxTest({ session: { token: "t" } }, async (sb) => {
  const r = await sb.run(["workspace", "show"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "No workspace selected. Use `aloma workspace switch` to select one.\n");
  assert.deepEqual(sb.api.calls, []);
}));

test("PLAT-81 workspace: show, archive, update of a workspace that is not found exit 1", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", { getAutomationEnvironment: null });
  for (const args of [["show"], ["archive"], ["update", "-n", "x"], ["delete"]]) {
    const r = await sb.run(["workspace", ...args]);
    assert.equal(r.code, 1, args.join(" "));
    assert.equal(r.stderr, "Workspace not found.\n", args.join(" "));
  }
}));

test("PLAT-81 workspace: add and sync API errors exit 1", sandboxTest(async (sb) => {
  sb.api.on("CREATE_WORKSPACE_MUTATION", gqlError("name taken"));
  let r = await sb.run(["workspace", "add", "x"]);
  assert.equal(r.code, 1);
  sb.api.on("GET_SOURCE_QUERY", gqlError("down"));
  r = await sb.run(["workspace", "sync"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error triggering source sync: down\n");
}));

test("PLAT-81 workspace: success exits 0", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS);
  const r = await sb.run(["workspace", "list"]);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
}));
