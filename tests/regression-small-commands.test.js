// Regression tests for the small command files: company, webhook, user, secret and library
// (error wrappers, empty-state lines and "fall back to the current value" defaults).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, gqlError } from "./helpers/cli-harness.js";

const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);
const ME = (groups, extra = {}) => ({
  me: { id: "u-1", email: "me@example.invalid", groups, ...extra },
});

// ---------------------------------------------------------------- company

test("company add: a failing user lookup ends as a plain error, not the create wrapper, exit 1", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", gqlError("session expired"));
  const r = await sb.run(["company", "add", "New Co"]);
  // The create step sends no request (the call is commented out in the source), so the wrapper text
  // "Error creating company:" cannot appear today; only the lookup before it can fail.
  assert.equal(r.code, 1);
  assert.match(r.stderr, /session expired/);
  assert.doesNotMatch(r.out, /Error creating company:/);
  assert.equal(r.stdout, "");
  assert.deepEqual(sb.api.ops(), ["ME_QUERY"]);
}));

test("company list: no companies at all (realms missing) prints the empty line", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME(["developer"]));
  const r = await sb.run(["company", "list"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "No companies found\n");
}));

test("company list: only the current company is marked", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME(["developer"], {
    realm: { id: "r-2", name: "Beta Co" },
    realms: [{ id: "r-1", name: "Alpha Co" }, { id: "r-2", name: "Beta Co" }, { id: "r-3", name: "Gamma Co" }],
  }));
  const r = await sb.run(["company", "list"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "\nAvailable companies:\n1. Alpha Co \n2. Beta Co [*]\n3. Gamma Co \n");
  assert.equal(r.stdout.split("[*]").length - 1, 1);
}));

test("company list: no current company marks none", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME(["developer"], { realms: [{ id: "r-1", name: "Alpha Co" }] }));
  const r = await sb.run(["company", "list"]);
  assert.equal(r.stdout, "\nAvailable companies:\n1. Alpha Co \n");
}));

// ---------------------------------------------------------------- webhook

test("webhook add: an empty name is a usage error (exit 2) and sends no request", sandboxTest(async (sb) => {
  const r = await sb.run(["webhook", "add", ""]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Please provide name for the webhook/);
  assert.equal(r.stdout, "");
  assert.deepEqual(sb.api.calls, []);
}));

// ------------------------------------------------------------------- user

test("user list: an empty member list prints the empty line; no invitation field adds nothing", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME(["admin"]));
  sb.api.on("FIND_COMPANY_MEMBERS_QUERY", { findCompanyMembers: [] });
  const r = await sb.run(["user", "list"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "No users found in the current company.\n");
}));

test("user list: members and invitations both missing from the answer print the empty line only", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME(["owner"]));
  sb.api.on("FIND_COMPANY_MEMBERS_QUERY", {});
  const r = await sb.run(["user", "list"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "No users found in the current company.\n");
}));

test("user list: pending invitations are listed when present, even with no members", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME(["admin"]));
  sb.api.on("FIND_COMPANY_MEMBERS_QUERY", {
    findCompanyMembers: [],
    getCompanyInvitations: [{ email: "new@example.invalid", createdAt: "2024-01-02T03:04:05Z" }],
  });
  const r = await sb.run(["user", "list"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^No users found in the current company\.\n\nPending Invitations:\n- new@example\.invalid \(invited at /);
}));

test("user list: members without an invitation list print no invitation heading", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME(["admin"]));
  sb.api.on("FIND_COMPANY_MEMBERS_QUERY", {
    findCompanyMembers: [{ id: "u-2", email: "dev@example.invalid", groups: ["developer"] }],
  });
  const r = await sb.run(["user", "list"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "\nUsers in current company:\n-   <dev@example.invalid> (u-2) [developer]\n");
  assert.doesNotMatch(r.stdout, /Pending Invitations/);
}));

// ----------------------------------------------------------------- secret

test("secret add without --description and --options sends description \"\" and options {}", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", { getAutomationEnvironmentConfig: null });
  sb.api.on("SAVE_SECRET_MUTATION", { saveAutomationEnvironmentConfig: true });
  const r = await sb.run(["secret", "add", "PLAIN", "not-a-token"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '✅ Secret "PLAIN" added successfully\n');
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    environmentId: "ws-sel",
    values: { PLAIN: { encrypted: false, value: "not-a-token", description: "", options: {}, hasValue: true } },
  });
}));

test("secret delete: a name that is not in the config is reported, exit 1, nothing saved", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", { getAutomationEnvironmentConfig: { OTHER: { value: "x" } } });
  sb.api.on("SAVE_SECRET_MUTATION", { saveAutomationEnvironmentConfig: true });
  const r = await sb.run(["secret", "delete", "MISSING"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Secret "MISSING" not found\. Use `aloma secret list` to see available secrets\./);
  assert.equal(r.stdout, "");
  assert.deepEqual(sb.api.ops(), ["GET_SECRET_QUERY"]);
}));

test("secret delete: a workspace with no config at all reports the name as not found, nothing saved", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", { getAutomationEnvironmentConfig: null });
  const r = await sb.run(["secret", "delete", "MISSING"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Secret "MISSING" not found/);
  assert.deepEqual(sb.api.ops(), ["GET_SECRET_QUERY"]);
}));

// ---------------------------------------------------------------- library

const LISTED = { listAutomationLibs: [{ id: "l-1", name: "util" }] };
const CURRENT = (extra = {}) => ({
  getAutomationLib: {
    id: "l-1", name: "util", namespace: "util", enabled: false, tags: ["keep"], version: 2,
    types: "T", content: { content: "const a = 1;" }, ...extra,
  },
});
const libraryUpdate = async (sb, current, args) => {
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", LISTED);
  sb.api.on("GET_AUTOMATION_LIB_QUERY", current);
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  const r = await sb.run(["library", "update", "l-1", ...args]);
  assert.equal(r.code, 0);
  return ops(sb).find(([op]) => op === "UPDATE_AUTOMATION_LIB_MUTATION")[1];
};

test("library update without --enabled keeps the current enabled value (false stays false)", sandboxTest(async (sb) => {
  const vars = await libraryUpdate(sb, CURRENT({ enabled: false }), ["-n", "newns"]);
  assert.equal(vars.enabled, false);
  assert.equal(vars.namespace, "newns");
}));

test("library update without --enabled keeps the current enabled value (true stays true)", sandboxTest(async (sb) => {
  const vars = await libraryUpdate(sb, CURRENT({ enabled: true }), ["-t", "x"]);
  assert.equal(vars.enabled, true);
}));

test("library update without --tags and --namespace keeps the current ones", sandboxTest(async (sb) => {
  const vars = await libraryUpdate(sb, CURRENT(), ["-e", "true"]);
  assert.deepEqual(vars, {
    id: "l-1", name: "util", namespace: "util", content: "const a = 1;", types: "T", version: 2, tags: ["keep"], enabled: true,
  });
}));

test("library update: a library with no tags stored is sent an empty tag list", sandboxTest(async (sb) => {
  const vars = await libraryUpdate(sb, CURRENT({ tags: null }), []);
  assert.deepEqual(vars.tags, []);
  assert.equal(vars.namespace, "util");
}));
