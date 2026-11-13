#!/usr/bin/env node
// Mutation check for the command regression tests.
//
// Applies ONE single-point change at a time to the command code under src/, runs the test file(s)
// that should notice it, and records whether the suite failed (mutant "killed") or stayed green
// ("survived"). The original file is restored after every mutant, even on a crash.
//
//   node tests/helpers/run-mutations.mjs            # run all, print a table
//   node tests/helpers/run-mutations.mjs --md       # ... and print it as markdown
//   node tests/helpers/run-mutations.mjs M03 M07    # only these ids
//   node tests/helpers/run-mutations.mjs --check-apply   # every break must still apply; writes nothing, runs no test
//   ... --root <dir> reads from another copy of the repo; --check-apply --list prints the id/file/old-text entries
//
// Notes (PLAT-236): every pattern below matches today's code, and a run reports every mutant as killed.
// - Step and library pull / sync / ensure live in src/resources/ (engine.js, step.js, library.js); the
//   workspace and company lookups in src/context.js; the HTTP client in src/http.js. The ids kept their meaning.
// - The tests-expected column is a group name (the commands-<group>*.test.js files) or, when it starts with
//   "tests/", a comma-separated list of test files (E14 runs the logout tests).
// - M18 and M34 change the same line (the default namespace of a library); they differ in which tests must notice.
// - N09 to N12 change shared code, so they run the names tests, which cover steps and libraries.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyBreak, checkBreak, parseArgsOrExit, repoRoot, selectIds } from "./apply-check.mjs";

const args = parseArgsOrExit(process.argv.slice(2));
const REPO = repoRoot(args.root, path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
const W = "src/commands/workspace/index.js";
const S = "src/commands/step/index.js";
const L = "src/commands/library/index.js";
const T = "src/commands/task/index.js";
const WH = "src/commands/webhook/index.js";
const SE = "src/commands/secret/index.js";
const U = "src/commands/user/index.js";
const UU = "src/commands/user/utils.js";
const C = "src/commands/company/index.js";
const CO = "src/commands/connector/index.js";
const D = "src/commands/deploy/index.js";
const SEL = "src/ui/select.js";
const UT = "src/utils.js";
const RT = "src/runtime.js";
const A = "src/commands/auth/index.js";
const N = "src/names.js";
const CTX = "src/context.js";
const HT = "src/http.js";
const ENG = "src/resources/engine.js";
const RS = "src/resources/step.js";
const RL = "src/resources/library.js";

// [id, file, find (must occur exactly once), replace, tests expected to catch it, description]
export const MUTATIONS = [
  ["M01", W, "name: name.trim(),\n      tags: workspaceTag,", "name: name,\n      tags: workspaceTag,", "workspace", "workspace add no longer trims the name"],
  ["M02", W, "        id: workspaceId,\n        delete: true,", "        id: workspaceId,\n        delete: false,", "workspace", "workspace delete sends delete=false"],
  ["M03", W, "        id: workspaceId,\n        archive: true,", "        id: workspaceId,\n        archive: false,", "workspace", "workspace archive sends archive=false"],
  ["M04", CTX, "  return pickWorkspace(data?.listAutomationEnvironmentWithStats ?? [], ref);", "  return { id: ref, name: null };", "workspace", "-w <name> no longer resolved to the id"],
  ["M05", W, "          : ws.tags || [],", "          : [],", "workspace", "workspace update drops existing tags"],
  ["M06", W, "      source_do_sync: true,", "      source_do_sync: false,", "workspace", "workspace sync no longer sets source_do_sync"],
  ["M07", CTX, "    selectedWorkspaceId = selectedWorkspace;\n    return selectedWorkspace;", "    selectedWorkspaceId = selectedWorkspace;\n    return null;", "workspace", "selected workspace is never read back from the session"],
  ["M08", W, 'options.healthEnabled.toLowerCase() === "true"', 'options.healthEnabled.toLowerCase() !== "true"', "workspace", "workspace update --health-enabled inverted"],
  ["M09", W, "? parseInt(options.days)\n            : undefined;", "? options.days\n            : undefined;", "workspace", "workspace delete --days sent as a string"],
  ["M10", S, "          nocode_content: null,\n          config_content: null,\n        });\n\n        if (updateData.saveAutomationStep) {", "          nocode_content: null,\n          config_content: null,\n          enabled: false,\n        });\n\n        if (updateData.saveAutomationStep) {", "step", "step add -f saves the step disabled"],
  ["M11", S, "      environment_id: workspaceId, // TODO: remove this", "      environment_id: stepId, // TODO: remove this", "step", "step delete sends the step id as the workspace"],
  ["M12", ENG, "    !(await confirm(\n      `Are you sure you want to overwrite the ${desc.kind}", "    (await confirm(\n      `Are you sure you want to overwrite the ${desc.kind}", "step", "step sync -s: confirmation inverted"],
  ["M13", ENG, "name: relPath.replace(/\\\\/g, \"/\").replace(/\\.js$/, \"\"),", "name: relPath.replace(/\\\\/g, \"/\"),", "step", "step sync keeps the .js extension in the step name"],
  ["M14", RS, "      includeDisabled: true,\n    });\n    return data.listAutomationSteps || [];", "      includeDisabled: false,\n    });\n    return data.listAutomationSteps || [];", "step", "step pull skips disabled steps"],
  ["M15", RS, "filePath: (name, folder) => pullTargetFile(name, folder, \"step\"),", "filePath: (name, folder) => pullTargetFile(name.split(\"/\").pop(), folder, \"step\"),", "step", "step pull flattens nested step names"],
  ["M16", RL, "    version: 0,\n    tags: [],\n    enabled: true,\n  }),", "    version: 1,\n    tags: [],\n    enabled: true,\n  }),", "library", "library add -f saves with version 1"],
  ["M17", RL, "contentStr = statements.join(\"\\n\");", "contentStr = statements.join(\" \");", "library", "library parser joins statements with a space"],
  ["M18", RL, "export const defaultNamespace = (name) => name.split(\"/\")[0] || \"default\";", "export const defaultNamespace = (name) => name.split(\"/\")[1] || \"default\";", "library", "library sync derives the namespace from the wrong segment"],
  ["M19", L, "const newEnabled = enabled !== null ? enabled : currentLibrary.enabled;", "const newEnabled = enabled !== null ? currentLibrary.enabled : enabled;", "library", "library update ignores --enabled"],
  ["M20", T, "const offset = (page - 1) * limit;", "const offset = page * limit;", "task", "task list pages off by one"],
  ["M21", T, "if (!isNaN(stepIdx) && stepIdx >= 0 && stepIdx < normalized.length) {\n        const stepId", "if (!isNaN(stepIdx) && stepIdx >= 0 && stepIdx <= normalized.length) {\n        const stepId", "task", "task clone --step accepts one index too many"],
  ["M22", T, 'if (ext === ".json") {', 'if (ext === ".jsn") {', "task", "task new -f no longer reads .json files"],
  ["M23", WH, 'throw failure("Error listing webhooks:", error);', "console.error(error.message);", "webhook-secret", "webhook list exits 0 on error"],
  ["M24", WH, "console.log(`URL: ${webhookUrl + webhook.key}`);\n    });", "console.log(`URL: ${webhookUrl}`);\n    });", "webhook-secret", "webhook list prints the URL without the key"],
  ["M25", SE, "    delete config[secretName];", "    // delete config[secretName];", "webhook-secret", "secret delete keeps the secret"],
  ["M26", SE, "      encrypted: encrypted,", "      encrypted: false,", "webhook-secret", "secret add ignores --encrypted"],
  ["M39", SE, 'import yaml from "js-yaml";\n', "", "webhook", "secret add --options: the YAML parser import is removed"],
  ["M27", UU, '  admin: ["admin"],', "  admin: [],", "company-user", "admin role no longer adds the admin group"],
  ["M28", U, 'g === "admin" || g === "owner"', 'g === "admin"', "company-user", "owners can no longer manage users"],
  ["M29", C, "currentCompany === realm.id", "currentCompany !== realm.id", "company-user", "company list marks the wrong company"],
  ["M30", C, '.replace("Bearer%20", "");', ";", "company-user", "company switch stores the token with its Bearer%20 prefix"],
  ["M31", CO, "connectorName = fileContent.name || connectorName;", "connectorName = connectorName || fileContent.name;", "connector", "connector update: flag beats file for the name"],
  ["M32", CO, "            audience: marketId,", '            audience: "connector",', "connector", "connector config encrypted for the wrong audience"],
  ["M33", CO, "      mine: false,\n      name: filterName || \"\",", "      mine: true,\n      name: filterName || \"\",", "connector", "connector list-available asks only for my connectors"],
  ["M34", RL, "export const defaultNamespace = (name) => name.split(\"/\")[0] || \"default\";", "export const defaultNamespace = (name) => name.split(\"/\")[1] || \"default\";", "deploy", "deploy library namespace from the wrong segment"],
  ["M35", D, "          const results = await ensureFolder(\n            desc,", "          await (await import(\"../../confirm.js\")).confirm(\"Overwrite? (y/N): \");\n          const results = await ensureFolder(\n            desc,", "deploy", "deploy syncPath asks for confirmation"],
  ["M36", HT, "  Authorization: `Bearer ${token}`,\n  Cookie:", "  Authorization: `Token ${token}`,\n  Cookie:", "cli", "requests send the wrong Authorization scheme"],
  ["M37", HT, "  if (data.errors) {", "  if (data.errors && false) {", "workspace", "GraphQL errors are ignored"],
  ["M38", L, 'const enabled = options.enabled === "true";\n          const tags', 'const enabled = options.enabled !== "true";\n          const tags', "library", "library add --enabled inverted"],
  // PLAT-81: the exit-code rule (tests/commands-exit-codes.test.js). Each mutant removes the wrapper's
  // non-zero exit, prints twice, or lets one command group swallow its error again.
  ["E01", RT, "process.exitCode =\n      error instanceof CliError ? error.exitCode : EXIT_FAILURE;", "process.exitCode = 0;", "exit-codes", "runtime: a failed command exits 0"],
  ["E02", RT, "process.exit(err.exitCode === 0 ? 0 : EXIT_USAGE);", "process.exit(err.exitCode === 0 ? 0 : EXIT_FAILURE);", "exit-codes", "runtime: usage errors exit 1 instead of 2"],
  ["E03", RT, "if (process.env.DEBUG && error?.stack) {", "if (error?.stack) {", "exit-codes", "runtime: the stack trace is printed without DEBUG"],
  ["E04", UT, 'error.prefix = "GraphQL Error:";', 'error.prefix = "GraphQL Error:";\n    console.error("GraphQL Error:", error.message);', "exit-codes", "graphQuery prints the error itself again (printed twice)"],
  ["E05", CTX, "throw new CliError(\n        \"No workspace selected. Use `aloma workspace switch` to select one.\",\n      );", "console.log(\n        \"No workspace selected. Use `aloma workspace switch` to select one.\",\n      );\n      return { id: null, name: null };", "exit-codes", "workspace: no selected workspace is a message, exit 0"],
  ["E06", C, "throw failure(\"Error switching company:\", error);", "console.error(error.message);", "company-user", "company: switch swallows its error (an unknown company exits 0)"],
  ["E07", S, 'throw failure("Error fetching steps:", error);', "console.error(error.message);", "exit-codes", "step: list swallows its error"],
  ["E08", L, 'throw failure("Error fetching libraries:", error);', "console.error(error.message);", "exit-codes", "library: list swallows its error"],
  ["E09", T, 'throw failure("Error listing tasks:", error);', "console.error(error.message);", "exit-codes", "task: list swallows its error"],
  ["E10", WH, 'throw failure("Error showing webhook:", error);', "console.error(error.message);", "exit-codes", "webhook: show swallows its error"],
  ["E11", SE, 'throw failure("Error fetching secrets:", error);', "console.error(error.message);", "exit-codes", "secret: list swallows its error"],
  ["E12", CO, 'throw failure("Error starting OAuth process:", error);', "console.error(error.message);", "exit-codes", "connector: oauth swallows its error"],
  ["E13", U, "throw new CliError(`Error: Only administrators or owners can ${action}`);", "console.error(`Error: Only administrators or owners can ${action}`);", "exit-codes", "user: a refused permission is only printed"],
  ["E14", A, 'throw failure("❌ Failed to clear session data:", error);', "console.error(error.message);\n      return false;", "tests/auth-logout.test.js", "auth: logout swallows a failed session removal"],
  ["E15", D, "    failed++;\n    reportError(error);\n    rows.push", "    reportError(error);\n    rows.push", "deploy", "deploy: failed items are not counted (success banner, exit 0)"],
  ["E16", T, 'throw new UsageError("⚠ No data provided");', 'throw new CliError("⚠ No data provided");', "exit-codes", "task: missing data is an operation failure (exit 1), not a usage error"],
  // PLAT-81: empty-result wording of the two connector listings (tests/commands-connector.test.js).
  ["C01", CO, 'chalk.yellow("This workspace has no connectors.")', 'chalk.yellow("No available connector types found.")', "connector", "connector list prints the available-types wording when empty"],
  ["C02", CO, 'chalk.yellow("No available connector types found.")', 'chalk.yellow("This workspace has no connectors.")', "connector", "connector list-available prints the workspace wording when empty"],
  ["E17", U, "      throw new UsageError(error.message);\n    }\n\n    await graphQuery(UPDATE_COMPANY_MEMBER_MUTATION", "      throw new CliError(error.message);\n    }\n\n    await graphQuery(UPDATE_COMPANY_MEMBER_MUTATION", "exit-codes", "user: an invalid role exits 1, not 2"],
  // PLAT-115: one resolver for step and library names (tests/commands-names.test.js). Each mutant puts back
  // first-hit, the raw-name-as-id fall-through, or an add without the uniqueness check.
  ["N01", N, "  if (matches.length > 1) {\n    throw new CliError(\n      `The ${kind} name", "  if (false) {\n    throw new CliError(\n      `The ${kind} name", "names", "resolver: first name match wins (ambiguity not refused)"],
  ["N02", N, "  if (byName) return byName;\n  throw new CliError(", "  if (byName) return byName;\n  return { id: ref };\n  throw new CliError(", "names", "resolver: an unknown name is passed on as an id"],
  ["N03", N, "  if (byId) return byId;\n", "", "names", "resolver: an exact id is no longer tried first"],
  ["N04", S, '    assertNameFree(await listWorkspaceSteps(workspaceId), name.trim(), "step");\n', "", "names", "step add without the uniqueness check"],
  ["N05", L, '    assertNameFree(\n      await listWorkspaceLibraries(workspaceId),\n      name.trim(),\n      "library",\n    );\n', "", "names", "library add without the uniqueness check"],
  ["N06", S, '    assertNameFree(\n      await listWorkspaceSteps(workspaceId),\n      sourceStep.name,\n      "step",\n    );\n', "", "names", "step clone without the uniqueness check in the target"],
  ["N07", S, '  return resolveByIdOrName(await listWorkspaceSteps(workspaceId), ref, "step")\n    .id;', "  return ref;", "names", "step commands send the raw name on as the id"],
  ["N08", L, '  return resolveByIdOrName(\n    await listWorkspaceLibraries(workspaceId),\n    ref,\n    "library",\n  ).id;', "  return ref;", "names", "library commands send the raw name on as the id"],
  ["N09", ENG, "existing = uniqueByName(all, desc.key(desired), desc.kind);", "existing = all.find((i) => i.name === desc.key(desired)) ?? null;", "names", "step sync (all): first name match wins"],
  ["N10", ENG, "existing = uniqueByName(all, desc.key(desired), desc.kind);", "existing = all.find((i) => i.name === desc.key(desired)) ?? null;", "names", "library sync (all): first name match wins"],
  ["N11", ENG, "        uniqueByName(items, summary.name, desc.kind);\n", "", "names", "step pull (all): same-named steps overwrite each other again"],
  ["N12", ENG, "        uniqueByName(items, summary.name, desc.kind);\n", "", "names", "library pull (all): same-named libraries overwrite each other again"],
  // PLAT-298: connector add without --name takes the name from the catalogue (tests/commands-connector.test.js).
  ["A01", CO, "const catalogue = await graphQuery(LIST_AVAILABLE_CONNECTOR_QUERY, {", "const catalogue = await graphQuery(GET_CONNECTOR_QUERY, {", "connector", "connector add without --name looks the id up in the workspace again"],
  ["A02", CO, "list.find((entry) => entry?.id === connectorId)", "list.find((entry) => entry?.name === connectorId)", "connector", "catalogue lookup matches by name instead of id"],
  ["A03", CO, '      if (!entry) {\n        throw new CliError("Error: Connector not found");\n      }\n\n      connectorName = entry.name;', '      connectorName = entry?.name ?? connectorId;', "connector", "connector add: an id not in the catalogue is still added"],
  ["A04", CO, "      name: connectorName,\n      namespace,\n    });", "      name: connectorName,\n    });", "connector", "connector add drops the --namespace value"],
  // PLAT-119: the shared picker puts the terminal back on every way out (tests/ui-select.test.js). This
  // mutant lets a cancel leave raw mode on and the input running.
  ["P01", SEL, 'finish(reject, new CliError("\\nSelection cancelled."));', 'finished = true;\n          reject(new CliError("\\nSelection cancelled."));', "ui-select", "picker: a cancel leaves raw mode on"],
  // PLAT-81 (row 1.01, slice 8): the shared helpers' remaining branches (tests/regression-shared-helpers.test.js).
  ["G01", "src/pull-safety.js", "process.platform === \"win32\" && /[:<>\"|?*]/.test(seg)", "/[:<>\"|?*]/.test(seg)", "tests/regression-shared-helpers.test.js", "a name part with characters Windows refuses is refused on every platform"],
  ["G02", "src/pull-safety.js", ".replace(/[\\r\\n\\u2028\\u2029]+/g, \" \");", ".replace(/[\\r\\n]+/g, \" \");", "tests/regression-shared-helpers.test.js", "headerText leaves U+2028 and U+2029 in the header"],
  ["G03", "src/runtime.js", "console.error(error.cause?.stack ?? error.stack);", "console.error(error.stack);", "tests/regression-shared-helpers.test.js", "reportError prints the error's own stack and not the cause's"],
  ["G04", "src/http.js", "error.cause?.message ?? error.message", "error.message", "tests/regression-shared-helpers.test.js", "a failed fetch reports the error's message, not the cause's"],
  ["G05", "src/paths.js", "if ((st.mode & 0o077) !== 0) await fs.chmod(file, mode);", "await fs.chmod(file, mode);", "tests/regression-shared-helpers.test.js", "tighten changes the mode even when no group or other bits are set"],
  ["G06", "src/context.js", "    data?.listAutomationEnvironmentWithStats ?? [],\n    name,", "    data.listAutomationEnvironmentWithStats,\n    name,", "tests/regression-shared-helpers.test.js", "findWorkspaceByName throws when the answer has no list"],
];

if (args.flags.includes("--check-apply")) {
  if (args.flags.includes("--list")) {
    console.log(JSON.stringify(MUTATIONS.map(([id, file, find]) => ({ id, file, find }))));
    process.exit(0);
  }
  let bad = 0;
  const { selected, unknown } = selectIds(args.ids, MUTATIONS.map(([id]) => id));
  const list = MUTATIONS.filter(([id]) => selected.includes(id));
  for (const id of unknown) console.log(`unknown id ${id}`);
  for (const [id, file, find, replace] of list) {
    const problem = checkBreak(REPO, { id, file, find, replace });
    if (problem) {
      bad++;
      console.log(problem);
    }
  }
  console.log(`checked ${list.length} mutants, ${bad} do not apply`);
  process.exit(bad > 0 || unknown.length > 0 || list.length === 0 ? 1 : 0);
}

const only = args.ids;
const wantMd = args.flags.includes("--md");
const results = [];

for (const [id, file, find, replace, group, desc] of MUTATIONS) {
  if (only.length && !only.includes(id)) continue;
  const abs = path.join(REPO, file);
  const original = fs.readFileSync(abs, "utf8");
  const count = original.split(find).length - 1;
  if (count !== 1) {
    results.push({ id, file, desc, status: `INVALID (pattern found ${count}x)`, failed: [] });
    continue;
  }
  try {
    fs.writeFileSync(abs, applyBreak(original, find, replace));
    const files = group === "ui-select" ? ["tests/ui-select.test.js"] : group.startsWith("tests/") ? group.split(",") : fs.readdirSync(path.join(REPO, "tests")).filter((f) => f.startsWith(`commands-${group}`) && f.endsWith(".test.js")).map((f) => `tests/${f}`);
    const run = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...files], { cwd: REPO, encoding: "utf8", timeout: 240000 });
    const failed = [...run.stdout.matchAll(/^✖ (.+?) \(\d+(?:\.\d+)?ms\)$/gm)].map((m) => m[1]);
    const status = run.status === 0 ? "SURVIVED" : "killed";
    results.push({ id, file, desc, status, failed: [...new Set(failed)] });
  } finally {
    fs.writeFileSync(abs, original);
  }
  console.error(`${id} ${results.at(-1).status}`);
}

const killed = results.filter((r) => r.status === "killed").length;
const valid = results.filter((r) => !r.status.startsWith("INVALID")).length;
console.log(`killed ${killed} / ${valid}`);
for (const r of results) {
  console.log(`${r.id}\t${r.status}\t${r.file}\t${r.desc}\t${r.failed.slice(0, 2).join(" | ")}`);
}
if (wantMd) {
  console.log("\n| ID | File | Change | Result | First failing test |\n|---|---|---|---|---|");
  for (const r of results) console.log(`| ${r.id} | \`${r.file.replace("src/", "")}\` | ${r.desc} | ${r.status} | ${r.failed[0] ?? ""} |`);
}
