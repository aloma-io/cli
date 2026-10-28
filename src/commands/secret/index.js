import chalk from "chalk";
import { graphQuery } from "../../utils.js";
import { GET_SECRET_QUERY, SAVE_SECRET_MUTATION } from "./query.js";
import { resolveWorkspaceId } from "../workspace/index.js";
import { CliError, failure } from "../../runtime.js";

export const HIDDEN_VALUE = "******** (hidden, use --reveal to show)";

// Values are masked unless the user explicitly asks to reveal them (scrollback, CI logs).
export async function listSecrets(workspaceId, { reveal = false } = {}) {
  const targetWorkspaceId = await resolveWorkspaceId(workspaceId);

  try {
    const data = await graphQuery(GET_SECRET_QUERY, {
      id: targetWorkspaceId,
    });

    const config = data.getAutomationEnvironmentConfig;

    if (!config || typeof config !== "object") {
      console.log(chalk.yellow("No secrets found for this workspace."));
      return;
    }

    console.log(
      chalk.blue(`\nSecrets for workspace (ID: ${targetWorkspaceId}):`),
    );
    console.log(chalk.gray("─".repeat(80)));

    const secretKeys = Object.keys(config);
    if (secretKeys.length === 0) {
      console.log(chalk.yellow("No secrets found for this workspace."));
      return;
    }

    secretKeys.forEach((key, index) => {
      const secret = config[key];
      const encryptedStatus = secret.encrypted
        ? chalk.green("🔒")
        : chalk.yellow("🔓");
      const valueDisplay = secret.encrypted
        ? "[ENCRYPTED]"
        : !secret.value
          ? "[NO VALUE]"
          : reveal
            ? secret.value
            : HIDDEN_VALUE;

      console.log(chalk.bold(`${index + 1}. ${key}`));
      console.log(`   Description: ${secret.description || "No description"}`);
      console.log(`   Value: ${valueDisplay}`);
      console.log(`   Encrypted: ${encryptedStatus}`);
      if (secret.options && Object.keys(secret.options).length > 0) {
        console.log(`   Options: ${JSON.stringify(secret.options)}`);
      }
      console.log();
    });
  } catch (error) {
    throw failure("Error fetching secrets:", error);
  }
}

export async function addSecret(
  name,
  value,
  description,
  encrypted = false,
  options = {},
  workspaceId,
) {
  const targetWorkspaceId = await resolveWorkspaceId(workspaceId);

  try {
    // Get current secrets
    const data = await graphQuery(GET_SECRET_QUERY, {
      id: targetWorkspaceId,
    });

    let config = data.getAutomationEnvironmentConfig || {};

    // Create new secret object
    const newSecret = {
      encrypted: encrypted,
      value: value,
      description: description || "",
      options: options || {},
      hasValue: true,
    };

    // Add to the object using the name as key
    config[name] = newSecret;

    // Save the updated object
    await graphQuery(SAVE_SECRET_MUTATION, {
      environmentId: targetWorkspaceId,
      values: config,
    });

    console.log(chalk.green(`✅ Secret "${name}" added successfully`));
  } catch (error) {
    throw failure("Error adding secret:", error);
  }
}

export async function deleteSecret(secretName, workspaceId) {
  const targetWorkspaceId = await resolveWorkspaceId(workspaceId);

  try {
    // Get current secrets
    const data = await graphQuery(GET_SECRET_QUERY, {
      id: targetWorkspaceId,
    });

    let config = data.getAutomationEnvironmentConfig || {};

    // Check if the secret exists
    if (!config[secretName]) {
      throw new CliError(
        `❌ Secret "${secretName}" not found. Use \`aloma secret list\` to see available secrets.`,
      );
    }

    // Remove from the object
    delete config[secretName];

    // Save the updated object
    await graphQuery(SAVE_SECRET_MUTATION, {
      environmentId: targetWorkspaceId,
      values: config,
    });

    console.log(chalk.green(`✅ Secret "${secretName}" deleted successfully`));
  } catch (error) {
    throw failure("Error deleting secret:", error);
  }
}
