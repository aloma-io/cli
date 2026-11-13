// Regression tests for the output shapes and update fallbacks of `aloma connector ...`
// (src/commands/connector) that tests/commands-connector.test.js does not pin.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as jose from "jose";
import { sandboxTest } from "./helpers/cli-harness.js";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const PUBKEY_B64 = Buffer.from(publicKey).toString("base64");

const CONNECTORS = {
  listAutomationConnectors: [
    { id: "c-1", marketId: "m-1", name: "Mailer", namespace: "mail", shared_in_realm: false, last_used_at: null, health: [{ healthy: true }] },
  ],
};
const show = (schema) => ({
  getAutomationConnector: { id: "c-1", name: "Mailer", namespace: "mail", shared_in_realm: false, health: [{ healthy: true }] },
  getAutomationConnectorConfigSchema: schema,
});
const withConfig = (fields) => ({
  ...show({ summary: "s", fields }),
  getAutomationConnectorPublicKey: PUBKEY_B64,
});
const DECRYPT_KEY = crypto.createPrivateKey(privateKey);
const decrypt = (token, audience) => jose.jwtDecrypt(token, DECRYPT_KEY, { audience, issuer: "home.aloma.io" });
const heads = (out) => out.split("\n").filter((l) => ["Summary", "Description", "Fields"].includes(l));

test("connector show: a schema with only a summary has no Description or Fields heading", sandboxTest(async (sb) => {
  sb.api.on("GET_CONNECTOR_QUERY", show({ summary: "Only summary" }));
  const r = await sb.run(["connector", "show", "c-1"]);
  assert.equal(r.code, 0);
  assert.deepEqual(heads(r.stdout), ["Summary"]);
  assert.ok(r.stdout.endsWith("Summary\nOnly summary\n\n"));
}));

test("connector show: a schema with only a description has no Summary or Fields heading", sandboxTest(async (sb) => {
  sb.api.on("GET_CONNECTOR_QUERY", show({ description: "Only description" }));
  const r = await sb.run(["connector", "show", "c-1"]);
  assert.equal(r.code, 0);
  assert.deepEqual(heads(r.stdout), ["Description"]);
  assert.ok(r.stdout.endsWith("Description\nOnly description\n\n"));
}));

test("connector show: an empty fields object prints no Fields heading", sandboxTest(async (sb) => {
  sb.api.on("GET_CONNECTOR_QUERY", show({ summary: "s", fields: {} }));
  const r = await sb.run(["connector", "show", "c-1"]);
  assert.deepEqual(heads(r.stdout), ["Summary"]);
}));

test("connector show: field without placeholder prints an empty Value; optional true/false/missing is Yes/No/No", sandboxTest(async (sb) => {
  sb.api.on("GET_CONNECTOR_QUERY", show({
    fields: { a: { name: "A", optional: true }, b: { name: "B", optional: false }, c: { name: "C" } },
  }));
  const r = await sb.run(["connector", "show", "c-1"]);
  assert.ok(
    r.stdout.endsWith(
      ["Fields", "  Key: a", "  Name: A", "  Value: ", "  Optional: Yes", "", "  Key: b", "  Name: B", "  Value: ", "  Optional: No", "", "  Key: c", "  Name: C", "  Value: ", "  Optional: No", "", ""].join("\n"),
    ),
  );
}));

test("connector list: Healthy only when the first health entry is healthy", sandboxTest(async (sb) => {
  const base = { marketId: "m", name: "N", namespace: "n", shared_in_realm: false, last_used_at: "x" };
  sb.api.on("LIST_CONNECTORS_QUERY", {
    listAutomationConnectors: [
      { ...base, id: "h1", health: [{ healthy: true }, { healthy: false }] },
      { ...base, id: "h2", health: [{ healthy: false }, { healthy: true }] },
      { ...base, id: "h3", health: [] },
      { ...base, id: "h4", health: null },
      { ...base, id: "h5", health: [{}] },
    ],
  });
  const r = await sb.run(["connector", "list"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.stdout.split("\n").filter((l) => l.startsWith("Health: ")), [
    "Health: Healthy", "Health: Unhealthy", "Health: Unhealthy", "Health: Unhealthy", "Health: Unhealthy",
  ]);
}));

test("connector list: records current output: a null last_used_at is printed as the word null", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  const r = await sb.run(["connector", "list"]);
  assert.ok(r.stdout.includes("\nLast Used At: null\n"));
}));

test("connector update --file: shared_in_realm false alone still sends the update with empty namespace and no tags", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("GET_CONNECTOR_QUERY", show({}));
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
  sb.write("s.json", JSON.stringify({ shared_in_realm: false }));
  const r = await sb.run(["connector", "update", "c-1", "-f", "s.json"]);
  assert.equal(r.code, 0);
  assert.deepEqual(sb.api.ops(), ["LIST_CONNECTORS_QUERY", "GET_CONNECTOR_QUERY", "UPDATE_CONNECTOR_MUTATION"]);
  assert.deepEqual(sb.api.calls.at(-1).variables, { connectorId: "c-1", name: "Mailer", namespace: "", tags: [], shared_in_realm: false });
}));

test("connector update --config: unknown and non-plain keys are encrypted, plain keys are sent as given, one update with all keys", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("GET_CONNECTOR_QUERY", withConfig({ host: { name: "Host", plain: true }, pw: { name: "Pw", plain: false } }));
  sb.api.on("UPDATE_CONNECTOR_CONFIG_SCHEMA_MUTATION", { updateAutomationConnectorConfigSchema: true });
  const r = await sb.run(["connector", "update", "c-1", "-c", '{"host":"h.invalid","pw":"not-a-token","extra":"other"}']);
  assert.equal(r.code, 0);
  assert.deepEqual(sb.api.ops(), ["LIST_CONNECTORS_QUERY", "GET_CONNECTOR_QUERY", "UPDATE_CONNECTOR_CONFIG_SCHEMA_MUTATION"]);
  const { content } = sb.api.calls.at(-1).variables;
  assert.deepEqual(Object.keys(content).sort(), ["extra", "host", "pw"]);
  assert.equal(content.host, "h.invalid");
  for (const [k, v] of [["pw", "not-a-token"], ["extra", "other"]]) {
    assert.equal(content[k].split(".").length, 5);
    assert.equal((await decrypt(content[k], "m-1")).payload._data, v);
  }
}));

test("connector update --config: records the requests sent when the connector is not in the workspace list", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", { listAutomationConnectors: [] });
  sb.api.on("GET_CONNECTOR_QUERY", withConfig({ pw: { name: "Pw" } }));
  sb.api.on("UPDATE_CONNECTOR_CONFIG_SCHEMA_MUTATION", { updateAutomationConnectorConfigSchema: true });
  const r = await sb.run(["connector", "update", "c-1", "-c", '{"pw":"not-a-token"}']);
  assert.equal(r.code, 0);
  assert.deepEqual(sb.api.ops(), ["LIST_CONNECTORS_QUERY", "GET_CONNECTOR_QUERY", "UPDATE_CONNECTOR_CONFIG_SCHEMA_MUTATION"]);
  assert.deepEqual(Object.keys(sb.api.calls.at(-1).variables.content), ["pw"]);
}));

test("connector update --file: a false shared_in_realm in the file wins over the flag", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("GET_CONNECTOR_QUERY", show({}));
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
  sb.write("f.json", JSON.stringify({ shared_in_realm: false }));
  const r = await sb.run(["connector", "update", "c-1", "-n", "N", "-s", "-f", "f.json"]);
  assert.equal(r.code, 0);
  // The name is given, so the connector is not fetched.
  assert.deepEqual(sb.api.ops(), ["LIST_CONNECTORS_QUERY", "UPDATE_CONNECTOR_MUTATION"]);
  assert.equal(sb.api.calls.at(-1).variables.shared_in_realm, false);
}));

test("connector update --file: a file without shared_in_realm keeps the flag", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("GET_CONNECTOR_QUERY", show({}));
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
  sb.write("g.json", JSON.stringify({ name: "G" }));
  const r = await sb.run(["connector", "update", "c-1", "-s", "-f", "g.json"]);
  assert.equal(r.code, 0);
  assert.deepEqual(sb.api.ops(), ["LIST_CONNECTORS_QUERY", "UPDATE_CONNECTOR_MUTATION"]);
  assert.equal(sb.api.calls.at(-1).variables.shared_in_realm, true);
}));

test("connector update --file: an empty tags list in the file wins over the flag's tags", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("GET_CONNECTOR_QUERY", show({}));
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
  sb.write("t.json", JSON.stringify({ name: "N", tags: [] }));
  const r = await sb.run(["connector", "update", "c-1", "-t", "a,b", "-f", "t.json"]);
  assert.equal(r.code, 0);
  assert.deepEqual(sb.api.ops(), ["LIST_CONNECTORS_QUERY", "UPDATE_CONNECTOR_MUTATION"]);
  // [] is truthy, so the "||" keeps the file's list.
  assert.deepEqual(sb.api.calls.at(-1).variables.tags, []);
}));

// The 10 second wait before the follow-up update is shortened with an inline preload (test only).
const SHORT_WAIT = "data:text/javascript," + encodeURIComponent(
  "const o=globalThis.setTimeout;globalThis.setTimeout=(f,ms,...a)=>o(f,ms===10000?0:ms,...a);",
);
const CHILD_PRELOAD = pathToFileURL(path.resolve(import.meta.dirname, "helpers", "child-preload.mjs")).href;

test("connector add --tags: when the new connector is in the workspace list the follow-up update is sent", sandboxTest(async (sb) => {
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: true });
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("GET_CONNECTOR_QUERY", show({}));
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
  const r = await sb.run(["connector", "add", "m-1", "-n", "Mailer", "-t", "a,b"], {
    env: { NODE_OPTIONS: `--import ${CHILD_PRELOAD} --import ${SHORT_WAIT}` },
  });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "\nConnector added successfully!\n\nConnector updated successfully!\n");
  assert.deepEqual(sb.api.ops(), ["ADD_CONNECTOR_MUTATION", "LIST_CONNECTORS_QUERY", "LIST_CONNECTORS_QUERY", "GET_CONNECTOR_QUERY", "UPDATE_CONNECTOR_MUTATION"]);
  assert.deepEqual(sb.api.calls.at(-1).variables, { connectorId: "c-1", name: "Mailer", namespace: "", tags: ["a", "b"] });
}));

test("connector add --tags: when the new connector is not in the workspace list no follow-up update is sent", sandboxTest(async (sb) => {
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: true });
  sb.api.on("LIST_CONNECTORS_QUERY", { listAutomationConnectors: [] });
  sb.api.on("GET_CONNECTOR_QUERY", show({}));
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
  const r = await sb.run(["connector", "add", "m-1", "-n", "Mailer", "-t", "a,b"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "\nConnector added successfully!\n");
  assert.deepEqual(sb.api.ops(), ["ADD_CONNECTOR_MUTATION", "LIST_CONNECTORS_QUERY"]);
}));
