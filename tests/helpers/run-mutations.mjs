#!/usr/bin/env node
// Mutation check for the command regression tests.
//
// Applies ONE single-point bug at a time to the command code under src/, runs the test file(s)
// that should notice it, and records whether the suite failed (mutant "killed") or stayed green
// ("survived"). The original file is restored after every mutant, even on a crash.
//
//   node tests/helpers/run-mutations.mjs            # run all, print a table
//   node tests/helpers/run-mutations.mjs --md       # ... and print it as markdown
//   node tests/helpers/run-mutations.mjs M03 M07    # only these ids
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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
const CLI = "src/cli.js";
const UT = "src/utils.js";
const RT = "src/runtime.js";
const A = "src/commands/auth/index.js";
const N = "src/names.js";

// [id, file, find (must occur exactly once), replace, tests expected to catch it, description]
export const MUTATIONS = [
  ["M01", W, "name: name.trim(),\n      tags: workspaceTag,", "name: name,\n      tags: workspaceTag,", "workspace", "workspace add no longer trims the name"],
  ["M02", W, "        id: workspaceId,\n        delete: true,", "        id: workspaceId,\n        delete: false,", "workspace", "workspace delete sends delete=false"],
  ["M03", W, "        id: workspaceId,\n        archive: true,", "        id: workspaceId,\n        archive: false,", "workspace", "workspace archive sends archive=false"],
  ["M04", W, "    if (resolvedId) {\n      workspaceId = resolvedId;", "    if (!resolvedId) {\n      workspaceId = resolvedId;", "workspace", "-w <name> no longer resolved to the id"],
  ["M05", W, "          : ws.tags || [],", "          : [],", "workspace", "workspace update drops existing tags"],
  ["M06", W, "      source_do_sync: true,", "      source_do_sync: false,", "workspace", "workspace sync no longer sets source_do_sync"],
  ["M07", W, "    selectedWorkspaceId = selectedWorkspace;\n    return selectedWorkspace;", "    selectedWorkspaceId = selectedWorkspace;\n    return null;", "workspace", "selected workspace is never read back from the session"],
  ["M08", CLI, 'options.healthEnabled.toLowerCase() === "true"', 'options.healthEnabled.toLowerCase() !== "true"', "workspace", "workspace update --health-enabled inverted"],
  ["M09", CLI, "const deletionDays = options.days ? parseInt(options.days) : undefined;", "const deletionDays = options.days ? options.days : undefined;", "workspace", "workspace delete --days sent as a string"],
  ["M10", S, "          nocode_content: null,\n          config_content: null,\n        });\n\n        if (updateData.saveAutomationStep) {", "          nocode_content: null,\n          config_content: null,\n          enabled: false,\n        });\n\n        if (updateData.saveAutomationStep) {", "step", "step add -f saves the step disabled"],
  ["M11", S, "      environment_id: workspaceId, // TODO: remove this", "      environment_id: stepId, // TODO: remove this", "step", "step delete sends the step id as the workspace"],
  ["M12", S, "      if (!confirmed) {\n        throw new CliError(\"Sync cancelled by user.\");\n      }\n      try {\n        await updateStepFromFile", "      if (confirmed) {\n        throw new CliError(\"Sync cancelled by user.\");\n      }\n      try {\n        await updateStepFromFile", "step", "step sync -s: confirmation inverted"],
  ["M13", S, 'const stepName = relPath.replace(/\\\\/g, "/").replace(/\\.js$/, "");', 'const stepName = relPath.replace(/\\\\/g, "/");', "step", "step sync keeps the .js extension in the step name"],
  ["M14", S, "      const data = await graphQuery(LIST_STEPS_QUERY, {\n        id: workspaceId,\n        includeDisabled: true,\n      });\n      const steps = data.listAutomationSteps;\n\n      if (!steps || steps.length === 0) {\n        console.log(chalk.yellow(\"No steps found in workspace.\"));", "      const data = await graphQuery(LIST_STEPS_QUERY, {\n        id: workspaceId,\n        includeDisabled: false,\n      });\n      const steps = data.listAutomationSteps;\n\n      if (!steps || steps.length === 0) {\n        console.log(chalk.yellow(\"No steps found in workspace.\"));", "step", "step pull skips disabled steps"],
  ["M15", S, 'const filePath = pullTargetFile(step.name, workspaceFolder, "step");', 'const filePath = pullTargetFile(step.name.split("/").pop(), workspaceFolder, "step");', "step", "step pull flattens nested step names"],
  ["M16", L, "          types: newTypes,\n          version: 0,\n          tags: tags,", "          types: newTypes,\n          version: 1,\n          tags: tags,", "library", "library add -f saves with version 1"],
  ["M17", L, 'contentStr = statements.join("\\n");', 'contentStr = statements.join(" ");', "library", "library parser joins statements with a space"],
  ["M18", L, 'namespace: libraryName.split("/")[0] || "default"', 'namespace: libraryName.split("/")[1] || "default"', "library", "library sync derives the namespace from the wrong segment"],
  ["M19", L, "const newEnabled = enabled !== null ? enabled : currentLibrary.enabled;", "const newEnabled = enabled !== null ? currentLibrary.enabled : enabled;", "library", "library update ignores --enabled"],
  ["M20", T, "const offset = (page - 1) * limit;", "const offset = page * limit;", "task", "task list pages off by one"],
  ["M21", T, "if (!isNaN(stepIdx) && stepIdx >= 0 && stepIdx < normalized.length) {\n        const stepId", "if (!isNaN(stepIdx) && stepIdx >= 0 && stepIdx <= normalized.length) {\n        const stepId", "task", "task clone --step accepts one index too many"],
  ["M22", T, 'if (ext === ".json") {', 'if (ext === ".jsn") {', "task", "task new -f no longer reads .json files"],
  ["M23", WH, 'throw failure("Error listing webhooks:", error);', "console.error(error.message);", "webhook-secret", "webhook list exits 0 on error"],
  ["M24", WH, "console.log(`URL: ${webhookUrl + webhook.key}`);\n    });", "console.log(`URL: ${webhookUrl}`);\n    });", "webhook-secret", "webhook list prints the URL without the key"],
  ["M25", SE, "    delete config[secretName];", "    // delete config[secretName];", "webhook-secret", "secret delete keeps the secret"],
  ["M26", SE, "      encrypted: encrypted,", "      encrypted: false,", "webhook-secret", "secret add ignores --encrypted"],
  ["M27", UU, '  admin: ["admin"],', "  admin: [],", "company-user", "admin role no longer adds the admin group"],
  ["M28", U, 'g === "admin" || g === "owner"', 'g === "admin"', "company-user", "owners can no longer manage users"],
  ["M29", C, "currentCompany === realm.id", "currentCompany !== realm.id", "company-user", "company list marks the wrong company"],
  ["M30", C, '.replace("Bearer%20", "");', ";", "company-user", "company switch stores the token with its Bearer%20 prefix"],
  ["M31", CO, "connectorName = fileContent.name || connectorName;", "connectorName = connectorName || fileContent.name;", "connector", "connector update: flag beats file for the name"],
  ["M32", CO, "            audience: marketId,", '            audience: "connector",', "connector", "connector config encrypted for the wrong audience"],
  ["M33", CO, "      mine: false,\n      name: filterName || \"\",", "      mine: true,\n      name: filterName || \"\",", "connector", "connector list-available asks only for my connectors"],
  ["M34", D, 'library.namespace || library.name.split("/")[0] || "default"', 'library.namespace || library.name.split("/")[1] || "default"', "deploy", "deploy library namespace from the wrong segment"],
  ["M35", D, "syncStep(workspaceId, null, step.syncPath, true),", "syncStep(workspaceId, null, step.syncPath, false),", "deploy", "deploy syncPath asks for confirmation"],
  ["M36", UT, "headers.Authorization = `Bearer ${tokenData}`;", "headers.Authorization = `Token ${tokenData}`;", "cli", "requests send the wrong Authorization scheme"],
  ["M37", UT, "    if (data.errors) {", "    if (data.errors && false) {", "workspace", "GraphQL errors are ignored"],
  ["M38", CLI, 'const enabled = options.enabled === "true";\n        const tags', 'const enabled = options.enabled !== "true";\n        const tags', "library", "library add --enabled inverted"],
  // PLAT-81: the exit-code rule (tests/commands-exit-codes.test.js). Each mutant removes the wrapper's
  // non-zero exit, prints twice, or lets one command group swallow its error again.
  ["E01", RT, "process.exitCode =\n      error instanceof CliError ? error.exitCode : EXIT_FAILURE;", "process.exitCode = 0;", "exit-codes", "runtime: a failed command exits 0"],
  ["E02", RT, "process.exit(err.exitCode === 0 ? 0 : EXIT_USAGE);", "process.exit(err.exitCode === 0 ? 0 : EXIT_FAILURE);", "exit-codes", "runtime: usage errors exit 1 instead of 2"],
  ["E03", RT, "if (process.env.DEBUG && error?.stack) {", "if (error?.stack) {", "exit-codes", "runtime: the stack trace is printed without DEBUG"],
  ["E04", UT, 'error.prefix = "GraphQL Error:";', 'error.prefix = "GraphQL Error:";\n    console.error("GraphQL Error:", error.message);', "exit-codes", "graphQuery prints the error itself again (printed twice)"],
  ["E05", W, 'throw new CliError(\n        "No workspace selected. Use `aloma workspace switch` to select one.",\n      );', 'console.log(\n        "No workspace selected. Use `aloma workspace switch` to select one.",\n      );\n      return null;', "exit-codes", "workspace: no selected workspace is a message, exit 0"],
  ["E06", C, 'throw new CliError("Company not found");', 'console.log("Company not found");\n        return;', "exit-codes", "company: switch to an unknown company exits 0"],
  ["E07", S, 'throw failure("Error fetching steps:", error);', "console.error(error.message);", "exit-codes", "step: list swallows its error"],
  ["E08", L, 'throw failure("Error fetching libraries:", error);', "console.error(error.message);", "exit-codes", "library: list swallows its error"],
  ["E09", T, 'throw failure("Error listing tasks:", error);', "console.error(error.message);", "exit-codes", "task: list swallows its error"],
  ["E10", WH, 'throw failure("Error showing webhook:", error);', "console.error(error.message);", "exit-codes", "webhook: show swallows its error"],
  ["E11", SE, 'throw failure("Error fetching secrets:", error);', "console.error(error.message);", "exit-codes", "secret: list swallows its error"],
  ["E12", CO, 'throw failure("Error starting OAuth process:", error);', "console.error(error.message);", "exit-codes", "connector: oauth swallows its error"],
  ["E13", U, "throw new CliError(`Error: Only administrators or owners can ${action}`);", "console.error(`Error: Only administrators or owners can ${action}`);", "exit-codes", "user: a refused permission is only printed"],
  ["E14", A, 'throw failure("❌ Failed to clear session data:", error);', "console.error(error.message);\n      return false;", "exit-codes", "auth: logout swallows a failed session removal"],
  ["E15", D, "      failed++;\n      reportError(error);\n", "      reportError(error);\n", "exit-codes", "deploy: failed items are not counted (success banner, exit 0)"],
  ["E16", T, 'throw new UsageError("⚠ No data provided");', 'throw new CliError("⚠ No data provided");', "exit-codes", "task: missing data is an operation failure (exit 1), not a usage error"],
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
  ["N09", S, '          step = uniqueByName(steps, stepName, "step");', "          step = steps.find((s) => s.name === stepName) ?? null;", "names", "step sync (all): first name match wins"],
  ["N10", L, '          library = uniqueByName(libraries, libraryName, "library");', "          library = libraries.find((l) => l.name === libraryName) ?? null;", "names", "library sync (all): first name match wins"],
  ["N11", S, '          uniqueByName(steps, stepSummary.name, "step");', "", "names", "step pull (all): same-named steps overwrite each other again"],
  ["N12", L, '          uniqueByName(libraries, librarySummary.name, "library");', "", "names", "library pull (all): same-named libraries overwrite each other again"],
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wantMd = process.argv.includes("--md");
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
    fs.writeFileSync(abs, original.replace(find, () => replace));
    const files = fs.readdirSync(path.join(REPO, "tests")).filter((f) => f.startsWith(`commands-${group}`) && f.endsWith(".test.js")).map((f) => `tests/${f}`);
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
  console.log("\n| ID | File | Bug | Result | First failing test |\n|---|---|---|---|---|");
  for (const r of results) console.log(`| ${r.id} | \`${r.file.replace("src/", "")}\` | ${r.desc} | ${r.status} | ${r.failed[0] ?? ""} |`);
}
