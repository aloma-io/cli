// The one HTTP client (src/http.js, PLAT-117): https only, never follows a redirect, and attaches the session
// itself, to the request's own URL only. In-process against loopback mocks (plain http needs the opt-in).
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { startServer, makeSandbox, makeCert, json } from "./helpers/sandbox.js";
import { request, postJson, graphql } from "../src/http.js";

process.env.ALOMA_ALLOW_HTTP_LOOPBACK = "1";

const TOKEN = "id-FAKE-HTTP-TOKEN-6666-test-only";
let api, other, sameHost, tlsApi, certSb;

before(async () => {
  certSb = makeSandbox();
  const cert = makeCert(certSb.root);
  other = await startServer((req, res) => json(res, 200, { data: { other: true } }), { host: "localhost" });
  sameHost = await startServer((req, res) => json(res, 200, { data: { other: true } }));
  tlsApi = await startServer((req, res) => json(res, 200, {}), { tls: { key: cert.key, cert: cert.cert } });
  api = await startServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/redirect") {
      const target = u.searchParams.get("to") === "same-host" ? `http://127.0.0.1:${sameHost.port}` : `http://localhost:${other.port}`;
      res.writeHead(Number(u.searchParams.get("status")), { location: `${target}/graphql` });
      return res.end();
    }
    if (u.pathname === "/errors") return json(res, 200, { errors: [{ message: "first" }, { message: "second" }] });
    return json(res, 200, { data: { ok: true } }, { "set-cookie": ["A=1; Path=/", "B=2; Path=/"] });
  });
});
after(async () => {
  for (const s of [api, other, sameHost, tlsApi]) await s.close();
  certSb.cleanup();
});
beforeEach(() => {
  for (const s of [api, other, sameHost, tlsApi]) s.requests.length = 0;
});

// ---- https only -------------------------------------------------------------------------------------

test("SECURITY: http.js refuses an http:// URL before any request is sent", async () => {
  delete process.env.ALOMA_ALLOW_HTTP_LOOPBACK;
  try {
    await assert.rejects(postJson(`${api.origin}/graphql`, {}, { auth: TOKEN }), /must use https/);
    await assert.rejects(request(`${api.origin}/graphql`), /must use https/);
    await assert.rejects(graphql("query { a }", {}, { auth: TOKEN, url: `${api.origin}/graphql` }), /must use https/);
    assert.equal(api.requests.length, 0);
  } finally {
    process.env.ALOMA_ALLOW_HTTP_LOOPBACK = "1";
  }
});

test("SECURITY: http.js refuses non-loopback http even with the opt-in, before any lookup", async () => {
  const err = await postJson("http://api.example.test/graphql", {}, { auth: TOKEN }).catch((e) => e);
  assert.match(err.message, /must use https/);
  assert.doesNotMatch(err.message, /test network guard/);
});

test("http.js refuses a URL that is not absolute", async () => {
  await assert.rejects(request(""), /absolute URL/);
});

test("SECURITY: TLS stays verified: an untrusted certificate is refused with its reason, nothing sent", async () => {
  await assert.rejects(postJson(`https://127.0.0.1:${tlsApi.port}/x`, {}, { auth: TOKEN }), /self[- ]signed certificate/);
  assert.equal(tlsApi.requests.length, 0);
});

// ---- redirects: refused, never followed --------------------------------------------------------------

for (const status of [301, 302, 303, 307, 308]) {
  test(`SECURITY: http.js refuses a ${status} redirect and does not follow it`, async () => {
    await assert.rejects(postJson(`${api.origin}/redirect?status=${status}`, { a: 1 }, { auth: TOKEN }), /redirect \(\d{3}\)/);
    await assert.rejects(request(`${api.origin}/redirect?status=${status}`), /redirect \(\d{3}\)/);
    assert.equal(api.requests.length, 2);
    assert.equal(other.requests.length, 0, "the redirect target is never contacted");
  });
}

// ---- auth: attached here, to the request's own host only ---------------------------------------------

test("SECURITY: auth goes as bearer header and cookie, only to the request's own host", async () => {
  const res = await postJson(`${api.origin}/graphql`, { a: 1 }, { auth: TOKEN });
  assert.equal(res.status, 200);
  const q = api.requests[0];
  assert.equal(q.method, "POST");
  assert.equal(q.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(q.headers.cookie, `Authorization=Bearer%20${encodeURIComponent(TOKEN)}`);
  assert.equal(q.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(q.body), { a: 1 });
  assert.ok(!q.url.includes(TOKEN));
});

for (const to of ["other-host", "same-host"]) {
  test(`SECURITY: auth is never attached to a redirect target (${to})`, async () => {
    await postJson(`${api.origin}/redirect?status=307&to=${to}`, {}, { auth: TOKEN }).catch(() => {});
    await graphql("query { a }", {}, { auth: TOKEN, url: `${api.origin}/redirect?status=308&to=${to}` }).catch(() => {});
    const reached = [...other.requests, ...sameHost.requests];
    assert.deepEqual(reached.map((r) => r.headers.authorization ?? r.headers.cookie ?? "no auth"), []);
  });
}

test("without auth, no Authorization header or cookie is sent", async () => {
  await request(`${api.origin}/graphql`, { headers: { "User-Agent": "Aloma CLI" } });
  const q = api.requests[0];
  assert.equal(q.method, "GET");
  assert.equal(q.headers.authorization, undefined);
  assert.equal(q.headers.cookie, undefined);
  assert.equal(q.headers["user-agent"], "Aloma CLI");
});

test("the response's cookies are readable one by one (getSetCookie)", async () => {
  const res = await postJson(`${api.origin}/realm`, {}, { auth: TOKEN });
  assert.deepEqual(res.headers.getSetCookie(), ["A=1; Path=/", "B=2; Path=/"]);
});

// ---- graphql ------------------------------------------------------------------------------------------

test("graphql: posts query and variables with auth, returns data, joins GraphQL errors", async () => {
  assert.deepEqual(await graphql("query { a }", { v: 1 }, { auth: TOKEN, url: `${api.origin}/graphql` }), { ok: true });
  assert.deepEqual(JSON.parse(api.requests[0].body), { query: "query { a }", variables: { v: 1 } });
  assert.equal(api.requests[0].headers.authorization, `Bearer ${TOKEN}`);
  await assert.rejects(graphql("query { a }", {}, { auth: TOKEN, url: `${api.origin}/errors` }), /first\nsecond/);
});
