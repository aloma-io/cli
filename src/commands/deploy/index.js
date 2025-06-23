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
        await createWorkspace(workspace.name, workspace.tags.join(","));
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

      // Process tasks
      if (workspace.tasks) {
        console.log(chalk.blue("\nDeploying tasks..."));
        for (const task of workspace.tasks) {
          console.log(chalk.gray(`  - ${task.name}`));
          await createTask(task.name, task.data, task.file, workspaceId);
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
    }
  }

  console.log(chalk.green("\n✅ Deployment completed successfully!"));
}
