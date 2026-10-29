// Characterisation + security tests for `aloma company switch` as it touches the session: the CLI
// asks the API (https://<graphqlHost>/realm) for a session in the other company and stores the
// session it gets back in the Authorization cookie. The API is a loopback HTTPS mock with a
// throwaway self-signed certificate, trusted through NODE_EXTRA_CA_CERTS (TLS stays verified).
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { makeSandbox, makeCert, runCli, startServer, json, FAKE, leakedSecrets } from "./helpers/sandbox.js";
import { startMockApi } from "./helpers/mock-idp.js";

let cert, certSb, sb, api, realm, realmCtl;

before(() => {
  certSb = makeSandbox();
  cert = makeCert(certSb.root);
});
after(() => certSb.cleanup());

beforeEach(async () => {
  api = await startMockApi();
  realmCtl = {
    respond: (req, res) =>
      json(res, 200, {}, { "set-cookie": [`Authorization=Bearer%20${FAKE.switchedSession}; Path=/; HttpOnly; Secure`] }),
  };
  realm = await startServer((req, res) => realmCtl.respond(req, res), { tls: { key: cert.key, cert: cert.cert } });
  sb = makeSandbox({
    config: { graphqlUrl: api.graphqlUrl, graphqlHost: `127.0.0.1:${realm.port}`, keycloakRealmUrl: "http://127.0.0.1:1/x" },
  });
  sb.writeSession({ token: FAKE.session, selectedWorkspace: "ws-old" });
});
afterEach(async () => {
  await api.close();
  await realm.close();
  sb.cleanup();
});

const untrusted = { env: {} }; // no extra CA: the throwaway certificate is not trusted
const switchTo = (id, env = {}) =>
  runCli(sb, ["company", "switch", id], { env: { NODE_EXTRA_CA_CERTS: cert.certPath, ...env } });

test("switch by ID: asks for the company's session, stores it, picks a workspace with it", async () => {
  const r = await switchTo("realm-b");
  assert.equal(r.code, 0, r.output);
  assert.match(r.stdout, /Successfully switched to company \[Fake Company B\]/);
  assert.match(r.stdout, /Switched to workspace \[Fake Workspace\]/);
  assert.equal(realm.requests.length, 1);
  const q = realm.requests[0];
  assert.equal(q.method, "POST");
  assert.equal(q.url, "/realm?realm=realm-b");
  assert.equal(q.headers.authorization, `Bearer ${FAKE.session}`);
  assert.deepEqual(sb.readSession(), { token: FAKE.switchedSession, selectedWorkspace: "ws-fake-1" });
  // The workspace lookup after the switch used the new session.
  assert.equal(api.requests.at(-1).headers.authorization, `Bearer ${FAKE.switchedSession}`);
});

test("switch by name works the same", async () => {
  const r = await switchTo("Fake Company A");
  assert.equal(r.code, 0, r.output);
  assert.equal(realm.requests[0].url, "/realm?realm=realm-a");
  assert.equal(sb.readSession().token, FAKE.switchedSession);
});

test("unknown company: says so, nothing requested, session unchanged", async () => {
  const r = await switchTo("No Such Company");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No company with the id or name "No Such Company" among your companies\./); // PLAT-116 wording
  assert.equal(realm.requests.length, 0);
  assert.equal(sb.readSession().token, FAKE.session);
});

test("not signed in: the company list cannot be fetched, nothing requested", async () => {
  sb.writeSession({});
  const r = await switchTo("realm-b");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error switching company: Not authenticated: No token found/);
  assert.equal(realm.requests.length, 0);
  assert.equal(api.requests.length, 0);
});

// SECURITY: the session goes in the Authorization header only, never in the URL or the body.
test("SECURITY: the session is not put in the URL, the body, or the output", async () => {
  const r = await switchTo("realm-b");
  assert.deepEqual(leakedSecrets(realm.requests[0].url), []);
  assert.deepEqual(leakedSecrets(realm.requests[0].body), []);
  assert.deepEqual(leakedSecrets(r.output), []);
});

// PLAT-81: the API refusing the switch prints the error on stderr and exits 1 (was exit 0, stdout).
test("a refused switch prints the error, keeps the session, exits 1", async () => {
  realmCtl.respond = (req, res) => json(res, 403, { error: "forbidden" });
  const r = await switchTo("realm-b");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error switching company: Request failed with status code 403/);
  assert.deepEqual(sb.readSession(), { token: FAKE.session, selectedWorkspace: "ws-old" });
  assert.deepEqual(leakedSecrets(r.output), []);
});

// PINS SUSPECT BEHAVIOUR: no session cookie in the answer still reports success; the old company's
// session and workspace stay in place.
test("PINS SUSPECT BEHAVIOUR: no new session in the answer still reports success", async () => {
  realmCtl.respond = (req, res) => json(res, 200, {});
  const r = await switchTo("realm-b");
  assert.match(r.stdout, /Successfully switched to company \[Fake Company B\]/);
  assert.deepEqual(sb.readSession(), { token: FAKE.session, selectedWorkspace: "ws-old" });
});

// PINS SUSPECT BEHAVIOUR: the cookie value is cut at the first "=" after the name, and only a
// literal "Bearer%20" is decoded; nothing checks it is a session ("id-" prefix, as sign-in does).
test("PINS SUSPECT BEHAVIOUR: the cookie is parsed loosely: cut at '=', not URL-decoded, not checked", async () => {
  realmCtl.respond = (req, res) =>
    json(res, 200, {}, { "set-cookie": ["Authorization=Bearer%20id-FAKE-PAD-test-only==; Path=/"] });
  await switchTo("realm-b");
  assert.equal(sb.readSession().token, "id-FAKE-PAD-test-only");

  sb.writeSession({ token: FAKE.session });
  realmCtl.respond = (req, res) =>
    json(res, 200, {}, { "set-cookie": ["Authorization=not%2Da%2Dsession; Path=/"] });
  await switchTo("realm-b");
  assert.equal(sb.readSession().token, "not%2Da%2Dsession");
});

// SECURITY: TLS verification is on: an untrusted certificate stops the request before any data
// (and the session) is sent.
test("SECURITY: an untrusted certificate is refused; the session is not sent", async () => {
  const r = await runCli(sb, ["company", "switch", "realm-b"], untrusted);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error switching company: .*self[- ]signed certificate/); // PLAT-117: "request to <url> failed, reason: ..."
  assert.equal(realm.requests.length, 0);
  assert.equal(sb.readSession().token, FAKE.session);
});

// SECURITY: a redirect is never followed, to another host or to another port on the same host,
// so the session goes only to the configured API origin (was: followed, header dropped by host).
for (const [label, host] of [["another host", "localhost"], ["another port on the same host", "127.0.0.1"]]) {
  test(`SECURITY: a redirect to ${label} is refused; the session is not forwarded`, async () => {
    const other = await startServer((req, res) => json(res, 200, {}), {
      host,
      tls: { key: cert.key, cert: cert.cert },
    });
    try {
      realmCtl.respond = (req, res) => {
        res.writeHead(307, { location: `https://${host}:${other.port}/realm?realm=realm-b` });
        res.end();
      };
      const r = await switchTo("realm-b");
      assert.equal(r.code, 1);
      assert.match(r.stderr, /Error switching company:.*redirect/i);
      assert.equal(other.requests.length, 0, "redirect not followed");
      assert.deepEqual(sb.readSession(), { token: FAKE.session, selectedWorkspace: "ws-old" });
      assert.deepEqual(leakedSecrets(r.output), []);
    } finally {
      await other.close();
    }
  });
}
