import {
  CREATE_WEBHOOK_MUTATION,
  LIST_WEBHOOKS_QUERY,
  REMOVE_WEBHOOK_MUTATION,
} from "./query.js";
import chalk from "chalk";
import { graphQuery } from "../../utils.js";
import { urlForRegion } from "../../context.js";
import { resolveWorkspaceId } from "../../context.js";
import { CliError, UsageError, failure } from "../../runtime.js";

export async function listWebhooks(workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

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
    throw failure("Error listing webhooks:", error);
  }
}

export async function addWebhook(name, workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

    if (!name) {
      throw new UsageError("⚠ Please provide name for the webhook");
    }

    const response = await graphQuery(CREATE_WEBHOOK_MUTATION, {
      name,
      environmentId: workspaceId,
    });

    const webhook = response.createAutomationWebhook;
    console.log(chalk.green(`\n✓ Webhook "${name}" created successfully!`));
    await showWebhook(webhook.id, { id: workspaceId });
  } catch (error) {
    throw failure("Error creating webhook:", error);
  }
}

export async function showWebhook(webhookId, workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

    if (!webhookId) {
      throw new UsageError("⚠ Please provide a webhook ID");
    }

    const response = await graphQuery(LIST_WEBHOOKS_QUERY, {
      id: workspaceId,
    });

    const webhooks = response.listAutomationWebhooks;
    const webhook = webhooks.find((w) => w.id === webhookId);

    if (!webhook) {
      throw new CliError(`⚠ Webhook with ID ${webhookId} not found`);
    }

    const webhookUrl = await urlForRegion(`https://connect.aloma.io/event/`);
    console.log(chalk.blue("\n📊 Webhook Details\n"));
    console.log(`${chalk.bold("Name:")} ${webhook.name}`);
    console.log(`ID: ${webhook.id}`);
    console.log(`Key: ${webhook.key}`);
    console.log(`Last Used: ${webhook.last_used_at || "Never"}`);
    console.log(`URL: ${webhookUrl + webhook.key}`);
  } catch (error) {
    throw failure("Error showing webhook:", error);
  }
}

export async function deleteWebhook(webhookId, workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

    if (!webhookId) {
      throw new UsageError("⚠ Please provide a webhook ID");
    }

    const response = await graphQuery(REMOVE_WEBHOOK_MUTATION, {
      id: webhookId,
      environmentId: workspaceId,
    });

    if (response.deleteAutomationWebhook) {
      console.log(chalk.green(`✓ Webhook ${webhookId} deleted successfully`));
    } else {
      throw new CliError(`⚠ Webhook ${webhookId} could not be deleted`);
    }
  } catch (error) {
    throw failure("Error deleting webhook:", error);
  }
}
