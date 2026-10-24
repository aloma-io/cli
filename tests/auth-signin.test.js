// Characterisation + security tests for `aloma auth` (alias `aloma login`): browser sign-in with
// OAuth2 authorization code + PKCE against the login service, then the ID token is exchanged with
// the Aloma API for a server-issued session (PB-060), which is stored and a default workspace chosen.
// Every host is a loopback mock; the browser is simulated; no real host is ever contacted.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { makeSandbox, runCli, freePort, FAKE, leakedSecrets } from "./helpers/sandbox.js";
import { startMockIdp, startMockApi } from "./helpers/mock-idp.js";

let sb, idp, api, port, redirectUri;
const live = [];

async function setup({ discovery = true, config = {} } = {}) {
  idp = await startMockIdp({ discovery });
  api = await startMockApi();
  live.push(idp, api);
  port = await freePort();
  redirectUri = `http://localhost:${port}`;
  sb = makeSandbox({
    config: {
      keycloakRealmUrl: idp.issuer,
      clientId: "graph-cli",
      redirectUri,
      scope: "openid profile email groups",
      graphqlUrl: api.graphqlUrl,
      graphqlHost: new URL(api.origin).host,
      jwksUrl: `${idp.issuer}/protocol/openid-connect/certs`,
      ...config,
    },
  });
}

// The simulated browser: let the login service accept the request, then follow its redirect back.
const browser = (mutateCallback = (u) => u) => async (authUrl) => {
  const cb = mutateCallback(idp.authorize(authUrl), authUrl);
  const res = await fetch(cb);
  return { status: res.status, body: await res.text(), authUrl };
};

const sessionCalls = () => api.requests.filter((r) => r.url === "/oauth2/cli/session");
const tokenCalls = () => idp.requests.filter((r) => r.url.endsWith("/protocol/openid-connect/token"));

beforeEach(() => setup());
afterEach(async () => {
  while (live.length) await live.pop().close();
  sb.cleanup();
});
test("happy path: browser sign-in, session exchange, session stored, default workspace chosen", async () => {
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 0, r.output);
  assert.match(r.stdout, /Initiating authentication flow\.\.\./);
  assert.match(r.stdout, /Please follow the instructions in your browser\./);
  assert.match(r.stdout, /Switched to workspace \[Fake Workspace\]/);
  assert.match(r.stdout, /Authentication completed successfully!/);
  assert.match(r.stdout, /aloma workspace list/);

  // The browser was sent to the login service once and shown the success page.
  assert.equal(r.opened.length, 1);
  assert.equal(r.browser[0].status, 200);
  assert.match(r.browser[0].body, /Authentication successful!/);

  // The stored session is exactly the API-issued session plus the chosen workspace.
  assert.deepEqual(sb.readSession(), { selectedWorkspace: "ws-fake-1", token: FAKE.session });

  // The API received the login service's ID token (and only that) for the exchange.
  assert.equal(sessionCalls().length, 1);
  assert.deepEqual(JSON.parse(sessionCalls()[0].body), { id_token: idp.ctl.issued[0] });
  assert.equal(sessionCalls()[0].headers.authorization, undefined);

  // The default-workspace lookup used the new session.
  const gql = api.requests.filter((q) => q.url === "/graphql");
  assert.ok(gql.length >= 1);
  for (const q of gql) assert.equal(q.headers.authorization, `Bearer ${FAKE.session}`);
});

test("alias: `aloma login` runs the same sign-in", async () => {
  const r = await runCli(sb, ["login"], { onOpen: browser() });
  assert.equal(r.code, 0, r.output);
  assert.equal(sb.readSession().token, FAKE.session);
});

test("authorization request: code flow, PKCE S256, state and nonce, configured client and redirect", async () => {
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 0, r.output);
  const a = new URL(r.opened[0]);
  assert.equal(`${a.origin}${a.pathname}`, `${idp.issuer}/protocol/openid-connect/auth`);
  const p = a.searchParams;
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("client_id"), "graph-cli");
  assert.equal(p.get("redirect_uri"), redirectUri);
  assert.equal(p.get("scope"), "openid profile email groups");
  assert.equal(p.get("response_mode"), "query");
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.match(p.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(p.get("state") && p.get("state").length >= 32, "state is random and long");
  assert.ok(p.get("nonce") && p.get("nonce").length >= 32, "nonce is random and long");
  assert.equal(p.get("code_verifier"), null, "the PKCE verifier never leaves the CLI in the URL");
  // The token request carried the verifier (the mock refuses a wrong one) and no client secret.
  const form = new URLSearchParams(tokenCalls()[0].body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.ok(form.get("code_verifier"));
  assert.equal(form.get("client_secret"), null);
  assert.equal(tokenCalls()[0].headers.authorization, undefined);
});

test("each sign-in uses a fresh state, nonce and PKCE challenge", async () => {
  const r1 = await runCli(sb, ["auth"], { onOpen: browser() });
  const first = new URL(r1.opened[0]).searchParams;
  sb.cleanup();
  await setup();
  const r2 = await runCli(sb, ["auth"], { onOpen: browser() });
  const second = new URL(r2.opened[0]).searchParams;
  for (const k of ["state", "nonce", "code_challenge"]) assert.notEqual(first.get(k), second.get(k), k);
});

// SECURITY: nothing secret is printed, and only the session reaches the disk.
test("SECURITY: no token, code or ID token is printed; access and refresh tokens are not stored", async () => {
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 0, r.output);
  assert.deepEqual(leakedSecrets(r.output), []);
  assert.ok(!r.output.includes(idp.ctl.issued[0]), "ID token printed");
  const raw = JSON.stringify(sb.readSession());
  assert.ok(!raw.includes(FAKE.accessToken), "access token stored");
  assert.ok(!raw.includes(FAKE.refreshToken), "refresh token stored");
  assert.ok(!raw.includes(idp.ctl.issued[0]), "ID token stored");
  // The browser success page shows no secret either.
  assert.deepEqual(leakedSecrets(r.browser[0].body), []);
});

// SECURITY: the authorization URL (which lands in browser history) carries no token.
test("SECURITY: no token in the authorization URL", async () => {
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.deepEqual(leakedSecrets(r.opened[0]), []);
  assert.ok(!/token=/i.test(r.opened[0]));
});

// SECURITY (was PINS SUSPECT BEHAVIOUR: the callback server was started with listen(port) and no
// host, so it listened on every network interface during sign-in). It binds loopback only.
test("SECURITY: the callback server listens on loopback only", async () => {
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 0, r.output);
  assert.ok(r.listens.length >= 1);
  for (const l of r.listens) {
    assert.equal(String(l[0]), String(port));
    assert.ok(["127.0.0.1", "::1"].includes(l[1]), `bound to ${JSON.stringify(l)}`);
  }
  assert.ok(r.listens.some((l) => l[1] === "127.0.0.1"));
});

test("SECURITY: a redirect URI that is not loopback http is refused before anything listens", async () => {
  for (const redirectUri of ["http://192.0.2.10:8989", "https://localhost:8989", "http://evil.example.test:8989"]) {
    const r = await runCli(sb, ["auth"], { env: { ALOMA_REDIRECT_URI: redirectUri }, onOpen: browser() });
    assert.equal(r.code, 1, redirectUri);
    assert.match(r.stderr, /redirect URI must be http:\/\/localhost/i);
    assert.deepEqual(r.listens, []);
    assert.deepEqual(r.opened, []);
  }
});

test("a callback with the wrong state is refused: no token request, no session, exit 1", async () => {
  const r = await runCli(sb, ["auth"], {
    onOpen: browser((cb) => {
      const u = new URL(cb);
      u.searchParams.set("state", "forged-state");
      return u.toString();
    }),
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Callback handling failed: Invalid state parameter/);
  assert.match(r.stderr, /Authentication failed: Invalid state parameter/);
  assert.equal(r.browser[0].status, 500);
  assert.equal(tokenCalls().length, 0);
  assert.equal(sessionCalls().length, 0);
  assert.equal(sb.readSession(), null);
});

// PINS SUSPECT BEHAVIOUR: any request to the callback port without the right state (a browser's
// /favicon.ico, a port scan, another local process) aborts the whole sign-in.
test("PINS SUSPECT BEHAVIOUR: one stray request to the callback port aborts the sign-in", async () => {
  const r = await runCli(sb, ["auth"], {
    onOpen: async (authUrl) => {
      const stray = await fetch(`${redirectUri}/favicon.ico`);
      let later;
      try {
        later = (await fetch(idp.authorize(authUrl))).status;
      } catch (e) {
        later = "connection failed";
      }
      return { stray: stray.status, later };
    },
  });
  assert.equal(r.code, 1);
  assert.equal(r.browser[0].stray, 500);
  assert.match(r.stderr, /Invalid state parameter/);
  assert.equal(sb.readSession(), null);
});

// SECURITY (was PINS SUSPECT BEHAVIOUR: the error text was put into the browser page without HTML
// escaping). It is escaped now.
test("SECURITY: an error from the login service is HTML-escaped in the page", async () => {
  const r = await runCli(sb, ["auth"], {
    onOpen: async (authUrl) => {
      const state = new URL(authUrl).searchParams.get("state");
      const cb = new URL(redirectUri);
      cb.searchParams.set("state", state);
      cb.searchParams.set("error", "access_denied");
      cb.searchParams.set("error_description", "<b id=x>denied</b>");
      const res = await fetch(cb);
      return { status: res.status, body: await res.text() };
    },
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /OAuth2 error: <b id=x>denied<\/b>/);
  assert.equal(r.browser[0].status, 500);
  assert.ok(r.browser[0].body.includes("<pre>OAuth2 error: &lt;b id=x&gt;denied&lt;/b&gt;</pre>"));
  assert.ok(!r.browser[0].body.includes("<b id=x>"));
  assert.equal(tokenCalls().length, 0);
  assert.equal(sb.readSession(), null);
});

test("an ID token from the wrong issuer is rejected before the session exchange", async () => {
  idp.ctl.idTokenOverrides = { iss: "http://127.0.0.1:1/realms/other" };
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Callback handling failed: unexpected iss value/);
  assert.equal(sessionCalls().length, 0);
  assert.equal(sb.readSession(), null);
});

test("an ID token with the wrong nonce is rejected before the session exchange", async () => {
  idp.ctl.idTokenOverrides = { nonce: "not-the-nonce" };
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /nonce mismatch/);
  assert.equal(sessionCalls().length, 0);
  assert.equal(sb.readSession(), null);
});

test("no ID token from the login service: sign-in fails, API not contacted", async () => {
  idp.ctl.includeIdToken = false;
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Callback handling failed: id_token not present in TokenSet/);
  assert.equal(sessionCalls().length, 0);
  assert.equal(sb.readSession(), null);
});

test("no access token from the login service: sign-in fails, API not contacted", async () => {
  idp.ctl.includeAccessToken = false;
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No access token received from authorization server/);
  assert.equal(sessionCalls().length, 0);
  assert.equal(sb.readSession(), null);
});

test("the login service refusing the code: sign-in fails, no session", async () => {
  idp.ctl.tokenStatus = 500;
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Callback handling failed: server_error/);
  assert.equal(sessionCalls().length, 0);
  assert.equal(sb.readSession(), null);
});

test("the API refusing the exchange: sign-in fails with the status, nothing stored", async () => {
  api.ctl.sessionStatus = 401;
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Aloma sign-in was not accepted \(401\)/);
  assert.equal(r.browser[0].status, 500);
  assert.match(r.browser[0].body, /Authentication Failed/);
  assert.equal(sb.readSession(), null);
  assert.deepEqual(leakedSecrets(r.output), []);
});

test("the API answering with something that is not a session: sign-in fails, nothing stored", async () => {
  api.ctl.sessionBody = () => ({ token: FAKE.accessToken });
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Aloma sign-in returned no session/);
  assert.equal(sb.readSession(), null);
});

test("discovery unavailable: falls back to Keycloak's standard endpoints and still signs in", async () => {
  await Promise.all(live.splice(0).map((s) => s.close()));
  sb.cleanup();
  await setup({ discovery: false });
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 0, r.output);
  assert.match(r.stdout, /Discovery failed: /);
  assert.match(r.stdout, /Using manual endpoint configuration/);
  assert.equal(sb.readSession().token, FAKE.session);
});

test("login service not configured: clear message, no browser, exit 1", async () => {
  sb.cleanup();
  sb = makeSandbox({ config: { graphqlUrl: api.graphqlUrl, redirectUri } });
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Keycloak Realm URL not configured\. Run 'aloma setup'\./);
  assert.equal(r.opened.length, 0);
});

test("no browser activity: the sign-in times out (5 minutes, shortened here) and exits 1", async () => {
  const r = await runCli(sb, ["auth"], {
    env: { ALOMA_TEST_SHORT_AUTH_TIMEOUT: "300" },
    onOpen: async () => ({ ignored: true }),
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Authentication timed out after 5 minutes\./);
  assert.match(r.stderr, /Authentication failed: Authentication timed out/);
  assert.equal(sb.readSession(), null);
});

test("signing in again replaces the stored session and keeps unrelated keys", async () => {
  sb.writeSession({ token: "id-FAKE-OLD-test-only", selectedWorkspace: "ws-old", other: "kept" });
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 0, r.output);
  assert.deepEqual(sb.readSession(), { token: FAKE.session, selectedWorkspace: "ws-fake-1", other: "kept" });
});

// PINS SUSPECT BEHAVIOUR: a corrupt session file is not replaced; sign-in fails after the
// exchange succeeded, and the user has to run `aloma logout` first.
test("PINS SUSPECT BEHAVIOUR: a corrupt session file makes sign-in fail after a good exchange", async () => {
  sb.writeSession("{not json");
  const r = await runCli(sb, ["auth"], { onOpen: browser() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Failed to update session data:/);
  assert.equal(sessionCalls().length, 1);
});
