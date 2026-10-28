// Characterisation tests for `aloma deploy <yaml>` (src/commands/deploy), which drives the
// other command groups from one YAML file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest, gqlError } from "./helpers/cli-harness.js";

const ops = (sb) => sb.api.calls.map((c) => [c.op, c.variables]);
const ok = { validateAutomationIf: true };
const stepFile = (cond, body) =>
  `export const condition = ${cond};\n\nexport const content = async () => {\n${body}\n};\n`;
const libFile = (types, body) =>
  `export const types = () => {\n  return \`${types}\`;\n};\n\nexport const content = () => {\n${body}\n};\n`;
const BANNER = "🚀 Starting deployment...\n\n";
const DONE = "\n✅ Deployment completed successfully!\n";
const WS = (...names) => ({ listAutomationEnvironmentWithStats: names.map(([id, name]) => ({ id, name })) });

test("deploy: a file without workspaces only prints the banners", sandboxTest(async (sb) => {
  sb.write("d.yaml", "version: 1\n");
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, BANNER + DONE);
  assert.deepEqual(sb.api.calls, []);
}));

test("deploy: existing workspace (matched by name) gets webhooks and secrets; an entry without a value fails the run", sandboxTest(async (sb) => {
  sb.write("d.yaml", [
    "workspaces:",
    "  - name: dev space",
    "    webhooks:",
    "      - name: orders",
    "    secrets:",
    "      - name: API_URL",
    "        value: https://example.invalid",
    "        description: base",
    "        encrypted: false",
    "      - name: NOVALUE",
    "      - name: EMPTY",
    "        value: ''",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev Space"]));
  sb.api.on("CREATE_WEBHOOK_MUTATION", { createAutomationWebhook: { id: "wh-1" } });
  sb.api.on("LIST_WEBHOOKS_QUERY", { listAutomationWebhooks: [{ id: "wh-1", name: "orders", key: "k1" }] });
  sb.api.on("ME_QUERY", { me: { realm: { region: null } } });
  sb.api.on("GET_SECRET_QUERY", { getAutomationEnvironmentConfig: {} });
  sb.api.on("SAVE_SECRET_MUTATION", { saveAutomationEnvironmentConfig: true });
  const r = await sb.run(["deploy", "d.yaml"]);
  // PLAT-81: the NOVALUE entry is a failed item: the others are still deployed, the run exits 1.
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^🚀 Starting deployment\.\.\.\n\n\nProcessing workspace: dev space\n/);
  assert.match(r.stdout, /Deploying webhooks\.\.\.\n {2}- orders\n/);
  assert.match(r.stdout, /Deploying secrets\.\.\.\n {2}- API_URL\n/);
  assert.match(r.stderr, /^Secret entry must have 'name' and 'value'\.\n/);
  assert.match(r.stdout, /Secret "EMPTY" added successfully/); // empty string is a value
  assert.doesNotMatch(r.stdout, /completed successfully/);
  assert.match(r.stderr, /\nDeployment failed: 1 item\(s\) could not be deployed\.\n$/);
  assert.equal(sb.api.calls.find((c) => c.op === "CREATE_WEBHOOK_MUTATION").variables.environmentId, "ws-1");
  const saves = sb.api.calls.filter((c) => c.op === "SAVE_SECRET_MUTATION");
  assert.equal(saves.length, 2);
  assert.equal(saves[0].variables.environmentId, "ws-1");
  assert.deepEqual(saves[0].variables.values.API_URL, { encrypted: false, value: "https://example.invalid", description: "base", options: {}, hasValue: true });
  assert.ok(!sb.api.ops().includes("CREATE_WORKSPACE_MUTATION"));
}));

test("deploy: missing workspace is created (tags joined) and becomes the target", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Fresh\n    tags: [a, b]\n    webhooks:\n      - name: hook\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Other"]));
  sb.api.on("CREATE_WORKSPACE_MUTATION", { createAutomationEnvironment: { id: "ws-fresh" } });
  sb.api.on("CREATE_WEBHOOK_MUTATION", { createAutomationWebhook: { id: "wh-1" } });
  sb.api.on("LIST_WEBHOOKS_QUERY", { listAutomationWebhooks: [{ id: "wh-1", name: "hook", key: "k" }] });
  sb.api.on("ME_QUERY", { me: { realm: { region: null } } });
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0);
  assert.deepEqual(sb.api.calls.find((c) => c.op === "CREATE_WORKSPACE_MUTATION").variables, { name: "Fresh", tags: ["a", "b"] });
  assert.equal(sb.api.calls.find((c) => c.op === "CREATE_WEBHOOK_MUTATION").variables.environmentId, "ws-fresh");
  assert.equal(sb.readSession().selectedWorkspace, "ws-fresh");
}));

test("deploy: when workspace creation fails the deployment stops (nothing goes to the selected workspace), exit 1", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Fresh\n    webhooks:\n      - name: hook\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Other"]));
  sb.api.on("CREATE_WORKSPACE_MUTATION", gqlError("quota"));
  sb.api.on("CREATE_WEBHOOK_MUTATION", { createAutomationWebhook: { id: "wh-1" } });
  sb.api.on("LIST_WEBHOOKS_QUERY", { listAutomationWebhooks: [] });
  const r = await sb.run(["deploy", "d.yaml"]);
  // PLAT-81: was exit 0 with the webhook deployed into the session's current workspace (ws-sel).
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Deployment failed: Error creating workspace: quota\n");
  assert.ok(!sb.api.ops().includes("CREATE_WEBHOOK_MUTATION"));
  assert.doesNotMatch(r.stdout, /completed successfully/);
}));

test("deploy: steps from name+file and from syncPath (no prompt)", sandboxTest(async (sb) => {
  sb.write("steps/one.js", stepFile("{ a: 1 }", "data.a = 2;"));
  sb.write("steps/sub/two.js", stepFile("{ b: 1 }", "data.b = 2;"));
  sb.write("single.js", stepFile("{ s: 1 }", "data.s = 2;"));
  sb.write("d.yaml", [
    "workspaces:", "  - name: Dev", "    steps:",
    "      - name: single-step", "        file: single.js", "        type: http",
    "      - syncPath: steps",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [] });
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /\(y\/N\)/); // syncPath deploys without asking
  assert.match(r.stdout, /Deploying steps\.\.\.\n {2}- single-step\nCreated step \[single-step\] with ID: s-new\n/);
  const creates = sb.api.calls.filter((c) => c.op === "CREATE_STEP_MUTATION").map((c) => c.variables);
  assert.deepEqual(creates.find((v) => v.name === "single-step"), { name: "single-step", environment_id: "ws-1", nocode_type: "http" });
  assert.deepEqual(creates.map((v) => v.name).sort(), ["one", "single-step", "sub/two"]);
  assert.match(r.stdout, /Updated: 0, Created: 2\n/);
}));

test("deploy: libraries — namespace defaults to the first path segment of the name", sandboxTest(async (sb) => {
  sb.write("lib.js", libFile("T", "  l();"));
  sb.write("libs/x.js", libFile("T", "  x();"));
  sb.write("d.yaml", [
    "workspaces:", "  - name: Dev", "    libraries:",
    "      - name: util/strings", "        file: lib.js", "        tags: [t1]",
    "      - name: explicit", "        namespace: ns1", "        file: lib.js",
    "      - syncPath: libs",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", { listAutomationLibs: [] });
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "l-new" });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0);
  const saves = sb.api.calls.filter((c) => c.op === "UPDATE_AUTOMATION_LIB_MUTATION").map((c) => c.variables);
  assert.equal(saves.length, 3);
  assert.deepEqual(saves.find((v) => v.name === "util/strings"), { id: "l-new", name: "util/strings", namespace: "util", content: "l();", types: "T", version: 0, tags: ["t1"], enabled: true });
  assert.equal(saves.find((v) => v.name === "explicit").namespace, "ns1");
  assert.equal(saves.find((v) => v.name === "x").namespace, "x");
  assert.match(r.stdout, /Updated: 0, Created: 1\n/);
}));

test("deploy: connectors by id, by name, with neither, and unknown name", sandboxTest(async (sb) => {
  sb.write("d.yaml", [
    "workspaces:", "  - name: Dev", "    connectors:",
    "      - connectorId: m-1", "        connectorName: Mailer", "        namespace: mail",
    "      - connectorName: Chat",
    "      - namespace: orphan",
    "      - connectorName: Ghost",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("LIST_AVAILABLE_CONNECTOR_QUERY", (v) => ({
    listAutomationAvailableConnectors: v.name === "Chat" ? [{ id: "m-2", name: "Chat" }] : [{ id: "m-x", name: "Something else" }],
  }));
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: true });
  const r = await sb.run(["deploy", "d.yaml"]);
  // PLAT-81: the entry with neither and the unknown name are failed items (were skipped silently, exit 0).
  assert.equal(r.code, 1);
  const adds = sb.api.calls.filter((c) => c.op === "ADD_CONNECTOR_MUTATION").map((c) => c.variables);
  // namespace of a connector found by name is lost: the available-connectors query does not return one
  assert.deepEqual(adds, [
    { id: "m-1", environmentId: "ws-1", name: "Mailer", namespace: "mail" },
    { id: "m-2", environmentId: "ws-1", name: "Chat" },
  ]);
  assert.match(r.stderr, /^No connectorId or connectorName provided for connector entry\.\n/m);
  assert.match(r.stdout, /Connector with name 'Ghost' not found in available connectors\./);
  assert.match(r.stderr, /^Connector 'Ghost' was not deployed: no available connector has that name\.\n/m);
  assert.match(r.stderr, /Deployment failed: 2 item\(s\) could not be deployed\.\n$/);
}));

test("deploy: a failing connector add is reported, the deploy goes on, and the run exits 1", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    connectors:\n      - connectorId: m-1\n        connectorName: Mailer\n    webhooks:\n      - name: after\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("ADD_CONNECTOR_MUTATION", gqlError("no licence"));
  sb.api.on("CREATE_WEBHOOK_MUTATION", { createAutomationWebhook: { id: "wh-1" } });
  sb.api.on("LIST_WEBHOOKS_QUERY", { listAutomationWebhooks: [{ id: "wh-1", name: "after", key: "k" }] });
  sb.api.on("ME_QUERY", { me: { realm: { region: null } } });
  const r = await sb.run(["deploy", "d.yaml"]);
  // PLAT-81: was dropped by an empty catch; the run ended "completed successfully" with exit code 0.
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error creating connector: no licence\n\nDeployment failed: 1 item(s) could not be deployed.\n");
  assert.ok(sb.api.ops().includes("CREATE_WEBHOOK_MUTATION"));
  assert.doesNotMatch(r.stdout, /completed successfully/);
}));

test("deploy: tasks are created with inline data or from a file", sandboxTest(async (sb) => {
  sb.write("t.json", '{"from":"file"}');
  sb.write("d.yaml", [
    "workspaces:", "  - name: Dev", "    tasks:",
    "      - name: inline", "        data:", "          a: 1",
    "      - name: fromfile", "        file: t.json",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("CREATE_TASK_MUTATION", { createAutomationTask: "t-new" });
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0);
  const tasks = sb.api.calls.filter((c) => c.op === "CREATE_TASK_MUTATION").map((c) => c.variables);
  assert.deepEqual(tasks, [
    { name: "inline", content: { a: 1 }, environment_id: "ws-1" },
    { name: "fromfile", content: { from: "file" }, environment_id: "ws-1" },
  ]);
}));

test("deploy: sections run in the order steps, libraries, webhooks, connectors, secrets, tasks", sandboxTest(async (sb) => {
  sb.write("s.js", stepFile("{ a: 1 }", "data.a = 2;"));
  sb.write("l.js", libFile("T", "  l();"));
  sb.write("d.yaml", [
    "workspaces:", "  - name: Dev",
    "    tasks:", "      - name: t", "        data: {}",
    "    secrets:", "      - name: S", "        value: v",
    "    connectors:", "      - connectorId: m-1", "        connectorName: C",
    "    webhooks:", "      - name: w",
    "    libraries:", "      - name: lib", "        file: l.js",
    "    steps:", "      - name: st", "        file: s.js",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s" });
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
  sb.api.on("ADD_AUTOMATION_LIB_MUTATION", { createAutomationLib: "l" });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { saveAutomationLib: true });
  sb.api.on("CREATE_WEBHOOK_MUTATION", { createAutomationWebhook: { id: "w" } });
  sb.api.on("LIST_WEBHOOKS_QUERY", { listAutomationWebhooks: [] });
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: true });
  sb.api.on("GET_SECRET_QUERY", { getAutomationEnvironmentConfig: {} });
  sb.api.on("SAVE_SECRET_MUTATION", { saveAutomationEnvironmentConfig: true });
  sb.api.on("CREATE_TASK_MUTATION", { createAutomationTask: "t" });
  await sb.run(["deploy", "d.yaml"]);
  const firsts = ["CREATE_STEP_MUTATION", "ADD_AUTOMATION_LIB_MUTATION", "CREATE_WEBHOOK_MUTATION", "ADD_CONNECTOR_MUTATION", "SAVE_SECRET_MUTATION", "CREATE_TASK_MUTATION"];
  const seq = sb.api.ops().filter((o) => firsts.includes(o));
  assert.deepEqual(seq, firsts);
}));

test("deploy company: switches company first (through the realm endpoint)", sandboxTest(async (sb) => {
  sb.write("d.yaml", "company: Beta Co\n");
  sb.api.on("ME_QUERY", { me: { realms: [{ id: "r-2", name: "Beta Co" }] } });
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^🚀 Starting deployment\.\.\.\n\nSwitching to company: Beta Co\nSuccessfully switched to company \[Beta Co\]\n/);
  assert.equal(sb.axiosCalls()[0].url, "https://graphql.test.invalid/realm?realm=r-2");
}));

test("deploy company: an unknown company stops the deployment before anything is deployed", sandboxTest(async (sb) => {
  sb.write("d.yaml", "company: Nope\nworkspaces:\n  - name: Dev\n    webhooks:\n      - name: w\n");
  sb.api.on("ME_QUERY", { me: { realms: [{ id: "r-2", name: "Beta Co" }], realm: {} } });
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("CREATE_WEBHOOK_MUTATION", { createAutomationWebhook: { id: "w" } });
  sb.api.on("LIST_WEBHOOKS_QUERY", { listAutomationWebhooks: [] });
  const r = await sb.run(["deploy", "d.yaml"]);
  // PLAT-81: was "Company not found", then the resources went into whatever company the session was in.
  assert.equal(r.stderr, "Deployment failed: Company not found\n");
  assert.ok(!sb.api.ops().includes("CREATE_WEBHOOK_MUTATION"));
  assert.ok(!sb.api.ops().includes("LIST_ENVIRONMENTS_QUERY"));
  assert.equal(r.code, 1);
}));

test("deploy: task and secret API failures exit 1 without the success banner", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    secrets:\n      - name: S\n        value: v\n    tasks:\n      - name: t\n        data: {}\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("GET_SECRET_QUERY", gqlError("denied"));
  sb.api.on("CREATE_TASK_MUTATION", gqlError("denied"));
  const r = await sb.run(["deploy", "d.yaml"]);
  // PLAT-81: was "completed successfully" and exit 0 although nothing was deployed.
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error adding secret: denied\nError creating task: denied\n\nDeployment failed: 2 item(s) could not be deployed.\n");
  assert.doesNotMatch(r.stdout, /completed successfully/);
}));

test("deploy: a webhook failure is reported, the other sections still run, exit 1", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    webhooks:\n      - name: w\n    tasks:\n      - name: t\n        data: {}\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("CREATE_WEBHOOK_MUTATION", gqlError("denied"));
  sb.api.on("CREATE_TASK_MUTATION", { createAutomationTask: "t" });
  const r = await sb.run(["deploy", "d.yaml"]);
  // PLAT-81: addWebhook called process.exit(1) itself, so the remaining sections never ran.
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error creating webhook: denied\n\nDeployment failed: 1 item(s) could not be deployed.\n");
  assert.ok(sb.api.ops().includes("CREATE_TASK_MUTATION"));
  assert.doesNotMatch(r.stdout, /Deployment completed/);
}));

test("deploy: a failure while looking up the workspace aborts with \"Deployment failed\"", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", gqlError("session expired"));
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Deployment failed: session expired/);
}));

test("deploy: missing file, invalid YAML and empty file all fail with exit code 1", sandboxTest(async (sb) => {
  let r = await sb.run(["deploy", "nope.yaml"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Deployment failed: ENOENT/);
  sb.write("bad.yaml", "a: [1\n");
  r = await sb.run(["deploy", "bad.yaml"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Deployment failed: /);
  sb.write("empty.yaml", "");
  r = await sb.run(["deploy", "empty.yaml"]);
  // PINS SUSPECT BEHAVIOUR: an empty file is a TypeError ("reading 'company'") rather than a friendly message.
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Deployment failed: Cannot read properties of undefined \(reading 'company'\)/);
  assert.deepEqual(sb.api.calls, []);
}));

test("deploy: the yaml path argument is required", sandboxTest(async (sb) => {
  const r = await sb.run(["deploy"]);
  // PLAT-81: a usage error exits 2 (was commander's 1).
  assert.equal(r.code, 2);
  assert.match(r.stderr, /missing required argument 'yamlPath'/);
}));
