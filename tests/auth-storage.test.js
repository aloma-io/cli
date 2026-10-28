// Characterisation + security tests for where and how the CLI keeps its session
// (src/utils.js getStoragePath / updateSessionData / getSessionData) and how a stored session is
// used and expires (graphQuery). Each case runs in a sandboxed process; all hosts are loopback mocks.
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { makeSandbox, runDriver, FAKE, leakedSecrets, REPO } from "./helpers/sandbox.js";
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

test("the session lives in <HOME>/.config/aloma/session.json, not in any package folder", async () => {
  const r = await runDriver(sb, { fn: "getStoragePath" });
  assert.equal(r.result.value, sb.configDir);
  await store(FAKE.session);
  assert.ok(existsSync(sb.sessionPath));
  assert.equal(existsSync(sb.plantedSessionPath), false, "nothing written under the cwd's node_modules");
  assert.equal(existsSync(path.join(sb.project, "node_modules", "@aloma.io", "aloma", ".cache")), false);
});

test("XDG_CONFIG_HOME (absolute) moves the folder; a relative one is ignored", async () => {
  const xdg = path.join(sb.root, "xdg");
  let r = await runDriver(sb, { fn: "getStoragePath" }, { env: { XDG_CONFIG_HOME: xdg } });
  assert.equal(r.result.value, path.join(xdg, "aloma"));
  r = await runDriver(sb, { fn: "getStoragePath" }, { env: { XDG_CONFIG_HOME: "relative/dir" } });
  assert.equal(r.result.value, sb.configDir);
});

// SECURITY (was PINS SUSPECT BEHAVIOUR: the package root was looked up from the current directory
// first, so a cloned repository shipping node_modules/@aloma.io/aloma/.config/config.json chose the
// API host and received the stored session). Now neither the config nor the session in the cwd's
// node_modules is ever read.
test("SECURITY: a config and session planted in the current directory's node_modules are ignored", async () => {
  const attacker = await startMockApi();
  try {
    sb.plant({
      config: { graphqlUrl: attacker.graphqlUrl, sessionUrl: `${attacker.origin}/oauth2/cli/session` },
      session: { token: "id-FAKE-PLANTED-test-only" },
    });
    sb.writeSession({ token: FAKE.session });
    const r = await runDriver(sb, { fn: "graphQuery" });
    assert.equal(r.result.ok, true, r.output);
    assert.equal(attacker.requests.length, 0, "the planted API host is never contacted");
    assert.equal(api.requests.length, 1);
    assert.equal(api.requests[0].headers.authorization, `Bearer ${FAKE.session}`, "the user's own session");
    const c = await runDriver(sb, { fn: "config" });
    assert.equal(c.result.value.GRAPHQL_URL, api.graphqlUrl);
    assert.equal(readFileSync(sb.plantedSessionPath, "utf8"), JSON.stringify({ token: "id-FAKE-PLANTED-test-only" }));
  } finally {
    await attacker.close();
  }
});

test("SECURITY: a session planted in the current directory is not imported when none is stored", async () => {
  sb.plant({ session: { token: "id-FAKE-PLANTED-test-only" } });
  const r = await runDriver(sb, { fn: "getSessionData", prop: "token" });
  assert.deepEqual(r.result, { ok: true, value: null });
  assert.equal(existsSync(sb.sessionPath), false);
});

test("no install lookup is needed: storage works with no local and no global package", async () => {
  rmSync(path.join(sb.project, "node_modules"), { recursive: true });
  const r = await runDriver(sb, { fn: "getStoragePath" });
  assert.equal(r.result.ok, true, r.output);
  assert.equal(r.result.value, sb.configDir);
});

// Decision (not keytar, see src/paths.js): the session stays a plain JSON file, but owner-only.
test("the session token is written as plain JSON in an owner-only file", async () => {
  await store(FAKE.session);
  await runDriver(sb, { fn: "updateSessionData", prop: "selectedWorkspace", value: "ws-1" });
  assert.equal(
    readFileSync(sb.sessionPath, "utf8"),
    JSON.stringify({ token: FAKE.session, selectedWorkspace: "ws-1" }, null, 2),
  );
  assert.equal(statSync(sb.sessionPath).mode & 0o777, 0o600);
});

// SECURITY (was PINS SUSPECT BEHAVIOUR: created with default permissions, 0644 in a 0755 folder,
// readable by every user on the machine).
test("SECURITY: the session file is created owner-only (0600) in an owner-only folder (0700)", async () => {
  await store(FAKE.session);
  const mode = statSync(sb.sessionPath).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal(mode & 0o077, 0, "group/other cannot read the token");
  assert.equal(statSync(sb.configDir).mode & 0o777, 0o700);
});

test("SECURITY: an existing world-readable session file and folder are made owner-only on read", async () => {
  sb.writeSession({ token: FAKE.session });
  chmodSync(sb.sessionPath, 0o644);
  chmodSync(sb.configDir, 0o755);
  const r = await runDriver(sb, { fn: "getSessionData", prop: "token" });
  assert.equal(r.result.value, FAKE.session);
  assert.equal(statSync(sb.sessionPath).mode & 0o777, 0o600);
  assert.equal(statSync(sb.configDir).mode & 0o777, 0o700);
});

test("SECURITY: an existing world-readable session file is made owner-only on update", async () => {
  sb.writeSession({ token: "id-FAKE-OLD-test-only" });
  chmodSync(sb.sessionPath, 0o666);
  await store(FAKE.session);
  assert.equal(statSync(sb.sessionPath).mode & 0o777, 0o600);
  assert.equal(sb.readSession().token, FAKE.session);
});

// ---- migration of a session kept by an older version inside the installed package -------------

// An installed copy of this package (as `npm install -g` lays it out), so the CLI's own package
// folder is not the repository. Its node_modules points at the repository's.
function installCopy() {
  const pkg = path.join(sb.root, "global", "lib", "node_modules", "@aloma.io", "aloma");
  mkdirSync(path.join(pkg, "tests"), { recursive: true });
  cpSync(path.join(REPO, "src"), path.join(pkg, "src"), { recursive: true });
  cpSync(path.join(REPO, "config"), path.join(pkg, "config"), { recursive: true });
  cpSync(path.join(REPO, "package.json"), path.join(pkg, "package.json"));
  cpSync(path.join(REPO, "tests", "helpers"), path.join(pkg, "tests", "helpers"), { recursive: true });
  symlinkSync(path.join(REPO, "node_modules"), path.join(pkg, "node_modules"));
  const legacy = path.join(pkg, ".cache", "session.json");
  return { pkg, legacy, driver: path.join(pkg, "tests", "helpers", "driver.mjs") };
}

test("migration: a session kept by an older version in the installed package moves to HOME, owner-only", async () => {
  const inst = installCopy();
  mkdirSync(path.dirname(inst.legacy), { recursive: true });
  writeFileSync(inst.legacy, JSON.stringify({ token: FAKE.session, selectedWorkspace: "ws-1" }));
  chmodSync(inst.legacy, 0o644);
  const r = await runDriver(sb, { fn: "getSessionData", prop: "token" }, { driver: inst.driver });
  assert.deepEqual(r.result, { ok: true, value: FAKE.session }, r.output);
  assert.deepEqual(sb.readSession(), { token: FAKE.session, selectedWorkspace: "ws-1" });
  assert.equal(statSync(sb.sessionPath).mode & 0o777, 0o600);
  assert.equal(existsSync(inst.legacy), false, "the world-readable copy is removed");
  assert.deepEqual(leakedSecrets(r.output), []);
});

test("migration: an existing HOME session wins; the old copy is still removed", async () => {
  const inst = installCopy();
  mkdirSync(path.dirname(inst.legacy), { recursive: true });
  writeFileSync(inst.legacy, JSON.stringify({ token: "id-FAKE-OLD-test-only" }));
  sb.writeSession({ token: FAKE.session });
  const r = await runDriver(sb, { fn: "getSessionData", prop: "token" }, { driver: inst.driver });
  assert.equal(r.result.value, FAKE.session);
  assert.equal(existsSync(inst.legacy), false);
});

test("migration: a corrupt old session is left alone and not imported", async () => {
  const inst = installCopy();
  mkdirSync(path.dirname(inst.legacy), { recursive: true });
  writeFileSync(inst.legacy, "{not json");
  const r = await runDriver(sb, { fn: "getSessionData", prop: "token" }, { driver: inst.driver });
  assert.deepEqual(r.result, { ok: true, value: null });
  assert.equal(existsSync(sb.sessionPath), false);
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
  // PLAT-81: graphQuery no longer prints the error itself; the command's handler prints it once.
  assert.doesNotMatch(r.stderr, /GraphQL Error/);
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
