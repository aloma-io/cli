import chalk from "chalk";
import { graphQuery } from "../../utils.js";
import { GET_SECRET_QUERY, SAVE_SECRET_MUTATION } from "./query.js";
import { resolveWorkspaceId } from "../workspace/index.js";

export async function listSecrets(workspaceId) {
  const targetWorkspaceId = await resolveWorkspaceId(workspaceId);
  if (!targetWorkspaceId) return;

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
        : secret.value || "[NO VALUE]";

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
    console.error(chalk.red("Error fetching secrets:"), error.message);
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
  if (!targetWorkspaceId) return;

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
    console.error(chalk.red("Error adding secret:"), error.message);
  }
}

export async function deleteSecret(secretName, workspaceId) {
  const targetWorkspaceId = await resolveWorkspaceId(workspaceId);
  if (!targetWorkspaceId) return;

  try {
    // Get current secrets
    const data = await graphQuery(GET_SECRET_QUERY, {
      id: targetWorkspaceId,
    });

    let config = data.getAutomationEnvironmentConfig || {};

    // Check if the secret exists
    if (!config[secretName]) {
      console.log(
        chalk.red(
          `❌ Secret "${secretName}" not found. Use \`aloma secret list\` to see available secrets.`,
        ),
      );
      return;
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
    console.error(chalk.red("Error deleting secret:"), error.message);
  }
}
