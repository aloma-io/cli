import chalk from "chalk";
import { graphQuery, updateSessionData, getSessionData } from "../../utils.js";
import {
  LIST_ENVIRONMENTS_QUERY,
  CREATE_WORKSPACE_MUTATION,
  LIST_WORKSPACES_QUERY,
  GET_WORKSPACE_QUERY,
  GET_WORKSPACE_STATS_QUERY,
  DELETE_WORKSPACE_MUTATION,
  ARCHIVE_WORKSPACE_MUTATION,
  SAVE_WORKSPACE_MUTATION,
  GET_SOURCE_QUERY,
  SAVE_SOURCE_MUTATION,
} from "./query.js";

import fs from "fs";

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

// Common function to resolve workspace ID from identifier or use selected workspace
export async function resolveWorkspaceId(workspaceIdentifier) {
  let workspaceId = workspaceIdentifier;
  if (!workspaceIdentifier) {
    workspaceId = await getSelectedWorkspace();
    if (!workspaceId) {
      console.log(
        chalk.yellow(
          "No workspace selected. Use `aloma workspace switch` to select one.",
        ),
      );
      return null;
    }
  } else {
    // Try to resolve workspace name to ID
    const resolvedId = await getWorkspaceId(workspaceIdentifier);
    if (resolvedId) {
      workspaceId = resolvedId;
    }
  }
  return workspaceId;
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

export async function showWorkspace(workspaceIdentifier, stats, source) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

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
  } else if (source) {
    try {
      const data = await graphQuery(GET_SOURCE_QUERY, { id: workspaceId });
      const ws = data.getAutomationEnvironment;
      if (!ws) {
        console.log(chalk.red("Workspace not found."));
        return;
      }
      if (ws.archived || ws.deleting || ws.deleting_at) {
        console.log(
          chalk.yellow(
            "Workspace is archived, being deleted, or scheduled for deletion. No source info shown.",
          ),
        );
        return;
      }
      if (!ws.source) {
        console.log(
          chalk.yellow("No source configuration found for this workspace."),
        );
        return;
      }
      console.log(
        chalk.blue("Source configuration for workspace:") +
          ` ${ws.name} (ID: ${ws.id})`,
      );
      Object.entries(ws.source).forEach(([key, value]) => {
        console.log(chalk.gray(key + ": ") + chalk.cyan(value));
      });
    } catch (error) {
      console.error(
        chalk.red("Error fetching source configuration:"),
        error.message,
      );
    }
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
    if (ws.task_notification_groups && ws.task_notification_groups.length > 0) {
      console.log(
        chalk.gray("Task Notification Groups: ") +
          chalk.yellow(ws.task_notification_groups.join(", ")),
      );
    } else {
      console.log(
        chalk.gray("Task Notification Groups: ") + chalk.gray("Disabled"),
      );
    }
  }
}

export async function deleteWorkspace(
  workspaceIdentifier,
  cancel = false,
  deletionDays,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  try {
    // First, get the current workspace to check if it's already being deleted
    const data = await graphQuery(GET_WORKSPACE_QUERY, {
      id: workspaceId,
    });
    const ws = data.getAutomationEnvironment;

    if (!ws) {
      console.log(chalk.red("Workspace not found."));
      return;
    }

    if (cancel) {
      if (!ws.deleting) {
        console.log(chalk.yellow("Workspace is not being deleted."));
        return;
      }
      // Cancel deletion
      await graphQuery(DELETE_WORKSPACE_MUTATION, {
        id: workspaceId,
        delete: false,
      });
      console.log(chalk.green(`Deletion cancelled for workspace [${ws.name}]`));
    } else {
      if (ws.deleting) {
        console.log(chalk.yellow("Workspace is already being deleted."));
        console.log(chalk.yellow("Use --cancel to cancel the deletion."));
        return;
      }
      // Start deletion
      await graphQuery(DELETE_WORKSPACE_MUTATION, {
        id: workspaceId,
        delete: true,
        deletionDays: deletionDays,
      });
      console.log(chalk.green(`Deletion started for workspace [${ws.name}]`));
      if (deletionDays) {
        console.log(
          chalk.gray(
            `Workspace will be permanently deleted in ${deletionDays} days.`,
          ),
        );
      }
    }
  } catch (error) {
    console.error(
      chalk.red("Error managing workspace deletion:"),
      error.message,
    );
  }
}

export async function archiveWorkspace(workspaceIdentifier, unarchive = false) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  try {
    // First, get the current workspace to check its archive status
    const data = await graphQuery(GET_WORKSPACE_QUERY, {
      id: workspaceId,
    });
    const ws = data.getAutomationEnvironment;

    if (!ws) {
      console.log(chalk.red("Workspace not found."));
      return;
    }

    if (unarchive) {
      if (!ws.archived) {
        console.log(chalk.yellow("Workspace is not archived."));
        return;
      }
      // Unarchive workspace
      await graphQuery(ARCHIVE_WORKSPACE_MUTATION, {
        id: workspaceId,
        archive: false,
      });
      console.log(
        chalk.green(`Workspace [${ws.name}] unarchived successfully.`),
      );
    } else {
      if (ws.archived) {
        console.log(chalk.yellow("Workspace is already archived."));
        return;
      }
      // Archive workspace
      await graphQuery(ARCHIVE_WORKSPACE_MUTATION, {
        id: workspaceId,
        archive: true,
      });
      console.log(chalk.green(`Workspace [${ws.name}] archived successfully.`));
    }
  } catch (error) {
    console.error(
      chalk.red("Error managing workspace archive:"),
      error.message,
    );
  }
}

export async function updateWorkspace(workspaceIdentifier, options) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  try {
    // First, get the current workspace to get existing values
    const data = await graphQuery(GET_WORKSPACE_QUERY, {
      id: workspaceId,
    });
    const ws = data.getAutomationEnvironment;

    if (!ws) {
      console.log(chalk.red("Workspace not found."));
      return;
    }

    // Prepare update data with existing values as defaults
    const updateData = {
      id: workspaceId,
      name: options.name || ws.name,
      tags:
        options.tags !== undefined
          ? options.tags.trim() === ""
            ? []
            : options.tags.split(",").map((tag) => tag.trim())
          : ws.tags || [],
      health_enabled:
        options.health_enabled !== undefined
          ? options.health_enabled
          : ws.health_enabled,
      task_notification_groups:
        options.notification_groups !== undefined
          ? options.notification_groups.trim() === ""
            ? null
            : options.notification_groups
                .split(",")
                .map((group) => group.trim())
          : ws.task_notification_groups || null,
    };

    // Update workspace
    await graphQuery(SAVE_WORKSPACE_MUTATION, updateData);
    console.log(chalk.green(`Workspace [${ws.name}] updated successfully.`));
  } catch (error) {
    console.error(chalk.red("Error updating workspace:"), error.message);
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

// Edit source config for a workspace
export async function sourceEdit(workspaceIdentifier, options) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  let config = {};
  if (options.file) {
    try {
      const fileContent = fs.readFileSync(options.file, "utf-8");
      config = JSON.parse(fileContent);
    } catch (err) {
      console.error(
        chalk.red("Failed to read or parse config file:"),
        err.message,
      );
      return;
    }
  } else {
    const data = await graphQuery(GET_SOURCE_QUERY, { id: workspaceId });
    const ws = data.getAutomationEnvironment;

    if (!ws) {
      console.log(chalk.red("Workspace not found."));
      return;
    }

    if (ws.archived || ws.deleting || ws.deleting_at) {
      console.log(
        chalk.yellow(
          "Workspace is archived, being deleted, or scheduled for deletion. Cannot sync.",
        ),
      );
      return;
    }
    // Accept CLI options for each field
    config = {
      url: options.url || ws.source.url || null,
      username: options.username || ws.source.username || null,
      apikey: options.apikey || ws.source.apikey || null,
      branch: options.branch || ws.source.branch || null,
      enabled: options.enabled || ws.source.enabled || false,
      source_automatic:
        options.source_automatic || ws.source.source_automatic || false,
    };
  }

  // Remove undefined fields
  Object.keys(config).forEach(
    (k) => config[k] === undefined && delete config[k],
  );

  try {
    await graphQuery(SAVE_SOURCE_MUTATION, { id: workspaceId, ...config });
    console.log(chalk.green("Source configuration updated successfully."));
  } catch (error) {
    console.error(
      chalk.red("Error updating source configuration:"),
      error.message,
    );
  }
}

// Sync source for a workspace
export async function syncSource(workspaceIdentifier) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  try {
    const data = await graphQuery(GET_SOURCE_QUERY, { id: workspaceId });
    const ws = data.getAutomationEnvironment;

    if (!ws) {
      console.log(chalk.red("Workspace not found."));
      return;
    }

    if (ws.archived || ws.deleting || ws.deleting_at) {
      console.log(
        chalk.yellow(
          "Workspace is archived, being deleted, or scheduled for deletion. Cannot sync.",
        ),
      );
      return;
    }

    if (!ws.source) {
      console.log(
        chalk.yellow("No source configuration found for this workspace."),
      );
      return;
    }

    if (ws.source.source_automatic) {
      console.log(
        chalk.yellow("Source automatic sync is enabled for this workspace."),
      );
      return;
    }

    // Use SAVE_SOURCE_MUTATION to trigger sync with current values and source_do_sync: true
    await graphQuery(SAVE_SOURCE_MUTATION, {
      id: workspaceId,
      url: ws.source.url,
      username: ws.source.username,
      apikey: "", // Preserve API key presence
      branch: ws.source.branch,
      enabled: ws.source.enabled,
      source_automatic: ws.source.source_automatic,
      source_do_sync: true,
    });

    console.log(
      chalk.green("Source sync triggered successfully for workspace:") +
        ` ${ws.name} (ID: ${ws.id})`,
    );
  } catch (error) {
    console.error(chalk.red("Error triggering source sync:"), error.message);
  }
}

export async function getWorkspace(identifier) {
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
    (env) =>
      env.name.toLowerCase() === identifier.toLowerCase() ||
      env.id === identifier,
  );

  return workspace || null;
}
