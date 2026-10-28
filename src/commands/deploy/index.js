import fs from "fs";
import yaml from "js-yaml";
import chalk from "chalk";
import { switchCompany } from "../company/index.js";
import { createWorkspace } from "../workspace/index.js";
import { findWorkspaceByName, resolveConnector } from "../../context.js";
import { addStep, syncStep } from "../step/index.js";
import { addLibrary, syncLibrary } from "../library/index.js";
import { createTask } from "../task/index.js";
import { addWebhook } from "../webhook/index.js";
import { addConnector } from "../connector/index.js";
import { addSecret } from "../secret/index.js";
import { CliError, reportError } from "../../runtime.js";
import { oneLine } from "../../pull-safety.js";

// The company and the target workspace decide where everything else goes: if either fails,
// the deployment stops before anything is deployed.
function abort(error) {
  return new CliError(`Deployment failed: ${error?.message ?? error}`, {
    cause: error,
  });
}

export async function deployFromYaml(yamlPath, options = {}) {
  // Read and parse YAML file
  const config = yaml.load(fs.readFileSync(yamlPath, "utf8"));

  console.log(chalk.blue("🚀 Starting deployment...\n"));

  // Each resource that fails is reported (once, on stderr) and counted; the others still deploy.
  let failed = 0;
  const deploy = async (fn) => {
    try {
      await fn();
    } catch (error) {
      failed++;
      reportError(error);
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

      // The workspace with exactly this name, created if there is none (PLAT-116: never a guess)
      let target;
      try {
        target = await findWorkspaceByName(workspace.name);
        if (!target) {
          const id = await createWorkspace(
            workspace.name,
            workspace.tags ? workspace.tags.join(",") : "",
          );
          target = { id, name: workspace.name };
        }
      } catch (error) {
        throw abort(error);
      }
      console.log(
        chalk.blue(
          `Target workspace: ${oneLine(target.name)} (ID: ${oneLine(target.id)})`,
        ),
      );
      // Already resolved: the commands below use the id without looking the name up again
      const workspaceId = { id: target.id, name: target.name };

      // Process steps
      if (workspace.steps) {
        console.log(chalk.blue("\nDeploying steps..."));
        for (const step of workspace.steps) {
          if (step.syncPath) {
            // Sync all .js files from the given directory as steps
            await deploy(() =>
              syncStep(workspaceId, null, step.syncPath, true),
            );
          } else {
            console.log(chalk.gray(`  - ${step.name}`));
            await deploy(() =>
              addStep(step.name, workspaceId, step.type, step.file),
            );
          }
        }
      }

      // Process libraries
      if (workspace.libraries) {
        console.log(chalk.blue("\nDeploying libraries..."));
        for (const library of workspace.libraries) {
          if (library.syncPath) {
            // Sync all .js files from the given directory as libraries
            await deploy(() =>
              syncLibrary(workspaceId, null, library.syncPath, true),
            );
          } else {
            console.log(chalk.gray(`  - ${library.name}`));
            await deploy(() =>
              addLibrary(
                library.name,
                library.namespace || library.name.split("/")[0] || "default",
                workspaceId,
                library.file,
                library.tags || [],
              ),
            );
          }
        }
      }

      // Process webhooks
      if (workspace.webhooks) {
        console.log(chalk.blue("\nDeploying webhooks..."));
        for (const webhook of workspace.webhooks) {
          console.log(chalk.gray(`  - ${webhook.name}`));
          await deploy(() => addWebhook(webhook.name, workspaceId));
        }
      }

      // Process connectors
      if (workspace.connectors) {
        console.log(chalk.blue("\nDeploying connectors..."));
        for (const connector of workspace.connectors) {
          await deploy(async () => {
            let connectorId = connector.connectorId;
            let connectorName = connector.connectorName;
            let namespace = connector.namespace;
            // If connectorId is not provided but connectorName is, search for it
            if (!connectorId && connectorName) {
              // Exact id or exact unique name; ambiguity and no match are refused (PLAT-116)
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
              connector.file,
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
            failed++;
            reportError(
              new CliError(`Secret entry must have 'name' and 'value'.`),
            );
            continue;
          }
          console.log(chalk.gray(`  - ${name}`));
          await deploy(() =>
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
          await deploy(() =>
            createTask(task.name, task.data, task.file, workspaceId),
          );
        }
      }
    }
  }

  if (failed > 0) {
    throw new CliError(
      `\nDeployment failed: ${failed} item(s) could not be deployed.`,
    );
  }
  console.log(chalk.green("\n✅ Deployment completed successfully!"));
}
