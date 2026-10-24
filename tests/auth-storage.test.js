// Characterisation + security tests for where and how the CLI keeps its session
// (src/utils.js getStoragePath / updateSessionData / getSessionData) and how a stored session is
// used and expires (graphQuery). Each case runs in a sandboxed process; all hosts are loopback mocks.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { makeSandbox, runDriver, FAKE, leakedSecrets } from "./helpers/sandbox.js";
import { startMockApi } from "./helpers/mock-idp.js";

let sb, api;

beforeEach(async () => {
  api = await startMockApi();
  sb = makeSandbox({ config: { graphqlUrl: api.graphqlUrl, keycloakRealmUrl: "http://127.0.0.1:1/realms/none" } });
});
afterEach(async () => {
  await api.close();
  sb.cleanup();
});

const store = (value) => runDriver(sb, { fn: "updateSessionData", prop: "token", value });

test("the session lives in <package root>/.cache/session.json, not under HOME", async () => {
  const r = await runDriver(sb, { fn: "getStoragePath" });
  assert.equal(r.result.value, sb.cacheDir);
  await store(FAKE.session);
  assert.ok(existsSync(sb.sessionPath));
  assert.deepEqual(readdirSync(sb.home), [], "nothing written under HOME");
});

// PINS SUSPECT BEHAVIOUR: the package root is looked up from the current directory first, so the
// session in use depends on where the command is run: a project with its own local install of the
// CLI has a separate session from the global one.
test("PINS SUSPECT BEHAVIOUR: a local install in the current directory wins over the global one", async () => {
  const globalRoot = path.join(sb.root, "global-node-modules");
  mkdirSync(path.join(globalRoot, "@aloma.io", "aloma"), { recursive: true });
  writeFileSync(path.join(sb.binDir, "npm"), `#!/bin/sh\necho ${globalRoot}\n`);
  const local = await runDriver(sb, { fn: "getStoragePath" });
  assert.equal(local.result.value, sb.cacheDir);
  rmSync(path.join(sb.project, "node_modules"), { recursive: true });
  const global = await runDriver(sb, { fn: "getStoragePath" });
  assert.equal(global.result.value, path.join(globalRoot, "@aloma.io", "aloma", ".cache"));
});

test("no local and no global install: storage cannot be found", async () => {
  rmSync(path.join(sb.project, "node_modules"), { recursive: true });
  const r = await runDriver(sb, { fn: "getStoragePath" });
  assert.equal(r.result.ok, false);
  assert.match(r.result.error, /Could not find aloma package in local or global node_modules/);
});

// PINS SUSPECT BEHAVIOUR: the code comment says the token is stored encrypted; it is stored as
// plain text JSON.
test("PINS SUSPECT BEHAVIOUR: the session token is written as plain-text JSON", async () => {
  await store(FAKE.session);
  await runDriver(sb, { fn: "updateSessionData", prop: "selectedWorkspace", value: "ws-1" });
  assert.equal(
    readFileSync(sb.sessionPath, "utf8"),
    JSON.stringify({ token: FAKE.session, selectedWorkspace: "ws-1" }, null, 2),
  );
});

// SECURITY / PINS SUSPECT BEHAVIOUR: the session file is created with default permissions, so with
// the usual umask 022 it is readable by every user on the machine (0644), and so is its folder.
test("SECURITY PINS SUSPECT BEHAVIOUR: the session file is world-readable (0644), not owner-only", async () => {
  await store(FAKE.session);
  const mode = statSync(sb.sessionPath).mode & 0o777;
  assert.equal(mode, 0o644);
  assert.notEqual(mode & 0o077, 0, "group/other can read the token");
  assert.equal(statSync(sb.cacheDir).mode & 0o777, 0o755);
});

test("an existing owner-only session file keeps its permissions when updated", async () => {
  sb.writeSession({ token: "id-FAKE-OLD-test-only" });
  chmodSync(sb.sessionPath, 0o600);
  await store(FAKE.session);
  assert.equal(statSync(sb.sessionPath).mode & 0o777, 0o600);
  assert.equal(sb.readSession().token, FAKE.session);
});

test("reading: missing file gives null quietly; a missing or empty property gives null", async () => {
  let r = await runDriver(sb, { fn: "getSessionData" });
  assert.deepEqual(r.result, { ok: true, value: null });
  assert.equal(r.output.trim(), "");
  sb.writeSession({ selectedWorkspace: "ws-1", token: "" });
  r = await runDriver(sb, { fn: "getSessionData", prop: "token" });
  assert.deepEqual(r.result, { ok: true, value: null });
  r = await runDriver(sb, { fn: "getSessionData" });
  assert.deepEqual(r.result.value, { selectedWorkspace: "ws-1", token: "" });
});

test("a corrupt session file: reading throws and reports it; writing refuses to overwrite it", async () => {
  sb.writeSession("{not json");
  let r = await runDriver(sb, { fn: "getSessionData", prop: "token" });
  assert.equal(r.result.ok, false);
  assert.match(r.stderr, /Failed to read session data:/);
  r = await store(FAKE.session);
  assert.equal(r.result.ok, false);
  assert.match(r.stderr, /Failed to update session data:/);
  assert.equal(readFileSync(sb.sessionPath, "utf8"), "{not json");
});

test("not signed in: an API call is refused locally with a sign-in hint and no request", async () => {
  const r = await runDriver(sb, { fn: "graphQuery" });
  assert.equal(r.result.ok, false);
  assert.equal(r.result.error, "Not authenticated: No token found. Run `aloma auth` to login.");
  assert.equal(api.requests.length, 0);
});

test("a stored session is sent to the configured GraphQL URL as Bearer header and cookie", async () => {
  sb.writeSession({ token: FAKE.session });
  const r = await runDriver(sb, { fn: "graphQuery", query: "query { me { id } }" });
  assert.equal(r.result.ok, true, r.output);
  assert.equal(api.requests.length, 1);
  const q = api.requests[0];
  assert.equal(q.method, "POST");
  assert.equal(q.url, "/graphql");
  assert.equal(q.headers.authorization, `Bearer ${FAKE.session}`);
  assert.equal(q.headers.cookie, `Authorization=Bearer%20${encodeURIComponent(FAKE.session)}`);
  assert.deepEqual(JSON.parse(q.body), { query: "query { me { id } }", variables: {} });
  // SECURITY: never in the URL.
  assert.deepEqual(leakedSecrets(q.url), []);
});

// PINS SUSPECT BEHAVIOUR: there is no expiry or refresh handling. An expired session keeps being
// sent, the error is passed through as-is, the stale session stays on disk, and there is no refresh
// attempt or "sign in again" hint.
test("PINS SUSPECT BEHAVIOUR: an expired session gives the API's error, no refresh, session kept", async () => {
  sb.writeSession({ token: FAKE.session });
  api.ctl.graphql = () => ({ errors: [{ message: "Unauthorized" }] });
  const r = await runDriver(sb, { fn: "graphQuery" });
  assert.equal(r.result.ok, false);
  assert.equal(r.result.error, "Unauthorized");
  assert.match(r.stderr, /GraphQL Error: Unauthorized/);
  assert.equal(api.requests.length, 1, "no retry or refresh");
  assert.equal(sb.readSession().token, FAKE.session);
  assert.deepEqual(leakedSecrets(r.output), []);
});

test("PINS SUSPECT BEHAVIOUR: a 401 with a non-JSON body surfaces as a JSON parse error", async () => {
  sb.writeSession({ token: FAKE.session });
  api.ctl.graphql = () => ({ __raw: true, status: 401, headers: { "content-type": "text/html" }, body: "<h1>401</h1>" });
  const r = await runDriver(sb, { fn: "graphQuery" });
  assert.equal(r.result.ok, false);
  assert.match(r.result.error, /invalid json response body/);
  assert.equal(sb.readSession().token, FAKE.session);
  assert.deepEqual(leakedSecrets(r.output), []);
});
