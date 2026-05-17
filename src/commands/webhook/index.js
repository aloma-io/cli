import {
  CREATE_WEBHOOK_MUTATION,
  LIST_WEBHOOKS_QUERY,
  REMOVE_WEBHOOK_MUTATION,
} from "./query.js";
import chalk from "chalk";
import { graphQuery, urlForRegion } from "../../utils.js";
import { resolveWorkspaceId } from "../workspace/index.js";

export async function listWebhooks(workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    const response = await graphQuery(LIST_WEBHOOKS_QUERY, {
      id: workspaceId,
    });

    const webhooks = response.listAutomationWebhooks ?? [];

    if (webhooks.length === 0) {
      console.log(chalk.yellow("No webhooks found in the current workspace."));
      return;
    }

    const webhookUrl = await urlForRegion(`https://connect.aloma.io/event/`);
    console.log(chalk.blue("\nWebhooks in current workspace:"));
    webhooks.forEach((webhook) => {
      console.log(chalk.bold(`\n${webhook.name}`));
      console.log(`ID: ${webhook.id}`);
      console.log(`Key: ${webhook.key}`);
      console.log(`Last Used: ${webhook.last_used_at || "Never"}`);
      console.log(`URL: ${webhookUrl + webhook.key}`);
    });
  } catch (error) {
    console.error(chalk.red(`Error listing webhooks: ${error.message}`));
    process.exit(1);
  }
}

export async function addWebhook(name, workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    if (!name) {
      console.log(chalk.yellow("⚠ Please provide name for the webhook"));
      return;
    }

    const response = await graphQuery(CREATE_WEBHOOK_MUTATION, {
      name,
      environmentId: workspaceId,
    });

    const webhook = response.createAutomationWebhook;
    console.log(chalk.green(`\n✓ Webhook "${name}" created successfully!`));
    await showWebhook(webhook.id, workspaceId);
  } catch (error) {
    console.error(chalk.red(`Error creating webhook: ${error.message}`));
    process.exit(1);
  }
}

export async function showWebhook(webhookId, workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    if (!webhookId) {
      console.log(chalk.yellow("⚠ Please provide a webhook ID"));
      return;
    }

    const response = await graphQuery(LIST_WEBHOOKS_QUERY, {
      id: workspaceId,
    });

    const webhooks = response.listAutomationWebhooks;
    const webhook = webhooks.find((w) => w.id === webhookId);

    if (!webhook) {
      console.log(chalk.yellow(`⚠ Webhook with ID ${webhookId} not found`));
      return;
    }

    const webhookUrl = await urlForRegion(`https://connect.aloma.io/event/`);
    console.log(chalk.blue("\n📊 Webhook Details\n"));
    console.log(`${chalk.bold("Name:")} ${webhook.name}`);
    console.log(`ID: ${webhook.id}`);
    console.log(`Key: ${webhook.key}`);
    console.log(`Last Used: ${webhook.last_used_at || "Never"}`);
    console.log(`URL: ${webhookUrl + webhook.key}`);
  } catch (error) {
    console.error(chalk.red("Error showing webhook:"), error.message);
  }
}

export async function deleteWebhook(webhookId, workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    if (!webhookId) {
      console.log(chalk.yellow("⚠ Please provide a webhook ID"));
      return;
    }

    const response = await graphQuery(REMOVE_WEBHOOK_MUTATION, {
      id: webhookId,
      environmentId: workspaceId,
    });

    if (response.deleteAutomationWebhook) {
      console.log(chalk.green(`✓ Webhook ${webhookId} deleted successfully`));
    } else {
      console.log(chalk.yellow(`⚠ Webhook ${webhookId} could not be deleted`));
    }
  } catch (error) {
    console.error(chalk.red(`Error deleting webhook: ${error.message}`));
    process.exit(1);
  }
}
