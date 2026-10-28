// Characterisation + security tests for `aloma logout` (src/commands/auth/index.js clearSessionData).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { makeSandbox, runCli, FAKE, leakedSecrets } from "./helpers/sandbox.js";
import { startMockIdp, startMockApi } from "./helpers/mock-idp.js";

let sb, idp, api;

beforeEach(async () => {
  idp = await startMockIdp();
  api = await startMockApi();
  sb = makeSandbox({
    config: { keycloakRealmUrl: idp.issuer, clientId: "graph-cli", graphqlUrl: api.graphqlUrl },
  });
});
afterEach(async () => {
  await idp.close();
  await api.close();
  sb.cleanup();
});

const logoutCalls = () => idp.requests.filter((r) => r.url.includes("/protocol/openid-connect/logout"));

test("signed in: the local session file is removed and sign-out is confirmed", async () => {
  sb.writeSession({ token: FAKE.session, selectedWorkspace: "ws-1" });
  const r = await runCli(sb, ["logout"]);
  assert.equal(r.code, 0, r.output);
  assert.match(r.stdout, /✓ Logout completed - you have been signed out of Aloma/);
  assert.equal(sb.readSession(), null);
  // SECURITY: no token printed.
  assert.deepEqual(leakedSecrets(r.output), []);
});

// PINS SUSPECT BEHAVIOUR: sign-out does not revoke anything. The login-service logout request
// carries no token or id_token_hint (so it cannot end the browser's login session), and the API
// session (PB-060) is never revoked: the API is not contacted. A copied session stays valid.
test("PINS SUSPECT BEHAVIOUR: logout sends no token anywhere and does not revoke the API session", async () => {
  sb.writeSession({ token: FAKE.session });
  const r = await runCli(sb, ["logout"]);
  assert.equal(r.code, 0, r.output);
  assert.equal(logoutCalls().length, 1);
  const call = logoutCalls()[0];
  assert.equal(call.method, "GET");
  assert.equal(call.url, "/realms/test/protocol/openid-connect/logout");
  assert.equal(call.headers.authorization, undefined);
  assert.equal(call.headers.cookie, undefined);
  assert.equal(api.requests.length, 0, "API not asked to revoke the session");
  // SECURITY: the token is not put in any URL.
  for (const q of idp.requests) assert.deepEqual(leakedSecrets(q.url), []);
});

test("not signed in: says so twice, no network, exit 0", async () => {
  const r = await runCli(sb, ["logout"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /No active session found to terminate on Keycloak/);
  assert.match(r.stdout, /No local session data found to clear/);
  assert.equal(idp.requests.length, 0);
});

test("login service unreachable: warns, still clears the local session", async () => {
  sb.cleanup();
  sb = makeSandbox({ config: { keycloakRealmUrl: "http://127.0.0.1:1/realms/none", graphqlUrl: api.graphqlUrl } });
  sb.writeSession({ token: FAKE.session });
  const r = await runCli(sb, ["logout"]);
  assert.equal(r.code, 0, r.output);
  assert.match(r.stdout, /Could not terminate Keycloak session:/);
  assert.match(r.stdout, /the local session will still be cleared/);
  assert.match(r.stdout, /Logout completed/);
  assert.equal(sb.readSession(), null);
  assert.deepEqual(leakedSecrets(r.output), []);
});

test("login service not configured: warns, still clears the local session", async () => {
  sb.cleanup();
  sb = makeSandbox({ config: { graphqlUrl: api.graphqlUrl } });
  sb.writeSession({ token: FAKE.session });
  const r = await runCli(sb, ["logout"]);
  assert.equal(r.code, 0, r.output);
  assert.match(r.stdout, /Could not terminate Keycloak session: Keycloak Realm URL not configured/);
  assert.equal(sb.readSession(), null);
});

test("a corrupt session file is removed by logout (the way out of a broken session)", async () => {
  sb.writeSession("{not json");
  const r = await runCli(sb, ["logout"]);
  assert.equal(r.code, 0, r.output);
  assert.match(r.stderr, /Failed to read session data:/);
  assert.match(r.stdout, /Could not terminate Keycloak session:/);
  assert.match(r.stdout, /Logout completed/);
  assert.equal(sb.readSession(), null);
});

// PLAT-81: when the session cannot be removed the CLI says so once, on stderr, and exits 1 (was 0).
test("a session that cannot be removed is reported once, exit 1", async () => {
  mkdirSync(sb.sessionPath, { recursive: true }); // a directory where the file should be
  const r = await runCli(sb, ["logout"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^❌ Failed to clear session data: /m);
  assert.equal(r.stderr.match(/Failed to clear session data/g).length, 1);
  assert.doesNotMatch(r.stdout, /Logout completed/);
});
