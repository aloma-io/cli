// PLAT-10: how the CLI handles the session token and workspace secrets, end to end through the real CLI: the
// file modes on every path that writes the session, no token in any output (also with DEBUG and when a request
// fails), the token only ever sent to the configured API host, logout leaving no copy behind, secret values
// never echoed. Fills the gaps next to auth-storage, auth-security, auth-company, auth-logout and the secret
// tests in commands-webhook-secret (not repeated here). Every host is a loopback mock; anything else is
// recorded and failed by a preload, never sent.
// `// SECURITY:` marks a check on a protection the CLI provides; `// PINS BEHAVIOUR:` records current behaviour as it is.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { makeSandbox, makeCert, runCli, runDriver, startServer, freePort, json, FAKE, leakedSecrets } from "./helpers/sandbox.js";
import { startMockIdp, startMockApi } from "./helpers/mock-idp.js";
import { sandboxTest, gqlError } from "./helpers/cli-harness.js";

const RECORDER = pathToFileURL(path.join(import.meta.dirname, "helpers", "record-offhost-fetch.mjs")).href;
const mode = (p) => statSync(p).mode & 0o777;

let cert, certSb, sb, api, idp, realm;

before(() => {
  certSb = makeSandbox();
  cert = makeCert(certSb.root);
});
after(() => certSb.cleanup());

beforeEach(async () => {
  idp = await startMockIdp();
  api = await startMockApi();
  realm = await startServer(
    (req, res) => json(res, 200, {}, { "set-cookie": [`Authorization=Bearer%20${FAKE.switchedSession}; Path=/`] }),
    { tls: { key: cert.key, cert: cert.cert } },
  );
});
afterEach(async () => {
  for (const s of [idp, api, realm]) await s.close();
  sb?.cleanup();
  sb = undefined;
});

const sandbox = (config = {}) =>
  (sb = makeSandbox({
    config: {
      keycloakRealmUrl: idp.issuer,
      clientId: "graph-cli",
      graphqlUrl: api.graphqlUrl,
      graphqlHost: `127.0.0.1:${realm.port}`,
      jwksUrl: `${idp.issuer}/protocol/openid-connect/certs`,
      ...config,
    },
  }));
const cli = (args, { env = {}, ...opts } = {}) =>
  runCli(sb, args, { ...opts, env: { NODE_EXTRA_CA_CERTS: cert.certPath, ...env } });
const offHost = () => {
  const log = path.join(sb.root, "offhost.log");
  return {
    env: { NODE_OPTIONS: `--import ${RECORDER}`, TEST_OFFHOST_LOG: log },
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []),
  };
};
// Every file under `dir` whose content holds `secret`.
const filesHolding = (dir, secret) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name))
    .filter((f) => readFileSync(f, "utf8").includes(secret));

// ---- file modes: every path that writes the session ---------------------------------------------

// SECURITY: the modes are set explicitly, not left to the umask: under umask 000 a new session file is still
// 0600 and every folder the CLI creates for it is 0700.
test("SECURITY: under umask 000 a new session file is 0600 and the folders created for it 0700", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aloma-umask-test-"));
  const xdg = path.join(root, "xdg");
  const saved = { xdg: process.env.XDG_CONFIG_HOME, umask: process.umask(0) };
  process.env.XDG_CONFIG_HOME = xdg;
  try {
    const { updateSessionData } = await import("../src/utils.js");
    await updateSessionData("token", FAKE.session);
    assert.equal(mode(path.join(xdg, "aloma", "session.json")), 0o600);
    assert.equal(mode(path.join(xdg, "aloma")), 0o700);
    assert.equal(mode(xdg), 0o700, "a parent created on the way is owner-only too");
  } finally {
    process.umask(saved.umask);
    if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.xdg;
    rmSync(root, { recursive: true, force: true });
  }
});

// SECURITY: each command that writes the session (sign-in, company switch, workspace switch) leaves it 0600 in a
// 0700 folder, also when it found them open to everyone (0666 / 0777).
const writers = [
  ["sign-in (aloma auth)", async () => {
    const port = await freePort();
    sandbox({ redirectUri: `http://localhost:${port}` });
    return () => cli(["auth"], { onOpen: async (u) => (await fetch(idp.authorize(u))).status });
  }, FAKE.session],
  ["company switch", async () => (sandbox(), () => cli(["company", "switch", "realm-b"])), FAKE.switchedSession],
  ["workspace switch", async () => (sandbox(), () => cli(["workspace", "switch", "ws-fake-1"])), FAKE.session],
];
for (const [label, setup, token] of writers) {
  test(`SECURITY: ${label} leaves the session 0600 in a 0700 folder, even if it was world-writable`, async () => {
    const run = await setup();
    sb.writeSession({ token: label.startsWith("sign-in") ? "id-FAKE-OLD-test-only" : FAKE.session });
    chmodSync(sb.sessionPath, 0o666);
    chmodSync(sb.configDir, 0o777);
    const r = await run();
    assert.equal(r.code, 0, r.output);
    assert.equal(sb.readSession().token, token, "the command did write the session");
    assert.equal(mode(sb.sessionPath), 0o600);
    assert.equal(mode(sb.configDir), 0o700);
    assert.deepEqual(leakedSecrets(r.output), []);
  });
}

// ---- never printed: debug output and failed requests ---------------------------------------------

// SECURITY: with DEBUG=1 (the CLI's only verbose switch: it adds the stack) and Node's own fetch/http debug on,
// no failure mode prints the session: connection refused, 500 with a text body, a GraphQL error, a redirect.
const failures = [
  ["connection refused", () => ({ graphqlUrl: "http://127.0.0.1:1/graphql" })],
  ["HTTP 500 with a text body", () => ((api.ctl.graphql = () => ({ __raw: true, status: 500, body: "Internal error" })), {})],
  ["a GraphQL error", () => ((api.ctl.graphql = () => ({ errors: [{ message: "Unauthorized" }] })), {})],
  ["a redirect", () => ((api.ctl.graphql = () => ({ __raw: true, status: 307, headers: { location: `${idp.origin}/graphql` }, body: "" })), {})],
];
for (const [label, arrange] of failures) {
  test(`SECURITY: ${label}: the session is not in stdout, stderr or the DEBUG stack`, async () => {
    sandbox(arrange());
    sb.writeSession({ token: FAKE.session });
    const r = await cli(["workspace", "list"], { env: { DEBUG: "1", NODE_DEBUG: "fetch,http,net,tls" } });
    assert.equal(r.code, 1, r.output);
    assert.match(r.stderr, /\n\s+at /, "DEBUG printed the stack");
    assert.deepEqual(leakedSecrets(r.output), []);
    assert.equal(idp.requests.filter((q) => q.url === "/graphql").length, 0, "redirect not followed");
  });
}

test("SECURITY: a failed company switch (DEBUG on) does not print the old or the new session", async () => {
  sandbox();
  sb.writeSession({ token: FAKE.session });
  const r = await cli(["company", "switch", "realm-b"], { env: { DEBUG: "1", NODE_EXTRA_CA_CERTS: undefined } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /self[- ]signed certificate/);
  assert.deepEqual(leakedSecrets(r.output), []);
});

// ---- host-bound ----------------------------------------------------------------------------------

// SECURITY: URLs the API puts in an answer (pagination links, `next`, a Link or Location header on a 200) are
// never requested: the CLI only calls the configured endpoints.
test("SECURITY: URLs in an API answer are not followed, so the session goes nowhere else", async () => {
  const other = await startServer((req, res) => json(res, 200, { data: {} }), { host: "localhost" });
  try {
    const elsewhere = `http://localhost:${other.port}/graphql`;
    api.ctl.graphql = () => ({
      __raw: true,
      status: 200,
      headers: { "content-type": "application/json", link: `<${elsewhere}?page=2>; rel="next"`, location: elsewhere },
      body: JSON.stringify({
        data: { listAutomationEnvironmentWithStats: [{ id: "ws-1", name: "One", url: elsewhere }] },
        next: elsewhere,
        links: { next: elsewhere, self: elsewhere },
        extensions: { nextPage: elsewhere },
      }),
    });
    sandbox();
    sb.writeSession({ token: FAKE.session });
    const r = await cli(["workspace", "list"]);
    assert.equal(r.code, 0, r.output);
    assert.equal(other.requests.length, 0);
    assert.ok(api.requests.every((q) => q.url === "/graphql"));
  } finally {
    await other.close();
  }
});

// SECURITY: plain http in the configuration file (not only in ALOMA_GRAPHQL_URL) is refused before anything is
// sent or even looked up. Refused, not warned about.
test("SECURITY: graphqlUrl http:// in config.json is refused before any lookup; the session is not sent", async () => {
  sandbox({ graphqlUrl: "http://api.example.test/graphql" });
  sb.writeSession({ token: FAKE.session });
  const rec = offHost();
  const r = await cli(["workspace", "list"], { env: rec.env });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Refusing to send credentials to http:\/\/api\.example\.test: the API URL must use https/);
  assert.deepEqual(rec.calls(), []);
  assert.deepEqual(leakedSecrets(r.output), []);
});

// Company switch builds its URL as `https://${graphqlHost}/realm` and does not check graphqlHost
// (src/commands/company/index.js:174). Missing, it becomes the host "realm"; given as a URL
// ("http://..."), the host "http". The session goes to that host.
for (const [label, graphqlHost, host] of [["missing", "", "realm"], ["given as an http:// URL", "http://api.example.test", "http"]]) {
  test(`graphqlHost ${label}: company switch sends the session to the host "${host}"`, async () => {
    sandbox({ graphqlHost });
    sb.writeSession({ token: FAKE.session });
    const rec = offHost();
    const r = await cli(["company", "switch", "realm-b"], { env: rec.env });
    assert.equal(r.code, 1);
    const calls = rec.calls();
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).hostname, host);
    assert.equal(calls[0].authorization, `Bearer ${FAKE.session}`);
    assert.doesNotMatch(r.output, /must use https|graphqlHost/, "not refused, not warned about");
    assert.deepEqual(leakedSecrets(r.output), []);
  });
}

// ---- logout ----------------------------------------------------------------------------------------

// SECURITY: after logout no file anywhere in the sandbox (HOME, the config folder, the project) still holds the
// session, and the next API command sends no credential: it is refused locally.
test("SECURITY: logout leaves no copy of the session and the next command sends none", async () => {
  sandbox();
  sb.writeSession({ token: FAKE.session, selectedWorkspace: "ws-1" });
  assert.equal(filesHolding(sb.root, FAKE.session).length, 1);
  const out = await cli(["logout"]);
  assert.equal(out.code, 0, out.output);
  assert.deepEqual(filesHolding(sb.root, FAKE.session), []);
  assert.equal(existsSync(sb.sessionPath), false);
  const r = await cli(["workspace", "list"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Not authenticated/);
  assert.equal(api.requests.length, 0);
  const after = await runDriver(sb, { fn: "getSessionData", prop: "token" });
  assert.equal(after.result.value, null);
});

// ---- workspace secrets ---------------------------------------------------------------------------

const VALUE = "FAKE-SECRET-VALUE-7777-test-only";

// SECURITY: `secret add` never echoes the value, on success or when the save fails (DEBUG on).
test("SECURITY: secret add does not print the value, also when the save fails", sandboxTest(async (h) => {
  h.api.on("GET_SECRET_QUERY", { getAutomationEnvironmentConfig: {} });
  h.api.on("SAVE_SECRET_MUTATION", { saveAutomationEnvironmentConfig: true });
  let r = await h.run(["secret", "add", "API_KEY", VALUE]);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.stdout, '✅ Secret "API_KEY" added successfully\n');
  h.api.on("SAVE_SECRET_MUTATION", gqlError("save refused"));
  r = await h.run(["secret", "add", "API_KEY", VALUE], { env: { DEBUG: "1" } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error adding secret: save refused/);
  assert.doesNotMatch(r.out, new RegExp(VALUE));
}));

// The value can only be given as a command-line argument (src/cli.js:651); there is no stdin or
// file option.
test("add takes the value on the command line only", sandboxTest(async (h) => {
  const r = await h.run(["secret", "add", "API_KEY"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /missing required argument 'value'/);
  assert.deepEqual(h.api.calls, []);
  const help = await h.run(["secret", "add", "--help"]);
  assert.doesNotMatch(help.stdout, /stdin|--value-file|--from-file/);
}));
