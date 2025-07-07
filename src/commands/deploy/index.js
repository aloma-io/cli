import fs from "fs";
import yaml from "js-yaml";
import chalk from "chalk";
import { switchCompany } from "../company/index.js";
import {
  createWorkspace,
  getWorkspaceId,
  getSelectedWorkspace,
} from "../workspace/index.js";
import { addStep } from "../step/index.js";
import { createTask } from "../task/index.js";
import { addWebhook } from "../webhook/index.js";
import { addConnector, getConnectorByName } from "../connector/index.js";
import { addSecret } from "../secret/index.js";

export async function deployFromYaml(yamlPath, options = {}) {
  // Read and parse YAML file
  const config = yaml.load(fs.readFileSync(yamlPath, "utf8"));

  console.log(chalk.blue("🚀 Starting deployment...\n"));

  // Switch to specified company
  if (config.company) {
    console.log(chalk.blue(`Switching to company: ${config.company}`));
    await switchCompany(config.company);
  }

  // Process workspaces
  if (config.workspaces) {
    for (const workspace of config.workspaces) {
      console.log(chalk.blue(`\nProcessing workspace: ${workspace.name}`));

      // Check if workspace exists
      let workspaceId = await getWorkspaceId(workspace.name);
      if (!workspaceId) {
        // Create workspace if it doesn't exist
        await createWorkspace(workspace.name, workspace.tags ? workspace.tags.join(",") : "");
        workspaceId = await getSelectedWorkspace();
      }

      // Process steps
      if (workspace.steps) {
        console.log(chalk.blue("\nDeploying steps..."));
        for (const step of workspace.steps) {
          console.log(chalk.gray(`  - ${step.name}`));
          await addStep(step.name, workspaceId, step.type, step.file);
        }
      }

      // Process webhooks
      if (workspace.webhooks) {
        console.log(chalk.blue("\nDeploying webhooks..."));
        for (const webhook of workspace.webhooks) {
          console.log(chalk.gray(`  - ${webhook.name}`));
          await addWebhook(webhook.name, workspaceId);
        }
      }

      // Process connectors
      if (workspace.connectors) {
        console.log(chalk.blue("\nDeploying connectors..."));
        for (const connector of workspace.connectors) {
          let connectorId = connector.connectorId;
          let connectorName = connector.connectorName;
          let namespace = connector.namespace;
          // If connectorId is not provided but connectorName is, search for it
          if (!connectorId && connectorName) {
            const connectorData = await getConnectorByName(
              connectorName,
              workspaceId,
            );
            if (connectorData) {
              connectorId = connectorData.id;
              namespace = namespace || connectorData.namespace;
            } else {
              continue;
            }
          }
          if (!connectorId) {
            console.log(
              chalk.red(
                `No connectorId or connectorName provided for connector entry.`,
              ),
            );
            continue;
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
        }
      }

      // Process secrets
      if (workspace.secrets) {
        console.log(chalk.blue("\nDeploying secrets..."));
        for (const secret of workspace.secrets) {
          const { name, value, description, encrypted, options } = secret;
          if (!name || value === undefined) {
            console.log(
              chalk.red(`Secret entry must have 'name' and 'value'.`),
            );
            continue;
          }
          console.log(chalk.gray(`  - ${name}`));
          await addSecret(
            name,
            value,
            description,
            encrypted,
            options,
            workspaceId,
          );
        }
      }

      // Process tasks
      if (workspace.tasks) {
        console.log(chalk.blue("\nDeploying tasks..."));
        for (const task of workspace.tasks) {
          console.log(chalk.gray(`  - ${task.name}`));
          await createTask(task.name, task.data, task.file, workspaceId);
        }
      }
    }
  }

  console.log(chalk.green("\n✅ Deployment completed successfully!"));
}
