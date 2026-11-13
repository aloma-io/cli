// Regression tests for `aloma deploy <yaml>` (src/commands/deploy): the results table, the path refusals and
// the creation of a missing workspace. The empty-entry texts and the "Deployment failed" wording are not repeated here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandboxTest, gqlError } from "./helpers/cli-harness.js";

const ok = { validateAutomationIf: true };
const stepFile = (marker) =>
  `export const condition = { s: 1 };\n\nexport const content = async () => {\n  ${marker};\n};\n`;
const WS = (...names) => ({ listAutomationEnvironmentWithStats: names.map(([id, name]) => ({ id, name })) });
const storedStep = (id, name, cond, body) => ({ id, name, enabled: true, version: 3, content: { if: cond, do: body } });
// The part of stdout from the "Results:" heading on, as lines.
const table = (stdout) => {
  const at = stdout.indexOf("\nResults:\n");
  assert.ok(at >= 0, `no results table in: ${stdout}`);
  return stdout.slice(at + "\nResults:\n".length).split("\n");
};
const stepApi = (sb, { steps = [] } = {}) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: steps.map(({ id, name }) => ({ id, name })) });
  sb.api.on("GET_STEP_QUERY", (v) => ({ getAutomationStep: steps.find((x) => x.id === v.id) ?? null }));
  sb.api.on("VALIDATE_IF_QUERY", ok);
  sb.api.on("CREATE_STEP_MUTATION", { createAutomationStep: "s-new" });
  sb.api.on("SAVE_STEP_MUTATION", { saveAutomationStep: true });
};
const stepYaml = (...entries) =>
  ["workspaces:", "  - name: Dev", "    steps:", ...entries.flat()].join("\n");
const WEBHOOK_YAML = "workspaces:\n  - name: Dev\n    webhooks:\n      - name: hook\n";

// ---------------------------------------------------------------- table layout

test("deploy table: header, two-space indent and gaps, columns padded to the longest cell", sandboxTest(async (sb) => {
  sb.write("d.yaml", [
    "workspaces:", "  - name: Dev",
    "    webhooks:", "      - name: w",
    "    secrets:", "      - name: a-longer-name", "        value: not-a-token",
  ].join("\n"));
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  const r = await sb.run(["deploy", "d.yaml", "--dry-run"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(table(r.stdout).slice(0, 3), [
    "  KIND     NAME           RESULT",
    "  webhook  w              skipped (dry run)",
    "  secret   a-longer-name  skipped (dry run)",
  ]);
}));

test("deploy table: a column is at least four wide", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    tasks:\n      - name: t\n        data: {}\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  const r = await sb.run(["deploy", "d.yaml", "--dry-run"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(table(r.stdout).slice(0, 2), [
    "  KIND  NAME  RESULT",
    "  task  t     skipped (dry run)",
  ]);
}));

test("deploy table: one long name widens the NAME column of every row", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    webhooks:\n      - name: short\n      - name: a-rather-long-webhook-name\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  const r = await sb.run(["deploy", "d.yaml", "--dry-run"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(table(r.stdout).slice(0, 3), [
    "  KIND     NAME                        RESULT",
    "  webhook  short                       skipped (dry run)",
    "  webhook  a-rather-long-webhook-name  skipped (dry run)",
  ]);
}));

// ---------------------------------------------------------------- result labels

test("deploy table, --dry-run: created and updated read as would create / would update; a skipped row as skipped (dry run)", sandboxTest(async (sb) => {
  sb.write("one.js", stepFile("one()"));
  sb.write("two.js", stepFile("two()"));
  sb.write("d.yaml", stepYaml(
    ["      - name: fresh", "        file: one.js"],
    ["      - name: stored", "        file: two.js"],
  ) + "\n    webhooks:\n      - name: hook\n");
  stepApi(sb, { steps: [storedStep("s-1", "stored", "{ old: 1 }", "old();")] });
  const r = await sb.run(["deploy", "d.yaml", "--dry-run"]);
  assert.equal(r.code, 0, r.stderr);
  const lines = table(r.stdout);
  assert.ok(lines.includes("  step     fresh   would create"), lines.join("\n"));
  assert.ok(lines.includes("  step     stored  would update"), lines.join("\n"));
  assert.ok(lines.includes("  webhook  hook    skipped (dry run)"), lines.join("\n"));
  assert.ok(!sb.api.ops().some((op) => op.endsWith("_MUTATION")));
}));

const STEP_YAML = stepYaml(["      - name: one", "        file: s.js"]);
const STEP_ROW = (label) => `  step  one   ${label}`;
const HOOK_ROW = (label) => `  webhook  hook  ${label}`;
const labelCase = (label, { steps = [], yaml, row, setup, code = 0 }) =>
  test(`deploy table: without --dry-run a row reads ${label}`, sandboxTest(async (sb) => {
    sb.write("s.js", stepFile("s()"));
    sb.write("d.yaml", yaml);
    stepApi(sb, { steps });
    sb.api.on("CREATE_WEBHOOK_MUTATION", { createAutomationWebhook: { id: "wh-1" } });
    sb.api.on("LIST_WEBHOOKS_QUERY", { listAutomationWebhooks: [{ id: "wh-1", name: "hook", key: "k" }] });
    sb.api.on("ME_QUERY", { me: { realm: { region: null } } });
    setup?.(sb);
    const r = await sb.run(["deploy", "d.yaml"]);
    assert.equal(r.code, code, r.stderr);
    assert.equal(table(r.stdout)[1], row);
  }));
labelCase("created", { yaml: STEP_YAML, row: STEP_ROW("created") });
labelCase("updated", { yaml: STEP_YAML, row: STEP_ROW("updated"), steps: [storedStep("s-1", "one", "{ old: 1 }", "old();")] });
labelCase("unchanged", { yaml: STEP_YAML, row: STEP_ROW("unchanged"), steps: [storedStep("s-1", "one", "{\n  s: 1\n}", "s();")] });
labelCase("applied", { yaml: WEBHOOK_YAML, row: HOOK_ROW("applied") });
labelCase("failed", {
  yaml: WEBHOOK_YAML,
  row: HOOK_ROW("failed"),
  code: 1,
  setup: (sb) => sb.api.on("CREATE_WEBHOOK_MUTATION", gqlError("no licence")),
});

test("deploy table: sections that produce no rows print no Results heading", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Dev\n    steps: []\n    webhooks: []\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev"]));
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Results:/);
  assert.doesNotMatch(r.stdout, /KIND/);
  assert.match(r.stdout, /completed successfully/);
}));

// ---------------------------------------------------------------- one-line names

test("deploy table: a step name with a control character or a newline is shown on one line", sandboxTest(async (sb) => {
  sb.write("s.js", stepFile("s()"));
  sb.write("d.yaml", stepYaml(['      - name: "bad\\nname\\x01here"', "        file: s.js"]));
  stepApi(sb);
  const r = await sb.run(["deploy", "d.yaml", "--dry-run"]);
  assert.equal(r.code, 0, r.stderr);
  const rows = table(r.stdout);
  assert.deepEqual(rows.slice(0, 2), [
    "  KIND  NAME           RESULT",
    "  step  bad name here  would create",
  ]);
  assert.equal(rows[2], "");
}));

test("deploy: the target workspace line shows the name on one line", sandboxTest(async (sb) => {
  sb.write("d.yaml", 'workspaces:\n  - name: "Dev\\nSpace\\x01x"\n    webhooks: []\n');
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Dev\nSpace\u0001x"]));
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Target workspace: Dev Space x \(ID: ws-1\)$/m);
}));

// ---------------------------------------------------------------- path refusal

const MARK = "outside-marker";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const refused = (ref) => new RegExp(`^Path outside the folder of d\\.yaml is refused: ${escapeRe(ref)}$`, "m");
const createdNames = (sb) => sb.api.calls.filter((c) => c.op === "CREATE_STEP_MUTATION").map((c) => c.variables.name);

test("deploy: a step file that is absolute, climbs out with .., or links outside is refused; the others still deploy", sandboxTest(async (sb) => {
  const outside = sb.write("outside.js", stepFile(MARK));
  sb.write("proj/inner/in.js", stepFile("inside()"));
  fs.symlinkSync(outside, path.join(sb.work, "proj", "link.js"));
  sb.write("proj/d.yaml", stepYaml(
    ["      - name: abs", `        file: ${outside}`],
    ["      - name: up", "        file: ../outside.js"],
    ["      - name: lnk", "        file: link.js"],
    ["      - name: good", "        file: inner/in.js"],
  ));
  stepApi(sb);
  const r = await sb.run(["deploy", "proj/d.yaml"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, refused(outside));
  assert.match(r.stderr, refused("../outside.js"));
  assert.match(r.stderr, refused("link.js"));
  assert.match(r.stderr, /Deployment failed: 3 item\(s\) could not be deployed\.\n$/);
  const rows = table(r.stdout);
  for (const name of ["abs ", "up  ", "lnk "]) assert.ok(rows.includes(`  step  ${name}  failed`), rows.join("\n"));
  assert.ok(rows.includes("  step  good  created"), rows.join("\n"));
  assert.deepEqual(createdNames(sb), ["good"]);
  assert.ok(!JSON.stringify(sb.api.calls).includes(MARK));
}));

test("deploy: a syncPath that is absolute, climbs out with .., or links outside is refused under its own name; one inside deploys", sandboxTest(async (sb) => {
  const outside = sb.write("outdir/x.js", stepFile(MARK));
  const outDir = path.dirname(outside);
  sb.write("proj/sub/deep/in.js", stepFile("inside()"));
  fs.symlinkSync(outDir, path.join(sb.work, "proj", "linkdir"));
  sb.write("proj/d.yaml", stepYaml(
    [`      - syncPath: ${outDir}`],
    ["      - syncPath: ../outdir"],
    ["      - syncPath: linkdir"],
    ["      - syncPath: sub"],
  ));
  stepApi(sb);
  const r = await sb.run(["deploy", "proj/d.yaml"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, refused(outDir));
  assert.match(r.stderr, refused("../outdir"));
  assert.match(r.stderr, refused("linkdir"));
  const rows = table(r.stdout);
  for (const name of [outDir, "../outdir", "linkdir"]) {
    assert.ok(rows.some((l) => l.startsWith("  step  ") && l.includes(`  ${name}  `) && l.endsWith("  failed")), rows.join("\n"));
  }
  assert.ok(rows.some((l) => /^ {2}step +sub\/deep\/in +created$/.test(l) || /^ {2}step +deep\/in +created$/.test(l)), rows.join("\n"));
  assert.equal(createdNames(sb).length, 1);
  assert.ok(!JSON.stringify(sb.api.calls).includes(MARK));
}));

// ---------------------------------------------------------------- workspace creation

test("deploy: tags of a missing workspace are sent as one comma-joined list; an entry without tags sends none", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Tagged\n    tags: [x, y, z]\n  - name: Plain\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Other"]));
  sb.api.on("CREATE_WORKSPACE_MUTATION", (v) => ({ createAutomationEnvironment: { id: `id-${v.name}` } }));
  const r = await sb.run(["deploy", "d.yaml"]);
  assert.equal(r.code, 0, r.stderr);
  const creates = sb.api.calls.filter((c) => c.op === "CREATE_WORKSPACE_MUTATION").map((c) => c.variables);
  assert.deepEqual(creates, [
    { name: "Tagged", tags: ["x", "y", "z"] },
    { name: "Plain", tags: null },
  ]);
  const rows = table(r.stdout);
  assert.ok(rows.includes("  workspace  Tagged  created"), rows.join("\n"));
  assert.ok(rows.includes("  workspace  Plain   created"), rows.join("\n"));
}));

test("deploy --dry-run: a missing workspace is a would create row; nothing is created and no target is named", sandboxTest(async (sb) => {
  sb.write("d.yaml", "workspaces:\n  - name: Brand New\n    tags: [x]\n");
  sb.api.on("LIST_ENVIRONMENTS_QUERY", WS(["ws-1", "Other"]));
  const r = await sb.run(["deploy", "d.yaml", "--dry-run"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(table(r.stdout).slice(0, 2), [
    "  KIND       NAME       RESULT",
    "  workspace  Brand New  would create",
  ]);
  assert.doesNotMatch(r.stdout, /Target workspace/);
  assert.ok(!sb.api.ops().some((op) => op.endsWith("_MUTATION")));
}));
