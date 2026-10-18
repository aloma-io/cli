// Sign-in: the CLI hands the ID token it received from the login service to the API, which returns
// the session the CLI stores. Run with: node --test tests/
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import {
  exchangeIdTokenForSession,
  sessionUrlFor,
} from "../src/commands/auth/session.js";

let server;
let base;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, body, type: req.headers["content-type"] });
      const { id_token: idToken } = JSON.parse(body || "{}");
      if (idToken === "good") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ token: "id-session" }));
      }
      if (idToken === "odd") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ token: "not-a-session" }));
      }
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: 401 }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

test("the session URL sits next to the GraphQL endpoint", () => {
  assert.equal(
    sessionUrlFor("https://graph.aloma.io/graphql"),
    "https://graph.aloma.io/oauth2/cli/session",
  );
  assert.equal(
    sessionUrlFor("http://localhost:4000/graphql"),
    "http://localhost:4000/oauth2/cli/session",
  );
});

test("posts the ID token as JSON and returns the session the API issued", async () => {
  const token = await exchangeIdTokenForSession({
    idToken: "good",
    url: base + "/oauth2/cli/session",
  });
  assert.equal(token, "id-session");
  const last = seen.at(-1);
  assert.equal(last.method, "POST");
  assert.equal(last.url, "/oauth2/cli/session");
  assert.match(last.type, /application\/json/);
  assert.deepEqual(JSON.parse(last.body), { id_token: "good" });
});

test("a refused sign-in fails without echoing the token", async () => {
  await assert.rejects(
    exchangeIdTokenForSession({ idToken: "secret-value", url: base + "/oauth2/cli/session" }),
    (e) => /sign-in was not accepted \(401\)/.test(e.message) && !e.message.includes("secret-value"),
  );
});

test("an answer that is not a session is refused", async () => {
  await assert.rejects(
    exchangeIdTokenForSession({ idToken: "odd", url: base + "/oauth2/cli/session" }),
    /no session/,
  );
});

test("a missing ID token is refused before any request", async () => {
  const before = seen.length;
  await assert.rejects(exchangeIdTokenForSession({ idToken: "", url: base }), /ID token/);
  assert.equal(seen.length, before);
});
