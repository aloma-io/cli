// Characterisation tests for the command-line shell itself (src/cli.js, src/utils.js graphQuery):
// help/version/unknown commands, the request every command sends, and shared error handling.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandboxTest, rawReply, FAKE_TOKEN, REPO } from "./helpers/cli-harness.js";

const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));

test("--version prints the package version", sandboxTest(async (sb) => {
  const r = await sb.run(["--version"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `${pkg.version}\n`);
}));

test("--help lists every command group covered by these tests", sandboxTest(async (sb) => {
  const r = await sb.run(["--help"]);
  assert.equal(r.code, 0);
  for (const group of ["workspace", "company", "step", "library", "task", "webhook", "secret", "connector", "user", "deploy"]) {
    assert.match(r.stdout, new RegExp(`^ {2}${group}\\b`, "m"), group);
  }
  assert.match(r.stdout, /Usage: aloma \[options\] \[command\]/);
}));

test("each group's help lists its sub-commands", sandboxTest(async (sb) => {
  const expected = {
    workspace: ["list", "show", "switch", "add", "delete", "archive", "update", "source", "sync"],
    company: ["list", "switch", "add"],
    step: ["list", "show", "add", "delete", "edit", "clone", "pull", "sync", "generate"],
    library: ["list", "show", "add", "update", "delete", "pull", "sync"],
    task: ["list", "log", "new", "clone", "stop", "resume"],
    webhook: ["list", "show", "add", "delete"],
    secret: ["list", "add", "delete"],
    connector: ["list", "list-available", "show", "add", "delete", "update", "logs", "oauth"],
    user: ["list", "invite", "update", "remove"],
  };
  for (const [group, subs] of Object.entries(expected)) {
    const r = await sb.run([group, "--help"]);
    assert.equal(r.code, 0, group);
    const listed = [...r.stdout.matchAll(/^ {2}([a-z-]+)(?: |$)/gm)].map((m) => m[1]).filter((n) => n !== "help");
    assert.deepEqual(listed.sort(), [...subs].sort(), group);
  }
  assert.deepEqual(sb.api.calls, []);
}));

test("unknown command and unknown option exit 2 with a suggestion", sandboxTest(async (sb) => {
  let r = await sb.run(["wrokspace"]);
  // PLAT-81: usage errors exit 2 (was 1, commander's default).
  assert.equal(r.code, 2);
  assert.match(r.stderr, /error: unknown command 'wrokspace'\n\(Did you mean workspace\?\)/);
  r = await sb.run(["workspace", "list", "--nope"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /error: unknown option '--nope'/);
  assert.deepEqual(sb.api.calls, []);
}));

test("every request is a POST with JSON body, bearer header and cookie", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [] });
  await sb.run(["workspace", "list"]);
  const call = sb.api.calls[0];
  assert.equal(call.method, "POST");
  assert.equal(call.url, "/graphql");
  assert.equal(call.headers["content-type"], "application/json");
  assert.equal(call.headers.authorization, `Bearer ${FAKE_TOKEN}`);
  assert.equal(call.headers.cookie, `Authorization=Bearer%20${encodeURIComponent(FAKE_TOKEN)}`);
}));

test("not signed in: commands report the missing token instead of sending a request", sandboxTest({ session: null }, async (sb) => {
  const r = await sb.run(["workspace", "list"]);
  // PLAT-81: exit code 1 (was PINS SUSPECT BEHAVIOUR: exit code 0 although nothing worked).
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    "Error fetching environments: Not authenticated: No token found. Run `aloma auth` to login.\n",
  );
  assert.deepEqual(sb.api.calls, []);
}));

test("not signed in with -w: a warning is printed first, then the command fails the same way", sandboxTest({ session: null }, async (sb) => {
  const r = await sb.run(["secret", "list", "-w", "dev"]);
  assert.equal(r.code, 1); // PLAT-81: was 0
  assert.match(r.stdout, /^⚠ Not authenticated: No token found\. Run `aloma auth` to login\.\n/);
  assert.match(r.stderr, /Error fetching secrets: Not authenticated/);
  assert.deepEqual(sb.api.calls, []);
}));

test("server answers with something that is not JSON", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", rawReply(502, "<html>Bad Gateway</html>"));
  const r = await sb.run(["workspace", "list"]);
  assert.equal(r.code, 1); // PLAT-81: was 0
  // PLAT-81: printed once, by the command (graphQuery no longer prints its own "GraphQL Error:" line).
  assert.doesNotMatch(r.stderr, /GraphQL Error/);
  assert.match(r.stderr, /Error fetching environments: invalid json response body/);
}));

test("server answers with an HTTP error but a JSON body: the status is ignored", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", rawReply(500, JSON.stringify({ data: { listAutomationEnvironmentWithStats: [{ id: "ws-1", name: "Dev" }] } })));
  const r = await sb.run(["workspace", "list"]);
  // PINS SUSPECT BEHAVIOUR: response.ok is never checked.
  assert.match(r.stdout, /Dev \(ID:ws-1\)/);
}));

test("server answers with data: null and no errors", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", rawReply(200, JSON.stringify({ data: null })));
  const r = await sb.run(["workspace", "list"]);
  assert.match(r.stderr, /Error fetching environments: Cannot read properties of null/);
}));

test("API unreachable: the connection error is printed", sandboxTest(async (sb) => {
  await sb.api.close();
  const r = await sb.run(["workspace", "list"]);
  assert.equal(r.code, 1); // PLAT-81: a network error exits 1 (was 0)
  // PLAT-81: printed once, with the command's label (was a "GraphQL Error:" line, then the label line).
  assert.match(r.stderr, /^Error fetching environments: request to http:\/\/127\.0\.0\.1:\d+\/graphql failed, reason: .*ECONNREFUSED/);
  assert.doesNotMatch(r.stderr, /GraphQL Error/);
  sb.api.close = async () => {}; // already closed
}));
