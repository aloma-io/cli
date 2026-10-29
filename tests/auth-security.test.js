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

// The in-process exchange tests talk to plain-http loopback mocks: allowed only with this opt-in,
// and only for loopback hosts (see the transport tests below).
process.env.ALOMA_ALLOW_HTTP_LOOPBACK = "1";

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

// The "another host" mocks below listen on "localhost". They must be reachable by the CLI's client (Node's fetch),
// or every "the redirect target is never contacted" check would pass without proving anything (PLAT-117).
test("harness: a mock on localhost is reachable by fetch (so 'never contacted' checks mean something)", async () => {
  const s = await startServer((req, res) => json(res, 200, {}), { host: "localhost" });
  try {
    assert.equal((await fetch(`${s.origin}/x`)).status, 200);
    assert.equal(s.requests.length, 1);
  } finally {
    await s.close();
  }
});

// Node 18's fetch tries ::1 for "localhost", Node 22's tries 127.0.0.1. The mock answers on both, so the check above
// holds on every supported Node (engines: >= 18). Skipped only where the machine has no IPv6 loopback.
test("harness: a localhost mock answers on 127.0.0.1 and on ::1", async (t) => {
  const s = await startServer((req, res) => json(res, 200, {}), { host: "localhost" });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/a`)).status, 200);
    try {
      assert.equal((await fetch(`http://[::1]:${s.port}/b`)).status, 200);
    } catch (e) {
      if (!Object.values(await import("node:os").then((o) => o.networkInterfaces())).flat().some((i) => i.address === "::1")) {
        return t.skip("no IPv6 loopback on this machine");
      }
      throw e;
    }
  } finally {
    await s.close();
  }
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

// SECURITY (PLAT-117): every request the CLI makes itself goes through src/http.js, which checks the URL and
// refuses redirects by construction. No other file calls fetch or an HTTP library (the sign-in library,
// openid-client, keeps its own stack; the sign-in callback only listens, through http.createServer).
test("SECURITY: only src/http.js sends HTTP requests; no file imports node-fetch or axios", () => {
  const HTTP_JS = path.join(REPO, "src", "http.js");
  const sends = /(?<![\w.])fetch\s*\(|globalThis\.fetch|\bhttps?\.(request|get)\s*\(|from\s+["'](node-fetch|axios|undici|got)["']|import\s*\(\s*["'](node-fetch|axios|undici|got)["']|require\s*\(\s*["'](node-fetch|axios|undici|got)["']/;
  const offenders = SRC.filter((f) => f !== HTTP_JS && sends.test(readFileSync(f, "utf8"))).map((f) => path.relative(REPO, f));
  assert.deepEqual(offenders, []);
  const http = readFileSync(HTTP_JS, "utf8");
  assert.match(http, /assertSecureUrl\(url/, "http.js checks every URL");
  assert.match(http, /redirect: "manual"/, "http.js never lets fetch follow a redirect");
  assert.match(http, /refuseRedirect\(response\.status/, "http.js refuses every 3xx");
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

  // SECURITY (was PINS SUSPECT BEHAVIOUR: a 307/308 redirect was followed to any host with the ID
  // token in the body, and a 302 redirect target's session was accepted). Redirects are refused.
  for (const status of [301, 302, 303, 307, 308]) {
    test(`SECURITY: exchange answered with a redirect (${status}) is refused; nothing is sent elsewhere`, async () => {
      await assert.rejects(
        exchangeIdTokenForSession({ idToken: FAKE_ID_TOKEN, url: `${api.origin}/redirect?status=${status}` }),
        /redirect/i,
      );
      assert.equal(other.requests.length, 0, "the redirect target is never contacted");
    });
  }

  test("SECURITY: the error for a refused redirect does not echo the ID token or the target", async () => {
    const err = await exchangeIdTokenForSession({ idToken: FAKE_ID_TOKEN, url: `${api.origin}/redirect?status=307` }).catch((e) => e);
    assert.ok(!err.message.includes(FAKE_ID_TOKEN));
    assert.ok(!err.message.includes(String(other.port)));
  });

  test("SECURITY: the exchange refuses a plain-http session URL that is not loopback", async () => {
    await assert.rejects(
      exchangeIdTokenForSession({ idToken: FAKE_ID_TOKEN, url: "http://api.example.test/oauth2/cli/session" }),
      /https/,
    );
  });

  test("SECURITY: without the loopback opt-in even a loopback http session URL is refused", async () => {
    delete process.env.ALOMA_ALLOW_HTTP_LOOPBACK;
    try {
      await assert.rejects(exchangeIdTokenForSession({ idToken: FAKE_ID_TOKEN, url: `${api.origin}/oauth2/cli/session` }), /https/);
      assert.equal(api.requests.length, 0);
    } finally {
      process.env.ALOMA_ALLOW_HTTP_LOOPBACK = "1";
    }
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

  // SECURITY: an API call answered with a redirect is refused; the session goes nowhere else.
  for (const status of [301, 302, 307, 308]) {
    test(`SECURITY: API call redirected (${status}) to another host is refused, session not forwarded`, async () => {
      const r = await graph(`${api.origin}/graphql?status=${status}`);
      assert.equal(r.result.ok, false);
      assert.match(r.result.error, /redirect/i);
      assert.equal(other.requests.length, 0);
      assert.deepEqual(leakedSecrets(r.output), []);
    });
  }

  // SECURITY (was PINS SUSPECT BEHAVIOUR: the same-host check ignored the port, so a redirect to
  // another port on the same host got the session). No redirect is followed, whatever the origin.
  test("SECURITY: a redirect to another port on the same host does not forward the session", async () => {
    const r = await graph(`${api.origin}/same-host?status=307`);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /redirect/i);
    assert.equal(sameHost.requests.length, 0);
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

  // SECURITY (was PINS SUSPECT BEHAVIOUR: plain http:// was accepted for the API, so the session
  // could be sent unencrypted). http is refused before anything is sent.
  test("SECURITY: an http:// API URL is refused before the session is sent", async () => {
    const r = await graph(`http://127.0.0.1:${sameHost.port}/graphql`, { ALOMA_ALLOW_HTTP_LOOPBACK: undefined });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /https/);
    assert.equal(sameHost.requests.length, 0);
    assert.deepEqual(leakedSecrets(r.output), []);
  });

  test("SECURITY: the loopback opt-in never allows http to another host", async () => {
    const r = await graph("http://api.example.test/graphql");
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /https/);
    assert.doesNotMatch(r.output, /test network guard/, "refused by the CLI, before any lookup");
  });

  test("the loopback opt-in allows a plain-http loopback API (local development only)", async () => {
    const r = await graph(`http://127.0.0.1:${sameHost.port}/graphql`);
    assert.equal(r.result.ok, true, r.output);
    assert.equal(sameHost.requests[0].headers.authorization, `Bearer ${FAKE.session}`);
  });
}
