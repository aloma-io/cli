// Characterisation tests for `aloma webhook ...` and `aloma secret ...`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, gqlError } from "./helpers/cli-harness.js";

const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);
const HOOKS = {
  listAutomationWebhooks: [
    { id: "wh-1", name: "orders", key: "key-one", last_used_at: "2024-01-02T03:04:05Z" },
    { id: "wh-2", name: "refunds", key: "key-two", last_used_at: null },
  ],
};
const ME = (region) => ({ me: { realm: { region } } });

// ---------------------------------------------------------------- webhook

test("webhook list: prints each webhook with its URL (no region)", sandboxTest(async (sb) => {
  sb.api.on("LIST_WEBHOOKS_QUERY", HOOKS);
  sb.api.on("ME_QUERY", ME(null));
  const r = await sb.run(["webhook", "list"]);
  assert.equal(r.code, 0);
  assert.equal(
    r.stdout,
    [
      "", "Webhooks in current workspace:", "", "orders", "ID: wh-1", "Key: key-one",
      "Last Used: 2024-01-02T03:04:05Z", "URL: https://connect.aloma.io/event/key-one",
      "", "refunds", "ID: wh-2", "Key: key-two", "Last Used: Never",
      "URL: https://connect.aloma.io/event/key-two", "",
    ].join("\n"),
  );
  assert.deepEqual(ops(sb), [["LIST_WEBHOOKS_QUERY", { id: "ws-sel" }], ["ME_QUERY", {}]]);
}));

test("webhook list: the realm region becomes a host prefix", sandboxTest(async (sb) => {
  sb.api.on("LIST_WEBHOOKS_QUERY", HOOKS);
  sb.api.on("ME_QUERY", ME("eu"));
  const r = await sb.run(["webhook", "list"]);
  assert.match(r.stdout, /URL: https:\/\/eu\.connect\.aloma\.io\/event\/key-one/);
}));

test("webhook list -w <id>: resolves the workspace first", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [{ id: "ws-2", name: "Other" }] });
  sb.api.on("LIST_WEBHOOKS_QUERY", { listAutomationWebhooks: [] });
  const r = await sb.run(["webhook", "list", "-w", "other"]);
  assert.equal(r.stdout, "No webhooks found in the current workspace.\n");
  assert.deepEqual(ops(sb), [["LIST_ENVIRONMENTS_QUERY", {}], ["LIST_WEBHOOKS_QUERY", { id: "ws-2" }]]);
}));

test("webhook list: errors exit with code 1", sandboxTest(async (sb) => {
  sb.api.on("LIST_WEBHOOKS_QUERY", gqlError("denied"));
  const r = await sb.run(["webhook", "list"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error listing webhooks: denied/);
}));

test("webhook list: no selected workspace exits 1", sandboxTest({ session: { token: "t" } }, async (sb) => {
  const r = await sb.run(["webhook", "list"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "No workspace selected. Use `aloma workspace switch` to select one.\n");
  assert.equal(r.stdout, "");
  assert.deepEqual(sb.api.calls, []);
}));

test("webhook add: creates, then shows the new webhook", sandboxTest(async (sb) => {
  sb.api.on("CREATE_WEBHOOK_MUTATION", { createAutomationWebhook: { id: "wh-1" } });
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [{ id: "ws-sel", name: "Dev" }] });
  sb.api.on("LIST_WEBHOOKS_QUERY", HOOKS);
  sb.api.on("ME_QUERY", ME(null));
  const r = await sb.run(["webhook", "add", "orders"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [
    ["CREATE_WEBHOOK_MUTATION", { name: "orders", environmentId: "ws-sel" }],
    // PINS SUSPECT BEHAVIOUR: the already-resolved id is resolved again (extra list call).
    ["LIST_ENVIRONMENTS_QUERY", {}],
    ["LIST_WEBHOOKS_QUERY", { id: "ws-sel" }],
    ["ME_QUERY", {}],
  ]);
  assert.match(r.stdout, /^\n✓ Webhook "orders" created successfully!\n/);
  assert.match(r.stdout, /Webhook Details/);
  assert.match(r.stdout, /Name: orders\nID: wh-1\nKey: key-one\n/);
}));

test("webhook add: error exits with code 1", sandboxTest(async (sb) => {
  sb.api.on("CREATE_WEBHOOK_MUTATION", gqlError("dup"));
  const r = await sb.run(["webhook", "add", "orders"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error creating webhook: dup/);
}));

test("webhook show: found, not found", sandboxTest(async (sb) => {
  sb.api.on("LIST_WEBHOOKS_QUERY", HOOKS);
  sb.api.on("ME_QUERY", ME(null));
  let r = await sb.run(["webhook", "show", "wh-2"]);
  assert.match(r.stdout, /Name: refunds\nID: wh-2\nKey: key-two\nLast Used: Never\nURL: https:\/\/connect\.aloma\.io\/event\/key-two\n$/);
  r = await sb.run(["webhook", "show", "wh-404"]);
  assert.equal(r.stderr, "⚠ Webhook with ID wh-404 not found\n");
  assert.equal(r.code, 1);
}));

test("webhook show: errors exit 1, like list/add/delete", sandboxTest(async (sb) => {
  sb.api.on("LIST_WEBHOOKS_QUERY", gqlError("denied"));
  const r = await sb.run(["webhook", "show", "wh-1"]);
  // PLAT-81: was exit 0, inconsistent with the rest of the webhook group.
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error showing webhook: denied\n");
}));

test("webhook delete: success, refusal by API, error", sandboxTest(async (sb) => {
  sb.api.on("REMOVE_WEBHOOK_MUTATION", { deleteAutomationWebhook: true });
  let r = await sb.run(["webhook", "delete", "wh-1"]);
  assert.equal(r.stdout, "✓ Webhook wh-1 deleted successfully\n");
  assert.deepEqual(ops(sb), [["REMOVE_WEBHOOK_MUTATION", { id: "wh-1", environmentId: "ws-sel" }]]);
  sb.api.on("REMOVE_WEBHOOK_MUTATION", { deleteAutomationWebhook: false });
  r = await sb.run(["webhook", "delete", "wh-1"]);
  assert.equal(r.stderr, "⚠ Webhook wh-1 could not be deleted\n");
  assert.equal(r.code, 1);
  sb.api.on("REMOVE_WEBHOOK_MUTATION", gqlError("gone"));
  r = await sb.run(["webhook", "delete", "wh-1"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error deleting webhook: gone/);
}));

// ----------------------------------------------------------------- secret

const CONFIG = {
  getAutomationEnvironmentConfig: {
    API_URL: { encrypted: false, value: "https://example.invalid", description: "base url", options: {} },
    API_KEY: { encrypted: true, value: "xxx", description: "", options: { rotate: true } },
    BARE: { encrypted: false },
  },
};

// SECURITY (finding 7): values are masked unless --reveal is given.
test("SECURITY: secret list masks plain values by default, hides encrypted ones", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", CONFIG);
  const r = await sb.run(["secret", "list"]);
  assert.equal(r.code, 0);
  assert.deepEqual(ops(sb), [["GET_SECRET_QUERY", { id: "ws-sel" }]]);
  assert.equal(
    r.stdout,
    [
      "", "Secrets for workspace (ID: ws-sel):", "─".repeat(80),
      "1. API_URL", "   Description: base url", "   Value: ******** (hidden, use --reveal to show)", "   Encrypted: 🔓", "",
      "2. API_KEY", "   Description: No description", "   Value: [ENCRYPTED]", "   Encrypted: 🔒",
      '   Options: {"rotate":true}', "",
      "3. BARE", "   Description: No description", "   Value: [NO VALUE]", "   Encrypted: 🔓", "", "",
    ].join("\n"),
  );
}));

test("secret list --reveal shows plain values (encrypted ones stay hidden)", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", CONFIG);
  const r = await sb.run(["secret", "list", "--reveal"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^   Value: https:\/\/example\.invalid$/m);
  assert.match(r.stdout, /^   Value: \[ENCRYPTED\]$/m);
  assert.match(r.stdout, /^   Value: \[NO VALUE\]$/m);
}));

test("SECURITY: secret list output never contains a plain value without --reveal", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", CONFIG);
  const r = await sb.run(["secret", "list"]);
  assert.doesNotMatch(r.out, /example\.invalid/);
}));

test("secret list: null or empty config", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", { getAutomationEnvironmentConfig: null });
  let r = await sb.run(["secret", "list"]);
  assert.equal(r.stdout, "No secrets found for this workspace.\n");
  sb.api.on("GET_SECRET_QUERY", { getAutomationEnvironmentConfig: {} });
  r = await sb.run(["secret", "list"]);
  assert.match(r.stdout, /No secrets found for this workspace\.\n$/);
}));

test("secret list: API error", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", gqlError("denied"));
  const r = await sb.run(["secret", "list"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error fetching secrets: denied\n");
}));

test("secret add: merges the new secret into the existing config and saves the whole object", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", CONFIG);
  sb.api.on("SAVE_SECRET_MUTATION", { saveAutomationEnvironmentConfig: true });
  const r = await sb.run(["secret", "add", "TOKEN", "s3cret-fake", "-d", "a token", "-e"]);
  assert.equal(r.stdout, '✅ Secret "TOKEN" added successfully\n');
  assert.deepEqual(sb.api.calls.at(-1).variables, {
    environmentId: "ws-sel",
    values: {
      ...CONFIG.getAutomationEnvironmentConfig,
      TOKEN: { encrypted: true, value: "s3cret-fake", description: "a token", options: {}, hasValue: true },
    },
  });
}));

test("secret add: defaults (not encrypted, empty description) and empty workspace config", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", { getAutomationEnvironmentConfig: null });
  sb.api.on("SAVE_SECRET_MUTATION", { saveAutomationEnvironmentConfig: true });
  await sb.run(["secret", "add", "A", "1"]);
  assert.deepEqual(sb.api.calls.at(-1).variables.values, {
    A: { encrypted: false, value: "1", description: "", options: {}, hasValue: true },
  });
}));

test("secret add: an existing secret with the same name is overwritten without a warning", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", CONFIG);
  sb.api.on("SAVE_SECRET_MUTATION", { saveAutomationEnvironmentConfig: true });
  const r = await sb.run(["secret", "add", "API_URL", "new"]);
  // PINS SUSPECT BEHAVIOUR: silent overwrite.
  assert.equal(r.stdout, '✅ Secret "API_URL" added successfully\n');
  assert.equal(sb.api.calls.at(-1).variables.values.API_URL.value, "new");
}));

test("secret add --options <yaml> always fails: cli.js never imports js-yaml", sandboxTest(async (sb) => {
  const r = await sb.run(["secret", "add", "A", "1", "-o", "k: v"]);
  // PINS SUSPECT BEHAVIOUR: ReferenceError is caught and shown as "Invalid JSON in options";
  // nothing is sent. PLAT-81: the refused option now exits 2 (was 0); the missing import is left for a later slice.
  assert.equal(r.code, 2);
  assert.equal(r.stderr, "Invalid JSON in options: yaml is not defined\n");
  assert.deepEqual(sb.api.calls, []);
}));

test("secret add: API error on save", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", CONFIG);
  sb.api.on("SAVE_SECRET_MUTATION", gqlError("too big"));
  const r = await sb.run(["secret", "add", "A", "1"]);
  assert.equal(r.stderr, "Error adding secret: too big\n");
  assert.equal(r.code, 1);
}));

test("secret add: value and name are required arguments", sandboxTest(async (sb) => {
  const r = await sb.run(["secret", "add", "A"]);
  // PLAT-81: a usage error exits 2 (was commander's 1).
  assert.equal(r.code, 2);
  assert.match(r.stderr, /missing required argument 'value'/);
}));

test("secret delete: removes the key and saves the rest", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", CONFIG);
  sb.api.on("SAVE_SECRET_MUTATION", { saveAutomationEnvironmentConfig: true });
  const r = await sb.run(["secret", "delete", "API_KEY"]);
  assert.equal(r.stdout, '✅ Secret "API_KEY" deleted successfully\n');
  const { API_KEY, ...rest } = CONFIG.getAutomationEnvironmentConfig;
  assert.deepEqual(sb.api.calls.at(-1).variables, { environmentId: "ws-sel", values: rest });
}));

test("secret delete: unknown name saves nothing", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", CONFIG);
  const r = await sb.run(["secret", "delete", "NOPE"]);
  assert.equal(r.stderr, '❌ Secret "NOPE" not found. Use `aloma secret list` to see available secrets.\n');
  assert.deepEqual(sb.api.ops(), ["GET_SECRET_QUERY"]);
  assert.equal(r.code, 1);
}));

test("secret delete: API error", sandboxTest(async (sb) => {
  sb.api.on("GET_SECRET_QUERY", gqlError("denied"));
  const r = await sb.run(["secret", "delete", "A"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error deleting secret: denied\n");
}));

test("secret commands: explicit -w name is resolved before use", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [{ id: "ws-9", name: "Nine" }] });
  sb.api.on("GET_SECRET_QUERY", { getAutomationEnvironmentConfig: {} });
  await sb.run(["secret", "list", "-w", "Nine"]);
  assert.deepEqual(ops(sb), [["LIST_ENVIRONMENTS_QUERY", {}], ["GET_SECRET_QUERY", { id: "ws-9" }]]);
}));
