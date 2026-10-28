// PLAT-116, Patrick's case rule (28 Oct): one rule for every name the CLI resolves (workspace, company,
// connector, step, library), in src/names.js. An exact id wins. Otherwise names match regardless of case:
// exactly one match is used; more than one is refused with the names and ids listed ("use the id");
// none is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxTest } from "./helpers/cli-harness.js";
import { resolveByIdOrName, uniqueByName, assertNameFree } from "../src/names.js";
import { CliError } from "../src/runtime.js";

// Every kind gets the same four cases from items shaped like this: a mixed-case name, two names that
// differ only in case, and an item whose name differs from another item's id only in case.
const items = (p) => [
  { id: `${p}-1`, name: "Mixed Case" },
  { id: `${p}-2`, name: "Pair" },
  { id: `${p}-3`, name: "pair" },
  { id: `${p}-4`, name: "Odd" },
  { id: `${p}-5`, name: `${p.toUpperCase()}-4` },
];

function assertCaseAmbiguous(r, kind, p) {
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, new RegExp(`The ${kind} name "PAIR" is ambiguous`));
  assert.match(r.stderr, new RegExp(`ids: ${p}-2 "Pair", ${p}-3 "pair"\\)\\. Use the id\\.`));
}

// ---------------------------------------------------------------- the rule itself (src/names.js)

test("names: a different-case name with one match resolves", () => {
  assert.equal(resolveByIdOrName(items("x"), "mixed CASE", "step").id, "x-1");
  assert.equal(uniqueByName(items("x"), "ODD", "step").id, "x-4");
});

test("names: two items that differ only in case are refused, names and ids listed", () => {
  assert.throws(
    () => resolveByIdOrName(items("x"), "PAIR", "step"),
    (e) =>
      e instanceof CliError &&
      e.message === 'The step name "PAIR" is ambiguous in this workspace (ids: x-2 "Pair", x-3 "pair"). Use the id.',
  );
  assert.throws(() => uniqueByName(items("x"), "pair", "step"), /ids: x-2 "Pair", x-3 "pair"/);
});

test("names: an exact id wins over a name that matches it in another case", () => {
  assert.equal(resolveByIdOrName(items("x"), "x-4", "step").id, "x-4");
  // ...and over an exact name match
  assert.equal(resolveByIdOrName([{ id: "a", name: "b" }, { id: "b", name: "c" }], "b", "step").id, "b");
});

test("names: no match is refused", () => {
  assert.throws(
    () => resolveByIdOrName(items("x"), "nope", "step"),
    (e) => e instanceof CliError && e.message === 'No step with the id or name "nope" in this workspace.',
  );
  assert.equal(uniqueByName(items("x"), "nope", "step"), null);
});

test("names: a new name that matches a taken one in another case is refused", () => {
  assert.throws(() => assertNameFree(items("x"), "odd", "step"), /A step named "odd" already exists in this workspace \(id: x-4\)/);
  assert.doesNotThrow(() => assertNameFree(items("x"), "fresh", "step"));
});

// ---------------------------------------------------------------- steps

const mockSteps = (sb) => {
  const steps = items("s").map((s) => ({ ...s, enabled: true, version: 1, content: { if: "{}", do: "a();" } }));
  sb.api.on("LIST_STEPS_QUERY", (v) => ({ listAutomationSteps: v.id === "ws-sel" ? steps.map(({ id, name }) => ({ id, name })) : [] }));
  sb.api.on("GET_STEP_QUERY", (v) => ({ getAutomationStep: steps.find((s) => s.id === v.id) ?? null }));
};
const fetched = (sb, op) => sb.api.calls.filter((c) => c.op === op).map((c) => c.variables.id);

test("case rule, step: other case resolves; case twins refused; id wins; no match refused", sandboxTest(async (sb) => {
  mockSteps(sb);
  let r = await sb.run(["step", "show", "mixed case"]);
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run(["step", "show", "PAIR"]);
  assertCaseAmbiguous(r, "step", "s");
  r = await sb.run(["step", "show", "s-4"]);
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run(["step", "show", "nope"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No step with the id or name "nope" in this workspace\.\n/);
  assert.deepEqual(fetched(sb, "GET_STEP_QUERY"), ["s-1", "s-4"]);
}));

test("case rule, step pull (all): case twins are not pulled (one file each) and are reported once", sandboxTest(async (sb) => {
  mockSteps(sb);
  const r = await sb.run(["step", "pull", "-p", "out"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.match(/is ambiguous/g).length, 1);
  assert.deepEqual(sb.list("out").sort(), ["Mixed Case.js", "Odd.js", "S-4.js"]);
}));

// ---------------------------------------------------------------- libraries

test("case rule, library: other case resolves; case twins refused; id wins; no match refused", sandboxTest(async (sb) => {
  const libs = items("l").map((l) => ({ ...l, namespace: "ns", enabled: true, version: 1, tags: [], types: "T", content: { content: "a();" } }));
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", (v) => ({ listAutomationLibs: v.id === "ws-sel" ? libs.map(({ id, name }) => ({ id, name })) : [] }));
  sb.api.on("GET_AUTOMATION_LIB_QUERY", (v) => ({ getAutomationLib: libs.find((l) => l.id === v.id) ?? null }));
  let r = await sb.run(["library", "show", "MIXED case"]);
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run(["library", "show", "PAIR"]);
  assertCaseAmbiguous(r, "library", "l");
  r = await sb.run(["library", "show", "l-4"]);
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run(["library", "show", "nope"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No library with the id or name "nope" in this workspace\.\n/);
  assert.deepEqual(fetched(sb, "GET_AUTOMATION_LIB_QUERY"), ["l-1", "l-4"]);
}));

// ---------------------------------------------------------------- workspaces

const WS = { listAutomationEnvironmentWithStats: items("w") };

test("case rule, workspace -w: other case resolves; case twins refused; id wins; no match refused", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS);
  sb.api.on("LIST_WEBHOOKS_QUERY", { listAutomationWebhooks: [] });
  let r = await sb.run(["webhook", "list", "-w", "mixed case"]);
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run(["webhook", "list", "-w", "PAIR"]);
  assertCaseAmbiguous(r, "workspace", "w");
  r = await sb.run(["webhook", "list", "-w", "w-4"]);
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run(["webhook", "list", "-w", "nope"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'No workspace with the id or name "nope" among your workspaces.\n');
  assert.deepEqual(fetched(sb, "LIST_WEBHOOKS_QUERY"), ["w-1", "w-4"]);
}));

test("case rule, workspace switch: other case resolves; case twins refused; id wins; no match refused", sandboxTest(async (sb) => {
  sb.api.on("LIST_WORKSPACES_QUERY", WS);
  let r = await sb.run(["workspace", "switch", "MIXED CASE"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(sb.readSession().selectedWorkspace, "w-1");
  r = await sb.run(["workspace", "switch", "PAIR"]);
  assertCaseAmbiguous(r, "workspace", "w");
  r = await sb.run(["workspace", "switch", "w-4"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(sb.readSession().selectedWorkspace, "w-4");
  r = await sb.run(["workspace", "switch", "nope"]);
  assert.equal(r.code, 1);
  assert.equal(sb.readSession().selectedWorkspace, "w-4");
}));

test("case rule, deploy workspace: other case uses it (no duplicate); case twins stop the deployment", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS);
  sb.api.on("CREATE_WORKSPACE_MUTATION", { createAutomationEnvironment: { id: "w-new" } });
  sb.write("one.yaml", "workspaces:\n  - name: mixed case\n");
  let r = await sb.run(["deploy", "one.yaml"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Target workspace: Mixed Case \(ID: w-1\)\n/);
  sb.write("two.yaml", "workspaces:\n  - name: PAIR\n");
  r = await sb.run(["deploy", "two.yaml"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^Deployment failed: The workspace name "PAIR" is ambiguous among your workspaces \(ids: w-2 "Pair", w-3 "pair"\)\. Use the id\.\n/);
  assert.ok(!sb.api.ops().includes("CREATE_WORKSPACE_MUTATION"));
}));

// ---------------------------------------------------------------- companies

test("case rule, company switch: other case resolves; case twins refused; id wins; no match refused", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", { me: { id: "u-1", groups: [], realm: { id: "c-9", name: "Home" }, realms: items("c") } });
  sb.api.on("LIST_WORKSPACES_QUERY", { listAutomationEnvironmentWithStats: [{ id: "ws-first", name: "First" }] });
  const env = { TEST_AXIOS_HEADERS: JSON.stringify({ "set-cookie": ["Authorization=Bearer%20new-token-fake; Path=/"] }) };
  let r = await sb.run(["company", "switch", "mixed case"], { env });
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run(["company", "switch", "PAIR"], { env });
  assertCaseAmbiguous(r, "company", "c");
  r = await sb.run(["company", "switch", "c-4"], { env });
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run(["company", "switch", "nope"], { env });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'No company with the id or name "nope" among your companies.\n');
  assert.deepEqual(sb.axiosCalls().map((c) => c.url.split("realm=")[1]), ["c-1", "c-4"]);
}));

// ---------------------------------------------------------------- connectors

test("case rule, deploy connector: other case resolves; case twins refused; id wins; no match refused", sandboxTest(async (sb) => {
  sb.write("d.yaml", [
    "workspaces:", "  - name: Dev", "    connectors:",
    "      - connectorName: mixed case", "      - connectorName: PAIR",
    "      - connectorName: m-4", "      - connectorName: nope",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", { listAutomationEnvironmentWithStats: [{ id: "ws-1", name: "Dev" }] });
  sb.api.on("LIST_AVAILABLE_CONNECTOR_QUERY", { listAutomationAvailableConnectors: items("m") });
  sb.api.on("ADD_CONNECTOR_MUTATION", { addAutomationMarketConnectorToEnvironment: true });
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 1);
  assert.deepEqual(sb.api.calls.filter((c) => c.op === "ADD_CONNECTOR_MUTATION").map((c) => c.variables.id), ["m-1", "m-4"]);
  assertCaseAmbiguous(r, "connector", "m");
  assert.match(r.stderr, /No connector with the id or name "nope" among the available connectors\.\n/);
  assert.match(r.stderr, /Deployment failed: 2 item\(s\) could not be deployed\.\n$/);
}));
