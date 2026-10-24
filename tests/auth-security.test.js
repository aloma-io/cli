// Security checks across the sign-in, session and token code, pinned as today's behaviour.
// `// SECURITY:` marks a check that passes today; `// PINS SUSPECT BEHAVIOUR:` marks one that pins
// behaviour we think is wrong (the test documents it, it does not endorse it).
import assert from "node:assert/strict";
import dns from "node:dns";
import net from "node:net";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { makeSandbox, makeCert, runDriver, startServer, json, FAKE, leakedSecrets, REPO } from "./helpers/sandbox.js";
import { exchangeIdTokenForSession } from "../src/commands/auth/session.js";

const FAKE_ID_TOKEN = "FAKE-ID-TOKEN-5555-test-only";

// ---- the test harness itself: no real host can be reached -------------------------------------

test("harness: the network guard blocks non-loopback connections and lookups", async () => {
  assert.throws(() => net.connect({ host: "192.0.2.1", port: 443 }), /test network guard/);
  await assert.rejects(dns.promises.lookup("example.com"), /test network guard/);
  await new Promise((resolve) =>
    dns.lookup("example.com", (err) => {
      assert.match(err.message, /test network guard/);
      resolve();
    }),
  );
});

// ---- static checks over the source --------------------------------------------------------------

const srcFiles = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? srcFiles(p) : p.endsWith(".js") ? [p] : [];
  });
const SRC = srcFiles(path.join(REPO, "src"));
const AUTH_SRC = [
  "src/commands/auth/index.js",
  "src/commands/auth/session.js",
  "src/utils.js",
  "src/config.js",
  "src/commands/company/index.js",
].map((f) => path.join(REPO, f));

// SECURITY: TLS verification is never switched off anywhere in the CLI.
test("SECURITY: no code disables TLS certificate verification", () => {
  const offenders = SRC.filter((f) =>
    /rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|strictSSL|checkServerIdentity|insecureHTTPParser/.test(
      readFileSync(f, "utf8"),
    ),
  );
  assert.deepEqual(offenders, []);
});

// SECURITY: no console/log call in the auth code passes a token variable.
test("SECURITY: no log statement in the auth code prints a token variable", () => {
  const tokenVar = /\b(token|tokenData|sessionToken|tokenSet|idToken|id_token|access_token|refresh_token|codeVerifier)\b/;
  const hits = [];
  for (const f of AUTH_SRC) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/console\.(log|error|warn|info|debug)\(([\s\S]*?)\);/g)) {
      if (tokenVar.test(m[2])) hits.push(`${path.relative(REPO, f)}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(hits, []);
});

// SECURITY: tokens are never built into a URL or query string.
test("SECURITY: no URL in the auth code is built from a token", () => {
  const hits = [];
  for (const f of AUTH_SRC) {
    for (const m of readFileSync(f, "utf8").matchAll(/`[^`]*\?[^`]*\$\{([^}]*)\}[^`]*`/g)) {
      if (/token/i.test(m[1])) hits.push(`${path.relative(REPO, f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});

// ---- session exchange (src/commands/auth/session.js) ---------------------------------------------

describeExchange();
function describeExchange() {
  let api, other;
  before(async () => {
    other = await startServer((req, res) => json(res, 200, { token: "id-FAKE-OTHER-test-only" }), { host: "localhost" });
    api = await startServer((req, res) => {
      const u = new URL(req.url, "http://x");
      const to = u.searchParams.get("to");
      if (u.pathname === "/redirect") {
        const target = to === "same-host" ? `http://127.0.0.1:${other.port}` : `http://localhost:${other.port}`;
        res.writeHead(Number(u.searchParams.get("status")), { location: `${target}/oauth2/cli/session` });
        return res.end();
      }
      if (u.pathname === "/text") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("not json");
      }
      return json(res, 200, { token: FAKE.session });
    });
  });
  after(async () => {
    await api.close();
    await other.close();
  });
  beforeEach(() => {
    api.requests.length = 0;
    other.requests.length = 0;
  });

  test("exchange: the ID token goes in the JSON body, not the URL or a header", async () => {
    const token = await exchangeIdTokenForSession({ idToken: FAKE_ID_TOKEN, url: `${api.origin}/oauth2/cli/session` });
    assert.equal(token, FAKE.session);
    const q = api.requests[0];
    assert.ok(!q.url.includes(FAKE_ID_TOKEN));
    assert.equal(q.headers.authorization, undefined);
    assert.equal(q.headers["user-agent"], "Aloma CLI");
    assert.equal(q.headers.accept, "application/json");
    assert.deepEqual(JSON.parse(q.body), { id_token: FAKE_ID_TOKEN });
  });

  test("exchange: a non-JSON answer is refused as 'no session'", async () => {
    await assert.rejects(exchangeIdTokenForSession({ idToken: FAKE_ID_TOKEN, url: `${api.origin}/text` }), /returned no session/);
  });

  test("exchange: a non-string ID token is refused before any request", async () => {
    await assert.rejects(exchangeIdTokenForSession({ idToken: { a: 1 }, url: api.origin }), /No ID token/);
    await assert.rejects(exchangeIdTokenForSession({ url: api.origin }), /No ID token/);
    assert.equal(api.requests.length, 0);
  });

  test("exchange: no session URL configured fails without a request", async () => {
    await assert.rejects(exchangeIdTokenForSession({ idToken: FAKE_ID_TOKEN, url: "" }), /absolute URL/i);
  });

  // SECURITY: a 302 redirect turns the POST into a GET without a body: the ID token is not resent.
  // PINS SUSPECT BEHAVIOUR: but the redirect is followed to any host, and whatever session that host
  // answers with is accepted and would be stored.
  test("SECURITY: exchange redirected (302) to another host does not resend the ID token", async () => {
    const token = await exchangeIdTokenForSession({ idToken: FAKE_ID_TOKEN, url: `${api.origin}/redirect?status=302` });
    assert.equal(other.requests.length, 1);
    assert.equal(other.requests[0].method, "GET");
    assert.equal(other.requests[0].body, "");
    assert.equal(token, "id-FAKE-OTHER-test-only", "PINS SUSPECT BEHAVIOUR: the other host's session is accepted");
  });

  // PINS SUSPECT BEHAVIOUR: a 307/308 redirect is followed to any host and the body, with the ID
  // token in it, is posted there; the session that host returns is accepted.
  test("PINS SUSPECT BEHAVIOUR: exchange redirected (307) to another host posts the ID token there", async () => {
    const token = await exchangeIdTokenForSession({ idToken: FAKE_ID_TOKEN, url: `${api.origin}/redirect?status=307` });
    assert.equal(other.requests.length, 1);
    assert.equal(other.requests[0].method, "POST");
    assert.deepEqual(JSON.parse(other.requests[0].body), { id_token: FAKE_ID_TOKEN });
    assert.equal(token, "id-FAKE-OTHER-test-only");
  });
}

// ---- API calls with the stored session (src/utils.js graphQuery) ---------------------------------

describeGraph();
function describeGraph() {
  let sb, api, other, sameHost, tlsApi, cert;
  before(async () => {
    sb = makeSandbox();
    cert = makeCert(sb.root);
    const ok = (req, res) => json(res, 200, { data: { ok: true } });
    other = await startServer(ok, { host: "localhost" });
    sameHost = await startServer(ok);
    tlsApi = await startServer(ok, { tls: { key: cert.key, cert: cert.cert } });
    api = await startServer((req, res) => {
      const u = new URL(req.url, "http://x");
      const target = u.pathname === "/same-host" ? sameHost : other;
      const host = u.pathname === "/same-host" ? "127.0.0.1" : "localhost";
      res.writeHead(Number(u.searchParams.get("status")), { location: `http://${host}:${target.port}/graphql` });
      res.end();
    });
  });
  after(async () => {
    for (const s of [api, other, sameHost, tlsApi]) await s.close();
    sb.cleanup();
  });
  beforeEach(() => {
    for (const s of [api, other, sameHost, tlsApi]) s.requests.length = 0;
    sb.writeSession({ token: FAKE.session });
  });
  const graph = (graphqlUrl, env = {}) =>
    runDriver(sb, { fn: "graphQuery" }, { env: { ALOMA_GRAPHQL_URL: graphqlUrl, ALOMA_KEYCLOAK_REALM_URL: "http://127.0.0.1:1/x", ...env } });

  for (const status of [301, 302, 307, 308]) {
    // SECURITY: redirects to another host drop the Authorization header and the cookie.
    test(`SECURITY: API call redirected (${status}) to another host does not forward the session`, async () => {
      const r = await graph(`${api.origin}/graphql?status=${status}`);
      assert.equal(r.result.ok, true, r.output);
      assert.equal(other.requests.length, 1);
      assert.equal(other.requests[0].headers.authorization, undefined);
      assert.equal(other.requests[0].headers.cookie, undefined);
      assert.deepEqual(leakedSecrets(other.requests[0].url + other.requests[0].body), []);
    });
  }

  // PINS SUSPECT BEHAVIOUR: the same-host check ignores the port, so a redirect to another port
  // (another service) on the same host does get the session.
  test("PINS SUSPECT BEHAVIOUR: a redirect to another port on the same host forwards the session", async () => {
    const r = await graph(`${api.origin}/same-host?status=307`);
    assert.equal(r.result.ok, true, r.output);
    assert.equal(sameHost.requests[0].headers.authorization, `Bearer ${FAKE.session}`);
  });

  // SECURITY: TLS verification is on for API calls: an untrusted certificate is refused before the
  // session is sent; the same server is accepted once its certificate is trusted.
  test("SECURITY: an API host with an untrusted certificate is refused; trusted, it works", async () => {
    const url = `https://127.0.0.1:${tlsApi.port}/graphql`;
    const refused = await graph(url);
    assert.equal(refused.result.ok, false);
    assert.match(refused.result.error, /self[- ]signed certificate/);
    assert.equal(tlsApi.requests.length, 0);
    assert.deepEqual(leakedSecrets(refused.output), []);
    const accepted = await graph(url, { NODE_EXTRA_CA_CERTS: cert.certPath });
    assert.equal(accepted.result.ok, true, accepted.output);
    assert.equal(tlsApi.requests[0].headers.authorization, `Bearer ${FAKE.session}`);
  });

  // PINS SUSPECT BEHAVIOUR: plain http:// is accepted for the API, so the session can be sent
  // unencrypted if the configuration (or ALOMA_GRAPHQL_URL) says http.
  test("PINS SUSPECT BEHAVIOUR: an http:// API URL is used, sending the session unencrypted", async () => {
    const r = await graph(`http://127.0.0.1:${sameHost.port}/graphql`);
    assert.equal(r.result.ok, true, r.output);
    assert.equal(sameHost.requests[0].headers.authorization, `Bearer ${FAKE.session}`);
  });
}
