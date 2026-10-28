// Characterisation tests for `aloma company ...` and `aloma user ...`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, gqlError, FAKE_TOKEN } from "./helpers/cli-harness.js";

const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);
const me = (groups, extra = {}) => ({
  me: {
    id: "u-1", email: "me@example.invalid", groups,
    realm: { id: "r-1", name: "Alpha Co" },
    realms: [{ id: "r-1", name: "Alpha Co" }, { id: "r-2", name: "Beta Co" }],
    ...extra,
  },
});

// ---------------------------------------------------------------- company

test("company list: numbers the companies and marks the current one", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["developer"]));
  const r = await sb.run(["company", "list"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "\nAvailable companies:\n1. Alpha Co [*]\n2. Beta Co \n");
  assert.deepEqual(ops(sb), [["ME_QUERY", {}]]);
}));

test("company list: no companies", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", { me: { realms: [] } });
  const r = await sb.run(["company", "list"]);
  assert.equal(r.stdout, "No companies found\n");
}));

test("company list: API failure exits 1", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", gqlError("session expired"));
  const r = await sb.run(["company", "list"]);
  // PLAT-81: listCompanies has no try/catch; the action wrapper prints the error once (no stack
  // trace, was an unhandled rejection) and exits 1.
  assert.equal(r.code, 1);
  assert.match(r.stderr, /GraphQL Error: session expired/);
  assert.match(r.stderr, /Error: session expired/);
}));

test("company add: non-admin is refused (exit 1)", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["developer"]));
  const r = await sb.run(["company", "add", "New Co"]);
  assert.equal(r.stderr, "Error: Only administrators can add companies\n");
  assert.equal(r.stdout, "");
  assert.equal(r.code, 1);
}));

test("company add: for a company-manager it only prints success and creates nothing", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["company-manager"]));
  const r = await sb.run(["company", "add", "New Co", "-e", "a@example.invalid"]);
  // PINS SUSPECT BEHAVIOUR: the create call is commented out in the source; the CLI claims
  // success without sending any mutation.
  assert.equal(r.stdout, 'Company "New Co" created successfully!\n');
  assert.deepEqual(sb.api.ops(), ["ME_QUERY"]);
}));

const COOKIE = (v) => JSON.stringify({ "set-cookie": [`Other=1; Path=/`, `Authorization=${v}; Path=/; HttpOnly`] });
const WORKSPACES = { listAutomationEnvironmentWithStats: [{ id: "ws-first", name: "First" }] };

test("company switch <name>: posts to the realm endpoint, stores the new token and resets the workspace", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["developer"]));
  sb.api.on("LIST_WORKSPACES_QUERY", WORKSPACES);
  const r = await sb.run(["company", "switch", "Beta Co"], {
    env: { TEST_REALM_HEADERS: COOKIE("Bearer%20new-token-fake") },
  });
  assert.equal(r.code, 0);
  const calls = sb.realmCalls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://graphql.test.invalid/realm?realm=r-2");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, {});
  // PLAT-117: sent through src/http.js: never follows a redirect; the session as bearer header and cookie.
  assert.equal(calls[0].redirect, "manual");
  assert.equal(calls[0].headers.authorization, `Bearer ${FAKE_TOKEN}`);
  assert.equal(calls[0].headers.cookie, `Authorization=Bearer%20${FAKE_TOKEN}`);
  const s = sb.readSession();
  assert.equal(s.token, "new-token-fake");
  assert.equal(s.selectedWorkspace, "ws-first");
  assert.match(r.stdout, /Switched to workspace \[First\]\n/);
  assert.match(r.stdout, /Successfully switched to company \[Beta Co\]\n$/);
  // PLAT-116: the default workspace is saved from the one list (was listed twice).
  assert.deepEqual(sb.api.ops(), ["ME_QUERY", "LIST_WORKSPACES_QUERY"]);
}));

test("company switch <id>: matches by id; a name in any case", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["developer"]));
  let r = await sb.run(["company", "switch", "r-2"]);
  assert.equal(sb.realmCalls()[0].url, "https://graphql.test.invalid/realm?realm=r-2");
  // Flipped (Patrick, 28 Oct): names match regardless of case when one company matches (was refused with a hint).
  r = await sb.run(["company", "switch", "beta co"]);
  assert.equal(sb.realmCalls().length, 2);
  assert.equal(sb.realmCalls()[1].url, "https://graphql.test.invalid/realm?realm=r-2");
}));

test("company switch: reply without an Authorization cookie keeps the session untouched", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["developer"]));
  const r = await sb.run(["company", "switch", "Beta Co"]);
  // PINS SUSPECT BEHAVIOUR: success is printed even though no new token arrived.
  assert.equal(r.stdout, "Successfully switched to company [Beta Co]\n");
  assert.equal(sb.readSession().token, FAKE_TOKEN);
  assert.equal(sb.readSession().selectedWorkspace, "ws-sel");
}));

test("company switch: a token containing '=' is cut off at the first '='", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["developer"]));
  sb.api.on("LIST_WORKSPACES_QUERY", WORKSPACES);
  await sb.run(["company", "switch", "Beta Co"], { env: { TEST_REALM_HEADERS: COOKIE("Bearer%20abc=def==") } });
  // PINS SUSPECT BEHAVIOUR: cookie.split("=")[1] drops everything after the next '=',
  // here leaving "abc".
  assert.equal(sb.readSession().token, "abc");
}));

test("company switch: errors from the realm endpoint are printed to stderr, exit 1", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["developer"]));
  const r = await sb.run(["company", "switch", "Beta Co"], { env: { TEST_REALM_STATUS: "403" } });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error switching company: Request failed with status code 403\n");
  assert.equal(r.stdout, "");
  assert.equal(sb.readSession().token, FAKE_TOKEN);
}));

test("company switch: a network error from the realm endpoint is printed with its reason, exit 1", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["developer"]));
  const r = await sb.run(["company", "switch", "Beta Co"], { env: { TEST_REALM_FAIL: "connect ECONNREFUSED" } });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error switching company: request to https://graphql.test.invalid/realm?realm=r-2 failed, reason: connect ECONNREFUSED\n");
  assert.equal(sb.readSession().token, FAKE_TOKEN);
}));

test("company switch: empty account", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", { me: { realms: [] } });
  const r = await sb.run(["company", "switch", "x"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "No companies found.\n");
  assert.deepEqual(sb.realmCalls(), []);
}));

test("company switch without argument needs a terminal", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["developer"]));
  const r = await sb.run(["company", "switch"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error fetching companies: process\.stdin\.setRawMode is not a function/);
  assert.deepEqual(sb.realmCalls(), []);
}));

// ------------------------------------------------------------------- user

test("user list: members then pending invitations", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["admin"]));
  sb.api.on("FIND_COMPANY_MEMBERS_QUERY", {
    findCompanyMembers: [
      { id: "u-1", firstName: "Ada", lastName: "Fake", email: "ada@example.invalid", groups: ["admin", "viewer"] },
      { id: "u-2", firstName: null, lastName: null, email: "nn@example.invalid", groups: null },
    ],
    getCompanyInvitations: [{ id: "i-1", email: "new@example.invalid", createdAt: "2024-03-05T10:00:00Z" }],
  });
  const r = await sb.run(["user", "list"]);
  assert.equal(r.code, 0);
  assert.deepEqual(sb.api.ops(), ["ME_QUERY", "FIND_COMPANY_MEMBERS_QUERY"]);
  const lines = r.stdout.split("\n");
  assert.equal(lines[1], "Users in current company:");
  assert.equal(lines[2], "- Ada Fake <ada@example.invalid> (u-1) [admin, viewer]");
  assert.equal(lines[3], "-   <nn@example.invalid> (u-2) []");
  assert.equal(lines[5], "Pending Invitations:");
  assert.match(lines[6], /^- new@example\.invalid \(invited at .*2024.*\)$/);
}));

test("user list: empty company, and permission check (owner allowed, developer refused)", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["owner"]));
  sb.api.on("FIND_COMPANY_MEMBERS_QUERY", { findCompanyMembers: [], getCompanyInvitations: [] });
  let r = await sb.run(["user", "list"]);
  assert.equal(r.stdout, "No users found in the current company.\n");
  sb.api.on("ME_QUERY", me(["developer"]));
  r = await sb.run(["user", "list"]);
  assert.equal(r.stderr, "Error: Only administrators or owners can list users\n");
  assert.equal(r.code, 1);
  assert.equal(sb.api.ops().filter((o) => o === "FIND_COMPANY_MEMBERS_QUERY").length, 1);
}));

test("user list: API error", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", gqlError("nope"));
  const r = await sb.run(["user", "list"]);
  assert.equal(r.stderr, "Error listing users: nope\n");
  assert.equal(r.code, 1);
}));

test("user invite: default role developer expands to the base groups", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["admin"]));
  sb.api.on("INVITE_TO_COMPANY_MUTATION", { inviteToCompany: true });
  const r = await sb.run(["user", "invite", "a@example.invalid, b@example.invalid"]);
  assert.equal(r.stdout, "Invited users: a@example.invalid, b@example.invalid with roles: developer\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    emails: ["a@example.invalid", "b@example.invalid"],
    groups: ["viewer", "developer", "integrator", "audit"],
  });
}));

test("user invite --roles admin,business adds their groups without duplicates", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["owner"]));
  sb.api.on("INVITE_TO_COMPANY_MUTATION", { inviteToCompany: true });
  const r = await sb.run(["user", "invite", "a@example.invalid", "-r", "admin,business,developer"]);
  assert.equal(r.stdout, "Invited users: a@example.invalid with roles: admin, business, developer\n");
  assert.deepEqual(sb.api.calls.at(-1).variables.groups, ["viewer", "developer", "integrator", "audit", "admin", "business"]);
}));

test("user invite: invalid role, role 'owner' not invitable, no valid emails", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["admin"]));
  // PLAT-81: bad option values are usage errors (exit 2), printed on stderr.
  let r = await sb.run(["user", "invite", "a@example.invalid", "-r", "owner,wizard"]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr, "Invalid roles: owner, wizard. Allowed roles are: developer, admin, business\n");
  r = await sb.run(["user", "invite", " , ,"]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr, "No valid emails provided.\n");
  assert.ok(!sb.api.ops().includes("INVITE_TO_COMPANY_MUTATION"));
}));

test("user invite: emails are not validated client side", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["admin"]));
  sb.api.on("INVITE_TO_COMPANY_MUTATION", { inviteToCompany: true });
  await sb.run(["user", "invite", "not-an-email"]);
  assert.deepEqual(sb.api.calls.at(-1).variables.emails, ["not-an-email"]);
}));

test("user invite: non-admin refused; API error reported", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["developer"]));
  let r = await sb.run(["user", "invite", "a@example.invalid"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error: Only administrators or owners can invite users\n");
  sb.api.on("ME_QUERY", me(["admin"]));
  sb.api.on("INVITE_TO_COMPANY_MUTATION", gqlError("limit reached"));
  r = await sb.run(["user", "invite", "a@example.invalid"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error inviting users: limit reached\n");
}));

test("user update: roles become groups", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["admin"]));
  sb.api.on("UPDATE_COMPANY_MEMBER_MUTATION", { updateCompanyMember: true });
  const r = await sb.run(["user", "update", "u-9", "-r", "admin"]);
  assert.equal(r.stdout, "Updated user u-9\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "u-9", groups: ["viewer", "developer", "integrator", "audit", "admin"] });
}));

test("user update: roles are required and validated", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["admin"]));
  let r = await sb.run(["user", "update", "u-9"]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr, "Error: Roles parameter is required\n");
  r = await sb.run(["user", "update", "u-9", "-r", "root"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^Invalid roles: root\./);
  assert.ok(!sb.api.ops().includes("UPDATE_COMPANY_MEMBER_MUTATION"));
}));

test("user update: non-admin refused", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["viewer"]));
  const r = await sb.run(["user", "update", "u-9", "-r", "admin"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error: Only administrators or owners can update users\n");
}));

test("user remove: sends removed=true", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["owner"]));
  sb.api.on("UPDATE_COMPANY_MEMBER_MUTATION", { updateCompanyMember: true });
  const r = await sb.run(["user", "remove", "u-9"]);
  assert.equal(r.stdout, "Removed user u-9\n");
  assert.deepEqual(sb.api.calls.at(-1).variables, { id: "u-9", removed: true });
}));

test("user remove: error text says 'updating' and non-admin is refused", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", me(["admin"]));
  sb.api.on("UPDATE_COMPANY_MEMBER_MUTATION", gqlError("last owner"));
  let r = await sb.run(["user", "remove", "u-9"]);
  // PINS SUSPECT BEHAVIOUR: the remove command reports failures as "Error updating user".
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error updating user: last owner\n");
  sb.api.on("ME_QUERY", me([]));
  r = await sb.run(["user", "remove", "u-9"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error: Only administrators or owners can remove users\n");
}));
