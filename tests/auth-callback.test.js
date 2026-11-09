// Sign-in callback tests for `aloma auth`: what the local callback server does with the requests
// that reach it (state check, repeated callbacks, expired state), what happens when the browser
// cannot be opened, and the messages for missing client or realm settings and unusable redirects.
// The login service and the API are loopback mocks, the browser is simulated, the session file is
// in a temporary HOME; no real sign-in takes place.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { makeSandbox, runCli, freePort, startServer, json, FAKE, REPO } from "./helpers/sandbox.js";
import { startMockIdp, startMockApi } from "./helpers/mock-idp.js";

const CLOCK_SHIFT = pathToFileURL(path.join(REPO, "tests", "fixtures", "clock-shift.mjs")).href;
const OLD_SESSION = { token: "id-FAKE-OLD-test-only", selectedWorkspace: "ws-old" };

let sb, idp, api, redirectUri;
const live = [];

async function setup({ graphqlOrigin } = {}) {
  idp = await startMockIdp({ discovery: true });
  api = await startMockApi();
  live.push(idp, api);
  redirectUri = `http://localhost:${await freePort()}`;
  const origin = graphqlOrigin ?? api.origin;
  sb = makeSandbox({
    config: {
      keycloakRealmUrl: idp.issuer,
      clientId: "graph-cli",
      redirectUri,
      scope: "openid profile email groups",
      graphqlUrl: `${origin}/graphql`,
      graphqlHost: new URL(origin).host,
      jwksUrl: `${idp.issuer}/protocol/openid-connect/certs`,
    },
  });
}

// The simulated browser: let the login service accept the request, then follow its redirect back.
const browser = () => async (authUrl) => {
  const res = await fetch(idp.authorize(authUrl));
  return { status: res.status, body: await res.text() };
};

const sessionCalls = () => api.requests.filter((r) => r.url === "/oauth2/cli/session");
const tokenCalls = () => idp.requests.filter((r) => r.url.endsWith("/protocol/openid-connect/token"));
const clockFlag = () => path.join(sb.root, "clock-ahead");
const forged = (url) => {
  const u = new URL(url);
  u.searchParams.set("state", "forged-state");
  return u.toString();
};
const until = async (cond, what) => {
  for (let i = 0; i < 400; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
};

beforeEach(() => setup());
afterEach(async () => {
  while (live.length) await live.pop().close();
  sb.cleanup();
});

test("a callback whose state value does not match is rejected: saved session unchanged, no code exchanged", async () => {
  sb.writeSession(OLD_SESSION);
  const r = await runCli(sb, ["auth"], {
    onOpen: async (authUrl) => {
      const res = await fetch(forged(idp.authorize(authUrl)));
      return { status: res.status, body: await res.text() };
    },
  });
  assert.equal(r.code, 1);
  assert.equal(r.browser[0].status, 500);
  assert.match(r.browser[0].body, /Authentication Failed/);
  assert.match(r.browser[0].body, /<pre>Invalid state parameter<\/pre>/);
  assert.match(r.stderr, /Authentication failed: Invalid state parameter/);
  assert.equal(tokenCalls().length, 0);
  assert.equal(sessionCalls().length, 0);
  assert.deepEqual(sb.readSession(), OLD_SESSION);
});

test("a callback without any state value is rejected the same way", async () => {
  const r = await runCli(sb, ["auth"], {
    onOpen: async () => {
      const res = await fetch(`${redirectUri}/?code=${FAKE.code}`);
      return { status: res.status, body: await res.text() };
    },
  });
  assert.equal(r.code, 1);
  assert.equal(r.browser[0].status, 500);
  assert.match(r.stderr, /Invalid state parameter/);
  assert.equal(tokenCalls().length, 0);
  assert.equal(sb.readSession(), null);
});

test("a second callback while sign-in is finishing gets the 'already complete' page and leaves the saved session unchanged", async () => {
  // An API whose workspace lookup waits for the test, so the sign-in is held after the session
  // has been saved and before the callback server is shut down.
  let release;
  const gate = new Promise((r) => (release = r));
  let lookups = 0;
  const gated = await startServer(async (req, res) => {
    if (req.url === "/oauth2/cli/session") return json(res, 200, { token: FAKE.session });
    if (req.url === "/graphql") {
      lookups++;
      await gate;
      return json(res, 200, api.ctl.graphql(JSON.parse(req.body).query));
    }
    return json(res, 404, {});
  });
  live.push(gated);
  sb.cleanup();
  await setup({ graphqlOrigin: gated.origin });

  const seen = {};
  const r = await runCli(sb, ["auth"], {
    onOpen: async (authUrl) => {
      const cb = idp.authorize(authUrl);
      try {
        const first = fetch(cb).then(async (res) => ({ status: res.status, body: await res.text() }));
        await until(() => lookups > 0, "the workspace lookup");
        seen.saved = sb.readSession();
        const second = await fetch(cb);
        seen.second = { status: second.status, body: await second.text() };
        const other = await fetch(forged(cb));
        seen.other = { status: other.status, body: await other.text() };
        seen.afterSecond = sb.readSession();
        release();
        return { first: await first };
      } finally {
        release();
      }
    },
  });
  assert.equal(r.code, 0, r.output);
  assert.equal(seen.second.status, 200);
  assert.match(seen.second.body, /Authentication already completed!/);
  assert.equal(seen.other.status, 200);
  assert.match(seen.other.body, /Authentication already completed!/);
  assert.deepEqual(seen.saved, { selectedWorkspace: null, token: FAKE.session });
  assert.deepEqual(seen.afterSecond, seen.saved);
  // The first callback still got the success page, and the code was exchanged once.
  assert.equal(r.browser[0].first.status, 200);
  assert.match(r.browser[0].first.body, /Authentication successful!/);
  assert.equal(tokenCalls().length, 1);
  assert.equal(sessionCalls().length, 0); // the exchange went to the gated API, not the mock
  assert.deepEqual(sb.readSession(), { selectedWorkspace: "ws-fake-1", token: FAKE.session });
});

test("a request with a non-matching state after the state is five minutes old gets the 'expired' response and no session is written", async () => {
  sb.writeSession(OLD_SESSION);
  const r = await runCli(sb, ["auth"], {
    env: {
      NODE_OPTIONS: `--import=${CLOCK_SHIFT}`,
      ALOMA_TEST_CLOCK_SHIFT_MS: String(6 * 60 * 1000),
      ALOMA_TEST_CLOCK_FLAG: clockFlag(),
      ALOMA_TEST_SHORT_AUTH_TIMEOUT: "1500",
    },
    onOpen: async () => {
      writeFileSync(clockFlag(), "");
      const res = await fetch(`${redirectUri}/?code=${FAKE.code}&state=old-state`);
      return { status: res.status, body: await res.text() };
    },
  });
  assert.equal(r.browser[0].status, 400);
  assert.match(r.browser[0].body, /Authentication expired/);
  assert.match(r.browser[0].body, /Please try the authentication process again\./);
  assert.match(r.stdout, /State parameter expired, this might be a duplicate or delayed request/);
  assert.equal(tokenCalls().length, 0);
  assert.equal(sessionCalls().length, 0);
  assert.deepEqual(sb.readSession(), OLD_SESSION);
  // The expired response does not end the sign-in; it ends at the timeout.
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Authentication failed: Authentication timed out after 5 minutes\./);
});

test("after an 'expired' response, a callback with the matching state still completes the sign-in", async () => {
  const r = await runCli(sb, ["auth"], {
    env: {
      NODE_OPTIONS: `--import=${CLOCK_SHIFT}`,
      ALOMA_TEST_CLOCK_SHIFT_MS: String(6 * 60 * 1000),
      ALOMA_TEST_CLOCK_FLAG: clockFlag(),
    },
    onOpen: async (authUrl) => {
      // The clock runs six minutes ahead for the first request only.
      writeFileSync(clockFlag(), "");
      const early = await fetch(forged(idp.authorize(authUrl)));
      rmSync(clockFlag());
      const late = await fetch(idp.authorize(authUrl));
      return { early: early.status, late: late.status, lateBody: await late.text() };
    },
  });
  assert.equal(r.code, 0, r.output);
  assert.equal(r.browser[0].early, 400);
  assert.equal(r.browser[0].late, 200);
  assert.match(r.browser[0].lateBody, /Authentication successful!/);
  assert.deepEqual(sb.readSession(), { selectedWorkspace: "ws-fake-1", token: FAKE.session });
});

test("when the browser cannot be opened, a notice is printed and the sign-in completes from the callback", async () => {
  const r = await runCli(sb, ["auth"], { env: { ALOMA_TEST_OPEN_FAILS: "1" }, onOpen: browser() });
  assert.equal(r.code, 0, r.output);
  assert.equal(r.opened.length, 1);
  assert.match(r.stdout, /Could not open browser automatically\./);
  assert.match(r.stdout, /Authentication completed successfully!/);
  assert.equal(r.browser[0].status, 200);
  assert.deepEqual(sb.readSession(), { selectedWorkspace: "ws-fake-1", token: FAKE.session });
  // The notice is printed once and gives the authorization URL, so sign-in can be finished by hand.
  assert.ok(r.stdout.includes(r.opened[0]), "authorization URL not printed");
  assert.equal(r.stdout.match(/Could not open browser/g).length, 1);
});

test("when the browser cannot be opened and no callback arrives, the sign-in times out and no session is written", async () => {
  const r = await runCli(sb, ["auth"], {
    env: { ALOMA_TEST_OPEN_FAILS: "1", ALOMA_TEST_SHORT_AUTH_TIMEOUT: "400" },
    onOpen: async () => ({ ignored: true }),
  });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /Could not open browser automatically\./);
  assert.ok(r.stdout.includes(r.opened[0]), "authorization URL not printed");
  assert.match(r.stderr, /Authentication timed out after 5 minutes\./);
  assert.equal(sb.readSession(), null);
});

test("a client ID left as the placeholder gives the 'not configured' message before anything listens or opens", async () => {
  const r = await runCli(sb, ["auth"], { env: { ALOMA_CLIENT_ID: "YOUR_CLIENT_ID" }, onOpen: browser() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Authentication failed: Keycloak Client ID not configured\. Run 'aloma setup'\./);
  assert.deepEqual(r.opened, []);
  assert.equal(tokenCalls().length, 0);
  assert.equal(sb.readSession(), null);
});

test("a realm URL left as the placeholder gives the 'not configured' message", async () => {
  const r = await runCli(sb, ["auth"], {
    env: { ALOMA_KEYCLOAK_REALM_URL: "YOUR_KEYCLOAK_REALM_URL" },
    onOpen: browser(),
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Keycloak Realm URL not configured\. Run 'aloma setup'\./);
  assert.deepEqual(r.opened, []);
  assert.equal(sb.readSession(), null);
});

test("a redirect URI without a port, with another scheme, or that is not a URL gives the redirect message", async () => {
  for (const uri of ["http://localhost", "ftp://localhost:8989", "not a url", "http://0.0.0.0:8989"]) {
    const r = await runCli(sb, ["auth"], { env: { ALOMA_REDIRECT_URI: uri }, onOpen: browser() });
    assert.equal(r.code, 1, uri);
    assert.match(r.stderr, /Authentication failed: The redirect URI must be http:\/\/localhost:<port> \(a loopback address\)/);
    assert.deepEqual(r.listens, [], uri);
    assert.deepEqual(r.opened, [], uri);
    assert.equal(sb.readSession(), null, uri);
  }
});
