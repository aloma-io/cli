// Every request the CLI's HTTP client sends names the CLI and its version (src/http.js):
// "X-Aloma-Client: aloma-cli/<version>", and the same value as User-Agent. The version is the one in package.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { startServer, json, FAKE } from "./helpers/sandbox.js";
import { request, postJson, graphql } from "../src/http.js";
import { exchangeIdTokenForSession } from "../src/commands/auth/session.js";

process.env.ALOMA_ALLOW_HTTP_LOOPBACK = "1";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const CLIENT = `aloma-cli/${version}`;
let api;

before(async () => {
  api = await startServer((req, res) => {
    if (req.url === "/oauth2/cli/session") return json(res, 200, { token: FAKE.session });
    return json(res, 200, { data: { ok: true } });
  });
});
after(() => api.close());
beforeEach(() => {
  api.requests.length = 0;
});

const seen = () => {
  assert.equal(api.requests.length, 1);
  return api.requests[0].headers;
};

test("the client name and version come from package.json", () => {
  assert.match(version, /^\d+\.\d+\.\d+/);
  assert.equal(CLIENT, `aloma-cli/${version}`);
});

test("a GraphQL call carries X-Aloma-Client and the same User-Agent", async () => {
  await graphql("query { a }", {}, { auth: "id-FAKE-token", url: `${api.origin}/graphql` });
  const h = seen();
  assert.equal(h["x-aloma-client"], CLIENT);
  assert.equal(h["user-agent"], CLIENT);
});

test("a REST call carries X-Aloma-Client and the same User-Agent", async () => {
  await postJson(`${api.origin}/realm?realm=r1`, {}, { auth: "id-FAKE-token" });
  const h = seen();
  assert.equal(h["x-aloma-client"], CLIENT);
  assert.equal(h["user-agent"], CLIENT);
});

test("a plain GET without a session carries them too", async () => {
  await request(`${api.origin}/anything`);
  const h = seen();
  assert.equal(h["x-aloma-client"], CLIENT);
  assert.equal(h["user-agent"], CLIENT);
  assert.equal(h.authorization, undefined);
});

test("the sign-in call carries X-Aloma-Client and the same User-Agent", async () => {
  await exchangeIdTokenForSession({ idToken: "FAKE.id.token", url: `${api.origin}/oauth2/cli/session` });
  const h = seen();
  assert.equal(h["x-aloma-client"], CLIENT);
  assert.equal(h["user-agent"], CLIENT);
});

test("a header of the same name passed by a caller does not replace them, in any letter case", async () => {
  await request(`${api.origin}/anything`, { headers: { "user-agent": "other", "x-aloma-client": "other" } });
  const h = seen();
  assert.equal(h["x-aloma-client"], CLIENT);
  assert.equal(h["user-agent"], CLIENT);
});
