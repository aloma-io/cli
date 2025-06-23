import chalk from "chalk";
import { graphQuery, updateSessionData, getSessionData } from "../../utils.js";
import {
  LIST_ENVIRONMENTS_QUERY,
  CREATE_WORKSPACE_MUTATION,
  LIST_WORKSPACES_QUERY,
  GET_WORKSPACE_QUERY,
  GET_WORKSPACE_STATS_QUERY,
} from "./query.js";

// Global variable to store the selected workspace ID
let selectedWorkspaceId = null;

// Save the selected workspace ID
export async function saveSelectedWorkspace(workspaceId) {
  try {
    await updateSessionData("selectedWorkspace", workspaceId);
    selectedWorkspaceId = workspaceId;
    return true;
  } catch (error) {
    console.error(
      chalk.red("Failed to save workspace selection:"),
      error.message,
    );
    return false;
  }
}

// Get the selected workspace ID
export async function getSelectedWorkspace() {
  if (selectedWorkspaceId) {
    return selectedWorkspaceId;
  }

  try {
    const selectedWorkspace = await getSessionData("selectedWorkspace");
    selectedWorkspaceId = selectedWorkspace;
    return selectedWorkspace;
  } catch (error) {
    console.error(
      chalk.red("Failed to read workspace selection:"),
      error.message,
    );
    return null;
  }
}
// switch workspace by name or id
export async function switchWorkspace(workspaceIdentifier) {
  try {
    if (!workspaceIdentifier) {
      console.log(chalk.yellow("⚠ Workspace identifier is required"));
      return;
    }
    const data = await graphQuery(LIST_WORKSPACES_QUERY);
    const workspaces = data.listAutomationEnvironmentWithStats;

    if (!workspaces || workspaces.length === 0) {
      console.log(chalk.yellow("No workspaces found."));
      return;
    }

    // Try to find and switch to it
    const workspace = workspaces.find(
      (w) =>
        w.name.toLowerCase() === workspaceIdentifier.toLowerCase() ||
        w.id === workspaceIdentifier,
    );

    if (workspace) {
      await saveSelectedWorkspace(workspace.id);
      console.log(chalk.green(`Switched to workspace [${workspace.name}]`));
      return;
    } else {
      console.log(chalk.red(`Workspace '${workspaceIdentifier}' not found.`));
      return;
    }
  } catch (error) {
    console.error(chalk.red("Error fetching workspaces:"), error.message);
  }
}

export async function createWorkspace(name, tags) {
  let workspaceTag = null;

  if (tags) {
    workspaceTag = tags.split(",").map((tag) => tag.trim());
  }

  try {
    const data = await graphQuery(CREATE_WORKSPACE_MUTATION, {
      name: name.trim(),
      tags: workspaceTag,
    });

    const workspace = data.createAutomationEnvironment;
    console.log(chalk.green(`Created workspace [${name.trim()}]`));
    console.log(chalk.green(`ID: ${workspace.id}`));
    // Automatically switch to the new workspace
    await saveSelectedWorkspace(workspace.id);
    console.log(chalk.green(`Switched to workspace [${name.trim()}]`));
  } catch (error) {
    console.error(chalk.red("Error creating workspace:"), error.message);
  }
}

export async function listWorkspaces(name, tags, archived) {
  try {
    const data = await graphQuery(LIST_ENVIRONMENTS_QUERY, {
      tags,
      archived,
    });
    const environments = data.listAutomationEnvironmentWithStats;
    const currentWorkspaceId = await getSelectedWorkspace();

    if (!environments || environments.length === 0) {
      console.log(chalk.yellow("No environments found."));
      return;
    }
    console.log(chalk.blue("\nAvailable workspaces:"));
    environments.forEach((env) => {
      const isCurrent = env.id === currentWorkspaceId;
      console.log(`${env.name} (ID:${env.id})${isCurrent ? " [*]" : ""}`);
    });
  } catch (error) {
    console.error(chalk.red("Error fetching environments:"), error.message);
  }
}

export async function showWorkspace(workspaceIdentifier, stats) {
  let workspaceId = workspaceIdentifier;
  if (!workspaceIdentifier) {
    workspaceId = await getSelectedWorkspace();
    if (!workspaceId) {
      console.log(
        chalk.yellow(
          "No workspace selected. Use `aloma workspace switch` to select one.",
        ),
      );
      return;
    }
  }

  if (stats) {
    const data = await graphQuery(GET_WORKSPACE_STATS_QUERY, {
      id: workspaceId,
    });
    const ws = data.getAutomationEnvironmentWithStats;
    if (!ws) {
      console.log(chalk.red("Workspace not found or no stats available."));
      return;
    }
    // Workspace Header
    console.log(
      chalk.bold.blue(`\n${ws.name}`) + chalk.gray(`  (ID: ${ws.id})`),
    );
    if (ws.type) console.log(chalk.gray(`Type: ${ws.type}`));
    console.log();

    // Automation (7 days)
    let autoPercent7 =
      typeof ws.testPercentage7 === "number" ? ws.testPercentage7 : 0;
    let manualPercent7 = 100 - autoPercent7;
    console.log(chalk.bold("AUTOMATION (last 7 days):"));
    console.log(
      chalk.green(`  Automated: ${autoPercent7}%`) +
        chalk.gray("   |   ") +
        chalk.yellow(`Manual: ${manualPercent7}%`),
    );
    console.log();

    // Automation (30 days)
    let autoPercent =
      typeof ws.testPercentage7 === "number" ? ws.testPercentage7 : 0;
    let manualPercent = 100 - autoPercent;
    // If you have a 30d automation percentage, use it instead
    // let autoPercent = ws.testPercentage30 || 0;
    // let manualPercent = 100 - autoPercent;
    console.log(chalk.bold("AUTOMATION (last 30 days):"));
    console.log(
      chalk.green(`  Automated: ${autoPercent}%`) +
        chalk.gray("   |   ") +
        chalk.yellow(`Manual: ${manualPercent}%`),
    );
    console.log();

    // Tasks
    console.log(chalk.bold("TASKS:"));
    console.log(
      `  ${chalk.cyan(ws.tasks7 || 0)} (7d)   ${chalk.cyan(ws.tasks30 || 0)} (30d)   ${chalk.cyan(ws.tasks || 0)} (All)`,
    );
    console.log();

    // Steps
    console.log(chalk.bold("STEPS:"));
    console.log(
      `  ${chalk.magenta(ws.steps7 || 0)} (7d)   ${chalk.magenta(ws.steps30 || 0)} (30d)   ${chalk.magenta(ws.steps || 0)} (Unique)`,
    );
    console.log();

    // Health & Issues
    if (ws.health && typeof ws.health === "object") {
      const health = ws.health;
      let hasIssues = false;
      if (health.enabled === false) {
        console.log(
          chalk.yellow("  Health checks are disabled for this workspace."),
        );
      }
      if (
        (health.failing && Array.isArray(health.failing.connectors)) ||
        (health.unused &&
          (health.unused.steps > 0 ||
            health.unused.webhooks > 0 ||
            health.unused.connectors > 0))
      ) {
        console.log(chalk.bold.red("HEALTH ISSUES:"));
        hasIssues = true;
      }
      // Unused resources
      if (health.unused) {
        if (health.unused.steps > 0) {
          console.log(chalk.red(`  ${health.unused.steps} unused steps`));
          hasIssues = true;
        }
        if (health.unused.webhooks > 0) {
          console.log(chalk.red(`  ${health.unused.webhooks} unused webhooks`));
          hasIssues = true;
        }
        if (health.unused.connectors > 0) {
          console.log(
            chalk.red(`  ${health.unused.connectors} unused connectors`),
          );
          hasIssues = true;
        }
      }
      // Failing connectors
      if (health.failing && Array.isArray(health.failing.connectors)) {
        health.failing.connectors.forEach((conn) => {
          if (conn && conn.healthy === false) {
            console.log(
              chalk.red(
                `  Failing connector: ${conn.name} - ${conn.health_error}`,
              ),
            );
            hasIssues = true;
          }
        });
      }
      // Failing tests
      if (health.failing && health.failing.tests > 0) {
        console.log(chalk.red(`  ${health.failing.tests} failing tests`));
        hasIssues = true;
      }
      if (!hasIssues) {
        console.log(chalk.green("  No health issues detected."));
      }
      console.log();
    } else if (ws.connectorIssues && ws.connectorIssues > 0) {
      console.log(chalk.bold.red("HEALTH ISSUES:"));
      console.log(
        chalk.red(
          `  ${ws.connectorIssues} connector${ws.connectorIssues > 1 ? "s" : ""} with health issues`,
        ),
      );
      console.log();
    }

    // Connectors, Webhooks
    console.log(chalk.bold("RESOURCES:"));
    console.log(
      `  Connectors: ${chalk.yellow(ws.connectors || 0)}  Webhooks: ${chalk.yellow(ws.webhooks || 0)}`,
    );
    console.log();
  } else {
    const data = await graphQuery(GET_WORKSPACE_QUERY, {
      id: workspaceId,
    });
    const ws = data.getAutomationEnvironment;
    if (!ws) {
      console.log(chalk.red("Workspace not found."));
      return;
    }
    // Header
    console.log(
      chalk.bold.blue(`\n${ws.name || "Unnamed Workspace"}`) +
        chalk.gray(`  (ID: ${ws.id})`),
    );
    if (ws.type) console.log(chalk.gray(`Type: ${ws.type}`));
    if (ws.tags && ws.tags.length > 0) {
      console.log(chalk.gray("Tags: ") + chalk.yellow(ws.tags.join(", ")));
    } else {
      console.log(chalk.gray("Tags: ") + chalk.yellow("None"));
    }
    if (typeof ws.autoclean === "boolean") {
      console.log(
        chalk.gray("Autoclean: ") +
          (ws.autoclean ? chalk.green("Enabled") : chalk.red("Disabled")),
      );
    }
    if (ws.clean_interval !== undefined && ws.clean_interval !== null) {
      console.log(
        chalk.gray("Clean Interval: ") +
          chalk.cyan(ws.clean_interval + " days"),
      );
    }
    if (typeof ws.archived === "boolean") {
      console.log(
        chalk.gray("Archived: ") +
          (ws.archived ? chalk.red("Yes") : chalk.green("No")),
      );
    }
    if (typeof ws.deleting === "boolean" && ws.deleting) {
      console.log(
        chalk.red("This workspace is being deleted.") +
          (ws.deleting_at ? chalk.gray(" (at: " + ws.deleting_at + ")") : ""),
      );
    }
    if (typeof ws.health_enabled === "boolean") {
      console.log(
        chalk.gray("Health Checks: ") +
          (ws.health_enabled ? chalk.green("Enabled") : chalk.red("Disabled")),
      );
    }
    // Add any other fields you want to display here
  }
}

export async function getWorkspaceId(name) {
  const token = await getSessionData("token");
  if (!token) {
    console.log(
      chalk.yellow(
        "⚠ Not authenticated: No token found. Run `aloma auth` to login.",
      ),
    );
    return;
  }

  const data = await graphQuery(LIST_ENVIRONMENTS_QUERY);
  const environments = data.listAutomationEnvironmentWithStats;

  const workspace = environments.find(
    (env) => env.name.toLowerCase() === name.toLowerCase() || env.id === name,
  );

  return workspace ? workspace.id : null;
}
