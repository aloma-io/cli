// Regression tests for the untested branches of `aloma connector ...` (src/commands/connector).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sandboxTest } from "./helpers/cli-harness.js";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FETCH_PRELOAD = pathToFileURL(path.join(HERE, "helpers", "preload-fetch.mjs")).href;
const OPEN_PRELOAD = pathToFileURL(path.join(HERE, "helpers", "child-preload.mjs")).href;

const detail = (health) => ({
  getAutomationConnector: { id: "c-1", name: "Mailer", namespace: "mail", shared_in_realm: false, health },
  getAutomationConnectorConfigSchema: { summary: "", description: "", fields: {} },
});
const LIST = { listAutomationConnectors: [{ id: "c-1", marketId: "m-1", name: "Mailer", namespace: "mail", shared_in_realm: false, health: [] }] };

// ---------------------------------------------------------------- empty ID guards
for (const args of [["add"], ["update"], ["logs"], ["oauth"]]) {
  test(`connector ${args[0]}: an empty ID is a usage error (exit 2) and sends no request`, sandboxTest(async (sb) => {
    const r = await sb.run(["connector", ...args, ""]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Connector ID is required/);
    assert.deepEqual(sb.api.calls, []);
  }));
}

// ---------------------------------------------------------------- health line of `connector show`
const HEALTH_CASES = [
  ["first entry healthy", [{ healthy: true }], "Healthy"],
  ["first entry healthy, later entries not", [{ healthy: true }, { healthy: false }], "Healthy"],
  ["first entry not healthy, later entry healthy", [{ healthy: false }, { healthy: true }], "Unhealthy"],
  ["first entry without a healthy flag", [{}], "Unhealthy"],
  ["health missing", undefined, "Unhealthy"],
  ["health null", null, "Unhealthy"],
  ["health not an array", { healthy: true }, "Unhealthy"],
  ["health empty", [], "Unhealthy"],
];
for (const [label, health, expected] of HEALTH_CASES) {
  test(`connector show: ${label} prints ${expected}`, sandboxTest(async (sb) => {
    sb.api.on("GET_CONNECTOR_QUERY", detail(health));
    const r = await sb.run(["connector", "show", "c-1"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`^Health: ${expected}$`, "m"));
  }));
}

// ---------------------------------------------------------------- oauth: browser cannot be opened
test("connector oauth: when the browser cannot be opened the URL is printed for manual use, exit 0", sandboxTest(async (sb) => {
  const url = "https://auth.example.invalid/authorize?x=1";
  sb.api.on("START_CONNECTOR_OAUTH_MUTATION", { startAutomationConnectorOAuth: url });
  const r = await sb.run(["connector", "oauth", "c-1"], {
    env: {
      NODE_OPTIONS: `--import ${FETCH_PRELOAD} --import ${OPEN_PRELOAD}`,
      ALOMA_TEST_OPEN_LOG: sb.openLog,
      ALOMA_TEST_OPEN_FAILS: "1",
    },
  });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Could not open browser automatically\. Please open this URL manually:/);
  assert.ok(r.stdout.split("\n").includes(url), "the full URL is on its own line");
  assert.deepEqual(sb.openCalls(), [url]);
}));

// ---------------------------------------------------------------- update --file
const updateWith = async (sb, file, content, extra = []) => {
  sb.api.on("LIST_CONNECTORS_QUERY", LIST);
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
  sb.write(file, content);
  return sb.run(["connector", "update", "c-1", "-f", file, ...extra]);
};
const updateCall = (sb) => sb.api.calls.find((c) => c.op === "UPDATE_CONNECTOR_MUTATION");

for (const file of ["c.yaml", "c.yml", "c.YAML"]) {
  test(`connector update --file ${file}: read as YAML`, sandboxTest(async (sb) => {
    const r = await updateWith(sb, file, "name: YamlName\nnamespace: ynz\n");
    assert.equal(r.code, 0);
    assert.equal(updateCall(sb).variables.name, "YamlName");
    assert.equal(updateCall(sb).variables.namespace, "ynz");
  }));
}

test("connector update --file: any other extension is read as JSON (YAML-only text is refused)", sandboxTest(async (sb) => {
  let r = await updateWith(sb, "c.json", JSON.stringify({ name: "JsonName" }));
  assert.equal(r.code, 0);
  assert.equal(updateCall(sb).variables.name, "JsonName");
  r = await updateWith(sb, "c.txt", JSON.stringify({ name: "TxtName" }));
  assert.equal(r.code, 0);
  assert.equal(sb.api.calls.filter((c) => c.op === "UPDATE_CONNECTOR_MUTATION").at(-1).variables.name, "TxtName");
  const before = sb.api.calls.length;
  r = await updateWith(sb, "c.data", "name: YamlStyle\n");
  assert.equal(r.code, 1);
  assert.equal(sb.api.calls.length, before);
}));

test("connector update --file: a malformed YAML or JSON file exits 1 and sends no update", sandboxTest(async (sb) => {
  let r = await updateWith(sb, "bad.yaml", "name: [unclosed\n");
  assert.equal(r.code, 1);
  r = await updateWith(sb, "bad.json", "{nope");
  assert.equal(r.code, 1);
  assert.equal(updateCall(sb), undefined);
}));

test("connector update --file: file values win over the flags for name, namespace and tags", sandboxTest(async (sb) => {
  const r = await updateWith(sb, "c.json", JSON.stringify({ name: "FileName", namespace: "filens", tags: ["file"] }), [
    "-n", "FlagName", "-ns", "flagns", "-t", "flag",
  ]);
  assert.equal(r.code, 0);
  assert.deepEqual(updateCall(sb).variables, { connectorId: "c-1", name: "FileName", namespace: "filens", tags: ["file"] });
}));
