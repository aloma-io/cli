// PLAT-116: one context module (src/context.js) owns the current company, region and workspace.
// `me` is fetched at most once per session token; companies, workspaces and connectors are resolved by
// the rule in src/names.js: an exact id, then a name in any case (Patrick, 28 Oct); more than one match is refused with the ids listed,
// and a reference that matches nothing is refused instead of being sent on as an id.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandboxTest, FAKE_TOKEN, REPO } from "./helpers/cli-harness.js";

const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);
const meCalls = (sb) => sb.api.calls.filter((c) => c.op === "ME_QUERY");
const ME = (realms = [{ id: "r-1", name: "Alpha Co", region: "eu" }, { id: "r-2", name: "Beta Co", region: "us" }]) => ({
  me: { id: "u-1", groups: ["developer"], realm: realms[0], realms },
});
const COOKIE = (v) => JSON.stringify({ "set-cookie": [`Authorization=${v}; Path=/; HttpOnly`] });
const WS = (...pairs) => ({ listAutomationEnvironmentWithStats: pairs.map(([id, name]) => ({ id, name })) });
const webhooks = (sb) => {
  sb.api.on("CREATE_WEBHOOK_MUTATION", (v) => ({ createAutomationWebhook: { id: `wh-${v.name}` } }));
  sb.api.on("LIST_WEBHOOKS_QUERY", {
    listAutomationWebhooks: [{ id: "wh-a", name: "a", key: "ka" }, { id: "wh-b", name: "b", key: "kb" }],
  });
};

// ---------------------------------------------------------------- me, once

test("context: a deploy with two webhooks fetches `me` once (region for both URLs)", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    webhooks:\n      - name: a\n      - name: b\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("ME_QUERY", ME());
  webhooks(sb);
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(meCalls(sb).length, 1);
  assert.match(r.stdout, /URL: https:\/\/eu\.connect\.aloma\.io\/event\/ka\n/);
  assert.match(r.stdout, /URL: https:\/\/eu\.connect\.aloma\.io\/event\/kb\n/);
}));

test("context: after a company switch `me` is fetched again, with the new token, and the new region is used", sandboxTest(async (sb) => {
  sb.write("d.yaml", "company: Beta Co\nworkspaces:\n  - name: Dev\n    webhooks:\n      - name: a\n      - name: b\n");
  sb.api.on("ME_QUERY", (v, call) =>
    call.headers.authorization === `Bearer ${FAKE_TOKEN}` ? ME() : ME([{ id: "r-2", name: "Beta Co", region: "us" }]),
  );
  sb.api.on("LIST_WORKSPACES_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  webhooks(sb);
  const r = await sb.run(["deploy", "d.yaml"], { env: { TEST_AXIOS_HEADERS: COOKIE("Bearer%20new-token-fake") } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(meCalls(sb).map((c) => c.headers.authorization), [`Bearer ${FAKE_TOKEN}`, "Bearer new-token-fake"]);
  assert.match(r.stdout, /URL: https:\/\/us\.connect\.aloma\.io\/event\/ka\n/);
}));

// ---------------------------------------------------------------- companies

test("context: company switch refuses an ambiguous company name and lists the ids", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME([{ id: "r-1", name: "Alpha Co" }, { id: "r-2", name: "Twin" }, { id: "r-3", name: "Twin" }]));
  const r = await sb.run(["company", "switch", "Twin"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'The company name "Twin" is ambiguous among your companies (ids: r-2, r-3). Use the id.\n');
  assert.deepEqual(sb.axiosCalls(), []);
}));

test("context: company switch refuses an unknown company and never sends it on", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME());
  // Flipped (Patrick, 28 Oct): "beta co" now matches "Beta Co"; an unknown name is still refused, with no hint.
  const r = await sb.run(["company", "switch", "gamma co"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'No company with the id or name "gamma co" among your companies.\n');
  assert.deepEqual(sb.axiosCalls(), []);
}));

test("context: company switch by id, then one workspace list to pick the default", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", ME());
  sb.api.on("LIST_WORKSPACES_QUERY", WS(["ws-first", "First"]));
  const r = await sb.run(["company", "switch", "r-2"], { env: { TEST_AXIOS_HEADERS: COOKIE("Bearer%20new-token-fake") } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(sb.axiosCalls()[0].url, "https://graphql.test.invalid/realm?realm=r-2");
  assert.deepEqual(sb.api.ops(), ["ME_QUERY", "LIST_WORKSPACES_QUERY"]);
  assert.equal(sb.readSession().selectedWorkspace, "ws-first");
}));

// ---------------------------------------------------------------- workspaces

const TWINS = WS(["ws-sel", "Dev Space"], ["ws-a", "Twin"], ["ws-b", "Twin"]);

test("context: -w <unknown> is refused and never sent on as an id", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", TWINS);
  sb.api.on("GET_WORKSPACE_QUERY", { getAutomationEnvironment: null });
  const r = await sb.run(["workspace", "show", "-w", "nope"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'No workspace with the id or name "nope" among your workspaces.\n');
  assert.deepEqual(sb.api.ops(), ["LIST_ENVIRONMENTS_QUERY"]);
}));

test("context: -w <ambiguous name> is refused with the ids, nothing else is requested", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", TWINS);
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  const r = await sb.run(["step", "list", "-w", "Twin"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'The workspace name "Twin" is ambiguous among your workspaces (ids: ws-a, ws-b). Use the id.\n');
  assert.deepEqual(sb.api.ops(), ["LIST_ENVIRONMENTS_QUERY"]);
}));

// Flipped (Patrick, 28 Oct): -w matches a name in any case when one workspace matches (was refused with a hint).
test("context: -w matches the exact name and a name in another case", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", TWINS);
  sb.api.on("LIST_WEBHOOKS_QUERY", { listAutomationWebhooks: [] });
  let r = await sb.run(["webhook", "list", "-w", "Dev Space"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(ops(sb).at(-1), ["LIST_WEBHOOKS_QUERY", { id: "ws-sel" }]);
  r = await sb.run(["webhook", "list", "-w", "dev space"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(ops(sb).at(-1), ["LIST_WEBHOOKS_QUERY", { id: "ws-sel" }]);
}));

test("context: --workspace-id bypasses the name lookup", sandboxTest(async (sb) => {
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  sb.api.on("LIST_ENVIRONMENTS_QUERY", TWINS);
  const r = await sb.run(["step", "list", "--workspace-id", "ws-b"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(sb.api.ops(), ["LIST_STEPS_QUERY"]);
  assert.equal(sb.api.calls[0].variables.id, "ws-b");
}));

test("context: --workspace-id on a command that takes the workspace as an argument", sandboxTest(async (sb) => {
  sb.api.on("GET_WORKSPACE_QUERY", { getAutomationEnvironment: { id: "ws-b", name: "Twin", archived: false } });
  sb.api.on("ARCHIVE_WORKSPACE_MUTATION", { archiveAutomationEnvironment: true });
  const r = await sb.run(["workspace", "archive", "--workspace-id", "ws-b"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(sb.api.ops(), ["GET_WORKSPACE_QUERY", "ARCHIVE_WORKSPACE_MUTATION"]);
  assert.equal(sb.api.calls[1].variables.id, "ws-b");
}));

test("context: -w and --workspace-id together are a usage error (exit 2)", sandboxTest(async (sb) => {
  const r = await sb.run(["step", "list", "-w", "Twin", "--workspace-id", "ws-b"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /either a workspace name or --workspace-id, not both/);
  assert.deepEqual(sb.api.calls, []);
}));

test("context: workspace switch refuses an ambiguous name (no first hit)", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", TWINS);
  const r = await sb.run(["workspace", "switch", "Twin"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'The workspace name "Twin" is ambiguous among your workspaces (ids: ws-a, ws-b). Use the id.\n');
  assert.equal(sb.readSession().selectedWorkspace, "ws-sel");
}));

test("context: commands take workspace helpers from the context module, not the workspace command module", () => {
  // deploy may still call the `workspace add` command itself (createWorkspace); nothing else comes from there.
  const dir = path.join(REPO, "src", "commands");
  const imported = {};
  for (const group of fs.readdirSync(dir).filter((g) => g !== "workspace" && fs.existsSync(path.join(dir, g, "index.js")))) {
    const text = fs.readFileSync(path.join(dir, group, "index.js"), "utf8");
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\.\/workspace\/index\.js"/g)) {
      imported[group] = m[1].split(",").map((n) => n.trim()).filter(Boolean);
    }
  }
  assert.deepEqual(imported, { deploy: ["createWorkspace"] });
});

// ---------------------------------------------------------------- deploy

test("context: deploy prints the workspace it resolved (name and id) before it acts", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    webhooks:\n      - name: a\n  - name: Fresh\n    webhooks:\n      - name: b\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("CREATE_WORKSPACE_MUTATION", { createAutomationEnvironment: { id: "ws-fresh" } });
  sb.api.on("ME_QUERY", ME());
  webhooks(sb);
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\nProcessing workspace: Dev\nTarget workspace: Dev \(ID: ws-1\)\n\nDeploying webhooks/);
  assert.match(r.stdout, /\nSwitched to workspace \[Fresh\]\nTarget workspace: Fresh \(ID: ws-fresh\)\n\nDeploying webhooks/);
}));

test("context: deploy refuses an ambiguous connector name and lists the ids", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    connectors:\n      - connectorName: Chat\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("LIST_AVAILABLE_CONNECTOR_QUERY", {
    listAutomationAvailableConnectors: [{ id: "m-1", name: "Chat" }, { id: "m-2", name: "Chat" }, { id: "m-3", name: "Chat v2" }],
  });
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: true });
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^The connector name "Chat" is ambiguous among the available connectors \(ids: m-1, m-2\)\. Use the id\.\n/);
  assert.ok(!sb.api.ops().includes("ADD_CONNECTOR_MUTATION"));
}));
