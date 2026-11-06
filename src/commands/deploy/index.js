import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import chalk from "chalk";
import { switchCompany } from "../company/index.js";
import { createWorkspace } from "../workspace/index.js";
import { findWorkspaceByName, resolveConnector } from "../../context.js";
import { stepResource } from "../../resources/step.js";
import { libraryResource } from "../../resources/library.js";
import {
  ensure,
  ensureFolder,
  describeFailure,
} from "../../resources/engine.js";
import { createTask } from "../task/index.js";
import { addWebhook } from "../webhook/index.js";
import { addConnector } from "../connector/index.js";
import { addSecret } from "../secret/index.js";
import { CliError, reportError, failure } from "../../runtime.js";
import { oneLine, realPathInside } from "../../pull-safety.js";

// The company and the target workspace decide where everything else goes: if either fails,
// the deployment stops before anything is deployed.
function abort(error) {
  return new CliError(`Deployment failed: ${error?.message ?? error}`, {
    cause: error,
  });
}

// One row per deployed item: kind, name and what happened; with --dry-run, what would happen.
function printResults(rows, dryRun) {
  if (rows.length === 0) return;
  const label = ({ status }) => {
    if (dryRun && status === "created") return "would create";
    if (dryRun && status === "updated") return "would update";
    if (status === "skipped") return "skipped (dry run)";
    return status;
  };
  const cells = rows.map((row) => [row.kind, oneLine(row.name), label(row)]);
  const widths = [0, 1].map((i) =>
    Math.max(4, ...cells.map((c) => c[i].length)),
  );
  const line = (c) =>
    `  ${c[0].padEnd(widths[0])}  ${c[1].padEnd(widths[1])}  ${c[2]}`;
  console.log(chalk.blue("\nResults:"));
  console.log(line(["KIND", "NAME", "RESULT"]));
  cells.forEach((c) => console.log(line(c)));
}

// Steps and libraries have a descriptor: each entry is ensured (found by name, created if absent, saved only
// if different), so a re-run updates instead of duplicating (PLAT-118, M16). The other sections still add.
// With dryRun nothing is written: steps and libraries are compared, the other sections are skipped.
export async function deployFromYaml(yamlPath, { dryRun = false } = {}) {
  // Read and parse YAML file
  const config = yaml.load(fs.readFileSync(yamlPath, "utf8"));

  // Every file the YAML names is taken from the YAML's own folder, links resolved. A path that is absolute
  // or ends up outside that folder is refused (named in the error) before anything is read or sent.
  const folder = path.dirname(path.resolve(yamlPath));
  const inFolder = async (ref) => {
    if (!ref) return ref;
    const real = await realPathInside(folder, ref);
    if (real === null) {
      throw new CliError(
        `Path outside the folder of ${oneLine(path.basename(yamlPath))} is refused: ${oneLine(ref)}`,
      );
    }
    return real;
  };

  console.log(chalk.blue("🚀 Starting deployment...\n"));

  // Each item that fails is reported (once, on stderr), counted and shown in the table; the others still deploy.
  let failed = 0;
  const rows = [];
  const fail = (kind, name, error) => {
    failed++;
    reportError(error);
    rows.push({ kind, name, status: "failed" });
  };
  const deploy = async (kind, name, fn) => {
    if (dryRun) {
      rows.push({ kind, name, status: "skipped" });
      return;
    }
    try {
      await fn();
      rows.push({ kind, name, status: "applied" });
    } catch (error) {
      fail(kind, name, error);
    }
  };
  const record = (desc, result) => {
    rows.push(result);
    if (result.error) {
      failed++;
      reportError(new CliError(describeFailure(desc, result)));
    }
  };
  // One section with a descriptor: entries by name (and file), or a syncPath folder of files.
  const ensureSection = async (desc, entries, toDesired, workspaceId) => {
    for (const entry of entries) {
      if (entry.syncPath) {
        try {
          const results = await ensureFolder(
            desc,
            workspaceId,
            await inFolder(entry.syncPath),
            {
              dryRun,
            },
          );
          results.forEach((result) => record(desc, result));
        } catch (error) {
          fail(desc.kind, entry.syncPath, error);
        }
      } else if (!entry.name) {
        fail(
          desc.kind,
          "(unnamed)",
          new CliError(`A ${desc.kind} entry must have 'name' or 'syncPath'.`),
        );
      } else {
        console.log(chalk.gray(`  - ${entry.name}`));
        const desired = toDesired(entry);
        try {
          desired.file = await inFolder(desired.file);
        } catch (error) {
          fail(desc.kind, entry.name, error);
          continue;
        }
        record(desc, await ensure(desc, workspaceId, desired, { dryRun }));
      }
    }
  };

  // Switch to specified company
  if (config.company) {
    console.log(chalk.blue(`Switching to company: ${config.company}`));
    await switchCompany(config.company).catch((error) => {
      throw abort(error);
    });
  }

  // Process workspaces
  if (config.workspaces) {
    for (const workspace of config.workspaces) {
      console.log(chalk.blue(`\nProcessing workspace: ${workspace.name}`));

      // The one workspace with this name in any case, created if there is none (PLAT-116: never a guess)
      let target;
      try {
        target = await findWorkspaceByName(workspace.name);
        if (!target && dryRun) {
          rows.push({
            kind: "workspace",
            name: workspace.name,
            status: "created",
          });
          target = { id: null, name: workspace.name };
        } else if (!target) {
          const id = await createWorkspace(
            workspace.name,
            workspace.tags ? workspace.tags.join(",") : "",
          );
          target = { id, name: workspace.name };
          rows.push({
            kind: "workspace",
            name: workspace.name,
            status: "created",
          });
        }
      } catch (error) {
        throw abort(error);
      }
      if (target.id) {
        console.log(
          chalk.blue(
            `Target workspace: ${oneLine(target.name)} (ID: ${oneLine(target.id)})`,
          ),
        );
      }
      // Already resolved: the commands below use the id without looking the name up again
      const workspaceId = target.id
        ? { id: target.id, name: target.name }
        : null;

      // Process steps
      if (workspace.steps) {
        console.log(chalk.blue("\nDeploying steps..."));
        await ensureSection(
          stepResource,
          workspace.steps,
          (step) => ({
            name: String(step.name).trim(),
            file: step.file,
            nocode_type: step.type,
          }),
          target.id,
        );
      }

      // Process libraries
      if (workspace.libraries) {
        console.log(chalk.blue("\nDeploying libraries..."));
        await ensureSection(
          libraryResource,
          workspace.libraries,
          (library) => ({
            name: String(library.name).trim(),
            file: library.file,
            namespace: library.namespace,
            tags: library.tags,
          }),
          target.id,
        );
      }

      // Process webhooks
      if (workspace.webhooks) {
        console.log(chalk.blue("\nDeploying webhooks..."));
        for (const webhook of workspace.webhooks) {
          console.log(chalk.gray(`  - ${webhook.name}`));
          await deploy("webhook", webhook.name, () =>
            addWebhook(webhook.name, workspaceId),
          );
        }
      }

      // Process connectors
      if (workspace.connectors) {
        console.log(chalk.blue("\nDeploying connectors..."));
        for (const connector of workspace.connectors) {
          const label =
            connector.connectorName || connector.connectorId || "(unnamed)";
          let file;
          try {
            file = await inFolder(connector.file);
          } catch (error) {
            fail("connector", label, error);
            continue;
          }
          await deploy("connector", label, async () => {
            let connectorId = connector.connectorId;
            let connectorName = connector.connectorName;
            let namespace = connector.namespace;
            // If connectorId is not provided but connectorName is, search for it
            if (!connectorId && connectorName) {
              // Exact id, then unique name in any case; ambiguity and no match are refused (PLAT-116)
              const connectorData = await resolveConnector(
                connectorName,
                workspaceId,
              );
              connectorId = connectorData.id;
              namespace = namespace || connectorData.namespace;
            }
            if (!connectorId) {
              throw new CliError(
                `No connectorId or connectorName provided for connector entry.`,
              );
            }
            console.log(chalk.gray(`  - ${connectorName || connectorId}`));
            await addConnector(
              connectorId,
              workspaceId,
              connectorName,
              namespace,
              connector.tags,
              connector.shared_in_realm,
              connector.config,
              file,
            );
          });
        }
      }

      // Process secrets
      if (workspace.secrets) {
        console.log(chalk.blue("\nDeploying secrets..."));
        for (const secret of workspace.secrets) {
          const { name, value, description, encrypted, options } = secret;
          if (!name || value === undefined) {
            fail(
              "secret",
              name || "(unnamed)",
              new CliError(`Secret entry must have 'name' and 'value'.`),
            );
            continue;
          }
          console.log(chalk.gray(`  - ${name}`));
          await deploy("secret", name, () =>
            addSecret(
              name,
              value,
              description,
              encrypted,
              options,
              workspaceId,
            ),
          );
        }
      }

      // Process tasks
      if (workspace.tasks) {
        console.log(chalk.blue("\nDeploying tasks..."));
        for (const task of workspace.tasks) {
          console.log(chalk.gray(`  - ${task.name}`));
          let file;
          try {
            file = await inFolder(task.file);
          } catch (error) {
            fail("task", task.name, error);
            continue;
          }
          await deploy("task", task.name, () =>
            createTask(task.name, task.data, file, workspaceId),
          );
        }
      }
    }
  }

  printResults(rows, dryRun);
  if (failed > 0) {
    throw new CliError(
      `\nDeployment failed: ${failed} item(s) could not be deployed.`,
    );
  }
  if (dryRun) {
    console.log(chalk.green("\nDry run: nothing was sent."));
    return;
  }
  console.log(chalk.green("\n✅ Deployment completed successfully!"));
}

export function register(program) {
  program
    .command("deploy")
    .description("Deploy resources from a YAML configuration file")
    .argument("<yamlPath>", "Path to the YAML configuration file")
    // .option('-f, --force', 'Force overwrite existing resources')
    .option(
      "--dry-run",
      "Report what would be created or updated, without sending any change",
    )
    .action(async (yamlPath, options) => {
      try {
        await deployFromYaml(yamlPath, { dryRun: Boolean(options.dryRun) });
        // await deployFromYaml(yamlPath, { force: options.force });
      } catch (error) {
        throw failure("Deployment failed:", error);
      }
    });
}
