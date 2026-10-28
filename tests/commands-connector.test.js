// Characterisation tests for `aloma connector ...` (src/commands/connector).
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as jose from "jose";
import { sandboxTest, gqlError, canFakeOpen } from "./helpers/cli-harness.js";

const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);

// throw-away RSA key pair; the CLI encrypts config values to the "public key" the API returns
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const PUBKEY_B64 = Buffer.from(publicKey).toString("base64");

const CONNECTORS = {
  listAutomationConnectors: [
    { id: "c-1", marketId: "m-1", name: "Mailer", namespace: "mail", shared_in_realm: false, last_used_at: "2024-02-02", health: [{ healthy: true }] },
    { id: "c-2", marketId: "m-2", name: "Chat", namespace: "chat", shared_in_realm: true, last_used_at: null, health: null },
  ],
};
const DETAIL = (extra = {}) => ({
  getAutomationConnector: { id: "c-1", name: "Mailer", namespace: "mail", shared_in_realm: false, health: [{ healthy: false }] },
  getAutomationConnectorConfigSchema: {
    summary: "Sends mail", description: "Long text",
    fields: { host: { name: "Host", placeholder: "smtp.example.invalid", optional: false, plain: true }, pass: { name: "Password", optional: true } },
  },
  getAutomationConnectorPublicKey: PUBKEY_B64,
  ...extra,
});

test("connector list: prints each connector with health", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  const r = await sb.run(["connector", "list"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["LIST_CONNECTORS_QUERY", { id: "ws-sel" }]]);
  assert.equal(
    r.stdout,
    [
      "", "Connectors:", "", "ID: c-1", "Name: Mailer", "Shared in Realm: false", "Namespace: mail", "Last Used At: 2024-02-02", "Health: Healthy",
      "", "ID: c-2", "Name: Chat", "Shared in Realm: true", "Namespace: chat", "Last Used At: null", "Health: Unhealthy", "",
    ].join("\n"),
  );
}));

test("connector list: empty says 'No available connector types found.'; API error exits 1", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", { listAutomationConnectors: [] });
  let r = await sb.run(["connector", "list"]);
  // PINS SUSPECT BEHAVIOUR: wording mixes up "connectors" and "connector types".
  assert.equal(r.stdout, "No available connector types found.\n");
  sb.api.on("LIST_CONNECTORS_QUERY", gqlError("denied"));
  r = await sb.run(["connector", "list"]);
  // PLAT-81: printed once (was printed, then re-thrown as an unhandled rejection with a stack trace).
  assert.equal(r.stderr, "Error listing available connectors: denied\n");
  assert.equal(r.code, 1);
}));

test("connector list-available: uses the selected workspace, mine=false, empty name by default", sandboxTest(async (sb) => {
  sb.api.on("LIST_AVAILABLE_CONNECTOR_QUERY", {
    listAutomationAvailableConnectors: [{ id: "m-1", name: "Mailer", added: true, on_premise: false, in_cloud: true, needs_storage: false, expose_service: false }],
  });
  let r = await sb.run(["connector", "list-available"]);
  assert.deepEqual(ops(sb), [["LIST_AVAILABLE_CONNECTOR_QUERY", { id: "ws-sel", mine: false, name: "" }]]);
  assert.equal(
    r.stdout,
    ["", "Available Connectors:", "", "ID: m-1", "Name: Mailer", "Added: true", "On Premise: false", "In Cloud: true", "Needs Storage: false", "Expose Service: false", ""].join("\n"),
  );
  r = await sb.run(["connector", "list-available", "-f", "mail"]);
  assert.equal(sb.api.calls.at(-1).variables.name, "mail");
}));

test("connector list-available: none found; error exits 1", sandboxTest(async (sb) => {
  sb.api.on("LIST_AVAILABLE_CONNECTOR_QUERY", { listAutomationAvailableConnectors: [] });
  let r = await sb.run(["connector", "list-available"]);
  assert.equal(r.stdout, "No connectors found.\n");
  sb.api.on("LIST_AVAILABLE_CONNECTOR_QUERY", gqlError("denied"));
  r = await sb.run(["connector", "list-available"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error listing connectors: denied/);
}));

test("connector show: details and config schema", sandboxTest(async (sb) => {
  sb.api.on("GET_CONNECTOR_QUERY", DETAIL());
  const r = await sb.run(["connector", "show", "c-1"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["GET_CONNECTOR_QUERY", { id: "ws-sel", connectorId: "c-1" }]]);
  assert.equal(
    r.stdout,
    [
      "", "Connector Details:", "", "ID: c-1", "Name: Mailer", "Namespace: mail", "Shared in Realm: false", "Health: Unhealthy",
      "Summary", "Sends mail", "", "Description", "Long text", "", "Fields",
      "  Key: host", "  Name: Host", "  Value: smtp.example.invalid", "  Optional: No", "",
      "  Key: pass", "  Name: Password", "  Value: ", "  Optional: Yes", "", "",
    ].join("\n"),
  );
}));

test("connector show: unknown connector or missing schema ends in an unhandled error (exit 1)", sandboxTest(async (sb) => {
  sb.api.on("GET_CONNECTOR_QUERY", { getAutomationConnector: null, getAutomationConnectorConfigSchema: null });
  const r = await sb.run(["connector", "show", "c-9"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error showing connector: Cannot read properties of null/);
}));

test("connector add <id> --name: sends the add mutation", sandboxTest(async (sb) => {
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: true });
  const r = await sb.run(["connector", "add", "m-1", "-n", "Mailer", "-ns", "mail"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "\nConnector added successfully!\n");
  assert.deepEqual(ops(sb), [["ADD_CONNECTOR_MUTATION", { id: "m-1", environmentId: "ws-sel", name: "Mailer", namespace: "mail" }]]);
}));

test("connector add <id> without --name: name and namespace are taken from the connector details", sandboxTest(async (sb) => {
  sb.api.on("GET_CONNECTOR_QUERY", DETAIL());
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: true });
  // PINS SUSPECT BEHAVIOUR: a --namespace given without --name is thrown away.
  await sb.run(["connector", "add", "m-1", "-ns", "mine"]);
  assert.deepEqual(ops(sb), [
    ["GET_CONNECTOR_QUERY", { id: "ws-sel", connectorId: "m-1" }],
    ["ADD_CONNECTOR_MUTATION", { id: "m-1", environmentId: "ws-sel", name: "Mailer", namespace: "mail" }],
  ]);
}));

test("connector add: unknown connector, refused by API, API error", sandboxTest(async (sb) => {
  sb.api.on("GET_CONNECTOR_QUERY", { getAutomationConnector: null });
  let r = await sb.run(["connector", "add", "m-9"]);
  assert.equal(r.stderr, "Error: Connector not found\n");
  assert.equal(r.code, 1);
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: false });
  r = await sb.run(["connector", "add", "m-1", "-n", "x"]);
  assert.equal(r.stderr, "Error: Failed to add connector\n");
  assert.equal(r.code, 1);
  sb.api.on("ADD_CONNECTOR_MUTATION", gqlError("limit"));
  r = await sb.run(["connector", "add", "m-1", "-n", "x"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error creating connector: limit\n");
}));

test("connector add --config with invalid JSON: nothing is sent", sandboxTest(async (sb) => {
  const r = await sb.run(["connector", "add", "m-1", "-n", "x", "-c", "{nope"]);
  // PLAT-81: a refused option is a usage error, exit 2 (was 0).
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Error: -c\/--config must be a valid JSON string: /);
  assert.deepEqual(sb.api.calls, []);
}));

test("connector add --tags: when the new connector cannot be found in the list, the extras are dropped silently", sandboxTest(async (sb) => {
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: true });
  sb.api.on("LIST_CONNECTORS_QUERY", { listAutomationConnectors: [] });
  const r = await sb.run(["connector", "add", "m-1", "-n", "Mailer", "-t", "a,b", "-s"]);
  // PINS SUSPECT BEHAVIOUR: success is printed, tags/shared are never applied, no warning.
  assert.equal(r.stdout, "\nConnector added successfully!\n");
  assert.deepEqual(sb.api.ops(), ["ADD_CONNECTOR_MUTATION", "LIST_CONNECTORS_QUERY"]);
}));

test("connector delete", sandboxTest(async (sb) => {
  sb.api.on("REMOVE_CONNECTOR_MUTATION", { removeAutomationMarketConnectorFromEnvironment: true });
  let r = await sb.run(["connector", "delete", "c-1"]);
  assert.equal(r.stdout, "\nConnector c-1 deleted successfully!\n");
  assert.deepEqual(ops(sb), [["REMOVE_CONNECTOR_MUTATION", { id: "c-1", environmentId: "ws-sel" }]]);
  sb.api.on("REMOVE_CONNECTOR_MUTATION", gqlError("in use"));
  r = await sb.run(["connector", "delete", "c-1"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error deleting connector: in use/);
}));

test("connector update: name/namespace/tags/shared go to the update mutation", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
  const r = await sb.run(["connector", "update", "c-1", "-n", "Mailer2", "-ns", "mail2", "-t", "a,b", "-s"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "\nConnector updated successfully!\n");
  assert.deepEqual(ops(sb), [
    ["LIST_CONNECTORS_QUERY", { id: "ws-sel" }],
    // PINS SUSPECT BEHAVIOUR: unlike `connector add`, update does not split --tags: the
    // comma-separated string is sent as is.
    ["UPDATE_CONNECTOR_MUTATION", { connectorId: "c-1", name: "Mailer2", namespace: "mail2", tags: "a,b", shared_in_realm: true }],
  ]);
}));

test("connector update -t only: name is looked up, namespace is sent as empty string", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("GET_CONNECTOR_QUERY", DETAIL());
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
  await sb.run(["connector", "update", "c-1", "-t", "x"]);
  // PINS SUSPECT BEHAVIOUR: the stored namespace ("mail") is not re-sent; "" is.
  assert.deepEqual(sb.api.calls.at(-1).variables, { connectorId: "c-1", name: "Mailer", namespace: "", tags: "x" });
}));

test("connector update: refused by the API / unknown connector while looking up the name", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: false });
  let r = await sb.run(["connector", "update", "c-1", "-n", "x"]);
  assert.equal(r.stderr, "Error: Failed to update connector\n");
  assert.equal(r.code, 1);
  sb.api.on("GET_CONNECTOR_QUERY", { getAutomationConnector: null });
  r = await sb.run(["connector", "update", "c-1", "-t", "x"]);
  assert.equal(r.stderr, "Error: Connector not found\n");
  assert.equal(r.code, 1);
}));

test("connector update --config: values are encrypted for the connector's market id, plain fields are not", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("GET_CONNECTOR_QUERY", DETAIL());
  sb.api.on("UPDATE_CONNECTOR_CONFIG_SCHEMA_MUTATION", { updateAutomationConnectorConfigSchema: true });
  const r = await sb.run(["connector", "update", "c-1", "-c", '{"host":"smtp.example.invalid","pass":"hunter2-fake"}']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "\nConnector configuration updated successfully!\n");
  assert.deepEqual(sb.api.ops(), ["LIST_CONNECTORS_QUERY", "GET_CONNECTOR_QUERY", "UPDATE_CONNECTOR_CONFIG_SCHEMA_MUTATION"]);
  const sent = sb.api.calls.at(-1).variables;
  assert.equal(sent.environmentId, "ws-sel");
  assert.equal(sent.connectorId, "c-1");
  assert.equal(sent.content.host, "smtp.example.invalid"); // field marked plain
  assert.equal(sent.content.pass.split(".").length, 5); // compact JWE
  const key = crypto.createPrivateKey(privateKey);
  const { payload } = await jose.jwtDecrypt(sent.content.pass, key, { audience: "m-1", issuer: "home.aloma.io" });
  assert.equal(payload._data, "hunter2-fake");
  assert.equal(payload.exp, undefined);
}));

test("connector update --config: refused by the API", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("GET_CONNECTOR_QUERY", DETAIL());
  sb.api.on("UPDATE_CONNECTOR_CONFIG_SCHEMA_MUTATION", { updateAutomationConnectorConfigSchema: false });
  const r = await sb.run(["connector", "update", "c-1", "-c", '{"host":"h"}']);
  assert.equal(r.stderr, "Error: Failed to update connector configuration\n");
  assert.equal(r.code, 1);
}));

test("connector update --config: invalid JSON is refused before any request", sandboxTest(async (sb) => {
  const r = await sb.run(["connector", "update", "c-1", "-c", "nope"]);
  assert.match(r.stderr, /Error: -c\/--config must be a valid JSON string: /);
  assert.deepEqual(sb.api.calls, []);
}));

test("connector update --file (JSON and YAML): file values override command-line flags", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  sb.api.on("UPDATE_CONNECTOR_MUTATION", { updateAutomationConnector: true });
  sb.write("c.json", JSON.stringify({ name: "FromFile", tags: ["t1"], shared_in_realm: false }));
  await sb.run(["connector", "update", "c-1", "-n", "FromFlag", "-ns", "flagns", "-s", "-f", "c.json"]);
  // PINS SUSPECT BEHAVIOUR: `shared_in_realm: false` in the file wins over --shared (via ??), name wins via ||.
  assert.deepEqual(sb.api.calls.at(-1).variables, { connectorId: "c-1", name: "FromFile", namespace: "flagns", tags: ["t1"], shared_in_realm: false });
  sb.write("c.yaml", "name: YamlName\nnamespace: ynz\n");
  await sb.run(["connector", "update", "c-1", "-f", "c.yaml"]);
  assert.deepEqual(sb.api.calls.at(-1).variables, { connectorId: "c-1", name: "YamlName", namespace: "ynz", tags: [] });
}));

test("connector update --file: missing or malformed file exits 1", sandboxTest(async (sb) => {
  let r = await sb.run(["connector", "update", "c-1", "-f", "missing.json"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error updating connector: ENOENT/);
  sb.write("bad.json", "{x");
  r = await sb.run(["connector", "update", "c-1", "-f", "bad.json"]);
  assert.equal(r.code, 1);
  assert.deepEqual(sb.api.calls, []);
}));

test("connector update: with nothing to change only the workspace connectors are listed", sandboxTest(async (sb) => {
  sb.api.on("LIST_CONNECTORS_QUERY", CONNECTORS);
  const r = await sb.run(["connector", "update", "c-1"]);
  assert.equal(r.stdout, "");
  assert.equal(r.code, 0);
  assert.deepEqual(sb.api.ops(), ["LIST_CONNECTORS_QUERY"]);
}));

test("connector logs: prints the log text; none; error exits 1", sandboxTest(async (sb) => {
  sb.api.on("GET_CONNECTOR_LOGS_QUERY", { getAutomationConnectorLogs: "line1\nline2" });
  let r = await sb.run(["connector", "logs", "c-1"]);
  assert.equal(r.stdout, "\nConnector Logs:\nline1\nline2\n");
  assert.deepEqual(ops(sb), [["GET_CONNECTOR_LOGS_QUERY", { environmentId: "ws-sel", connectorId: "c-1" }]]);
  sb.api.on("GET_CONNECTOR_LOGS_QUERY", { getAutomationConnectorLogs: null });
  r = await sb.run(["connector", "logs", "c-1"]);
  assert.equal(r.stdout, "No logs found for this connector.\n");
  sb.api.on("GET_CONNECTOR_LOGS_QUERY", gqlError("denied"));
  r = await sb.run(["connector", "logs", "c-1"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error getting connector logs: denied/);
}));

const OAUTH = { startAutomationConnectorOAuth: "https://auth.example.invalid/authorize?x=1" };

test("connector oauth: starts the flow and opens the returned URL", { skip: !canFakeOpen && "needs the fake `open` (macOS only)" }, sandboxTest(async (sb) => {
  sb.api.on("START_CONNECTOR_OAUTH_MUTATION", OAUTH);
  const r = await sb.run(["connector", "oauth", "c-1"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "\nOAuth process started successfully!\n");
  assert.deepEqual(ops(sb), [["START_CONNECTOR_OAUTH_MUTATION", { environmentConnectorId: "c-1", environmentId: "ws-sel", isDevelopment: false }]]);
  assert.deepEqual(sb.openCalls(), ["https://auth.example.invalid/authorize?x=1"]);
}));

test("connector oauth --development", { skip: !canFakeOpen && "needs the fake `open` (macOS only)" }, sandboxTest(async (sb) => {
  sb.api.on("START_CONNECTOR_OAUTH_MUTATION", OAUTH);
  await sb.run(["connector", "oauth", "c-1", "-d"]);
  assert.equal(sb.api.calls.at(-1).variables.isDevelopment, true);
}));

test("connector oauth: no URL returned; invalid URL; API error — all exit 1", sandboxTest(async (sb) => {
  // PLAT-81: all three were exit 0; the error object (with its stack) was printed, now only its message.
  sb.api.on("START_CONNECTOR_OAUTH_MUTATION", { startAutomationConnectorOAuth: null });
  let r = await sb.run(["connector", "oauth", "c-1"]);
  assert.equal(r.stderr, "Error: Failed to start OAuth process\n");
  assert.equal(r.code, 1);
  sb.api.on("START_CONNECTOR_OAUTH_MUTATION", { startAutomationConnectorOAuth: "not a url" });
  r = await sb.run(["connector", "oauth", "c-1"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error starting OAuth process: Invalid URL\n");
  assert.deepEqual(sb.openCalls(), []);
  sb.api.on("START_CONNECTOR_OAUTH_MUTATION", gqlError("denied"));
  r = await sb.run(["connector", "oauth", "c-1"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error starting OAuth process: denied\n");
}));

test("connector commands: -w <name> is resolved first", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [{ id: "ws-4", name: "Four" }] });
  sb.api.on("GET_CONNECTOR_LOGS_QUERY", { getAutomationConnectorLogs: "x" });
  await sb.run(["connector", "logs", "c-1", "-w", "four"]);
  assert.deepEqual(ops(sb), [["LIST_ENVIRONMENTS_QUERY", {}], ["GET_CONNECTOR_LOGS_QUERY", { environmentId: "ws-4", connectorId: "c-1" }]]);
}));
