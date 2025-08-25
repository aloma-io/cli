#!/usr/bin/env node
import { Command } from "commander";
import { initiateAuth, clearSessionData } from "./commands/auth/index.js";
import chalk from "chalk";
import {
  listWorkspaces,
  createWorkspace,
  showWorkspace,
  switchWorkspace,
  deleteWorkspace,
  archiveWorkspace,
  updateWorkspace,
  sourceEdit,
  syncSource,
} from "./commands/workspace/index.js";
import {
  addCompany,
  listCompanies,
  switchCompany,
} from "./commands/company/index.js";
import {
  addStep,
  listSteps,
  showStep,
  deleteStep,
  editStep,
  cloneStep,
  pullStep,
  syncStep,
} from "./commands/step/index.js";
import {
  listLibraries,
  showLibrary,
  addLibrary,
  updateLibrary,
  deleteLibrary,
  pullLibrary,
  syncLibrary,
} from "./commands/library/index.js";
import {
  listTasks,
  showTask,
  createTask,
  cloneTask,
  stopTask,
  resumeTask,
} from "./commands/task/index.js";
import {
  listWebhooks,
  addWebhook,
  deleteWebhook,
  showWebhook,
} from "./commands/webhook/index.js";
import {
  listSecrets,
  addSecret,
  deleteSecret,
} from "./commands/secret/index.js";
import { deployFromYaml } from "./commands/deploy/index.js";
import {
  listConnectors,
  addConnector,
  removeConnector,
  getConnector,
  listAvailableConnectors,
  updateConnector,
  getConnectorLogs,
  startConnectorOAuth,
} from "./commands/connector/index.js";
import {
  listUsers,
  inviteUsers,
  updateUser,
  removeUser,
} from "./commands/user/index.js";
import { setupCLIConfig } from "./setup.js";
const program = new Command();

program
  .name("aloma")
  .description("CLI for interacting with Aloma services and utilities")
  .version("1.0.0"); // Fetches version from package.json

program
  .command("auth")
  .alias("login")
  .description("Authenticate with Aloma via browser and store session token")
  .action(async () => {
    console.log("Initiating authentication flow...");
    console.log("Please follow the instructions in your browser.");
    try {
      await initiateAuth();
      // Success message is printed within initiateAuth/callback handler
    } catch (error) {
      console.error("\nAuthentication failed:", error.message);
      // More detailed error might be logged within initiateAuth
      process.exit(1); // Exit with error code
    }
  });

program
  .command("logout")
  .description("Clear the stored Aloma session token")
  .action(async () => {
    await clearSessionData();
  });

// Workspace commands
program
  .command("workspace")
  .description("Manage Aloma workspaces")
  .addCommand(
    new Command("list")
      .description("List all automation workspaces")
      .option("-f, --filter-name <name>", "Filter workspaces by name")
      .option(
        "-t, --tags <tags>",
        "Comma-separated list of tags for the workspace",
      )
      .option("-a --archived", "Show archived workspaces")
      .action(async (options) => {
        await listWorkspaces(
          options.filterName,
          options.tags,
          options.archived,
        );
      }),
  )
  .addCommand(
    new Command("show")
      .description("Show current workspace")
      .option("-s, --stats", "Show workspace stats")
      .option("-sc, --source", "Show source config")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (options) => {
        await showWorkspace(options.workspace, options.stats, options.source);
      }),
  )
  .addCommand(
    new Command("switch")
      .argument("<identifier>", "Workspace name or ID")
      .description("Switch to a different workspace by name or ID")
      .action(async (identifier) => {
        await switchWorkspace(identifier);
      }),
  )
  .addCommand(
    new Command("add")
      .argument("<name>", "Workspace name")
      .description("Create a new workspace")
      .option(
        "-t, --tags <tags>",
        "Comma-separated list of tags for the workspace",
      )
      .action(async (name, options) => {
        await createWorkspace(name, options.tags);
      }),
  )
  .addCommand(
    new Command("delete")
      .description("Delete a workspace or cancel deletion")
      .argument(
        "[workspace]",
        "Workspace ID or name (uses current if not specified)",
      )
      .option("-c, --cancel", "Cancel workspace deletion")
      .option("-d, --days <days>", "Days until permanent deletion", "30")
      .action(async (workspace, options) => {
        const deletionDays = options.days ? parseInt(options.days) : undefined;
        await deleteWorkspace(workspace, options.cancel, deletionDays);
      }),
  )
  .addCommand(
    new Command("archive")
      .description("Archive or unarchive a workspace")
      .argument(
        "[workspace]",
        "Workspace ID or name (uses current if not specified)",
      )
      .option("-u, --unarchive", "Unarchive workspace")
      .action(async (workspace, options) => {
        await archiveWorkspace(workspace, options.unarchive);
      }),
  )
  .addCommand(
    new Command("update")
      .description("Update workspace settings")
      .argument(
        "[workspace]",
        "Workspace ID or name (uses current if not specified)",
      )
      .option("-n, --name <name>", "New workspace name")
      .option("-t, --tags <tags>", "Comma-separated list of tags")
      .option(
        "-h, --health-enabled <boolean>",
        "Enable/disable health checks (true/false)",
      )
      .option(
        "-g, --notification-groups <groups>",
        "Comma-separated list of notification groups",
      )
      .action(async (workspace, options) => {
        // Parse health_enabled boolean
        let healthEnabled;
        if (options.healthEnabled !== undefined) {
          healthEnabled = options.healthEnabled.toLowerCase() === "true";
        }

        await updateWorkspace(workspace, {
          name: options.name,
          tags: options.tags,
          health_enabled: healthEnabled,
          notification_groups: options.notificationGroups,
        });
      }),
  )
  .addCommand(
    new Command("source")
      .description("Edit the source configuration for the workspace")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-f, --file <path>", "Path to source config JSON file")
      .option("--url <url>", "Source URL")
      .option("--username <username>", "Source username")
      .option("--apikey <apikey>", "Source API key")
      .option("--branch <branch>", "Source branch")
      .option("--enabled <enabled>", "Source enabled (true/false)")
      .option(
        "--source-automatic <source_automatic>",
        "Source automatic (true/false)",
      )
      .action(async (options) => {
        // Convert string booleans to actual booleans if present
        if (options.enabled !== undefined)
          options.enabled = options.enabled === "true";
        if (options.sourceAutomatic !== undefined)
          options.source_automatic = options.sourceAutomatic === "true";
        await sourceEdit(options.workspace, options);
      }),
  )
  .addCommand(
    new Command("sync")
      .description("Trigger source sync for the workspace")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (options) => {
        await syncSource(options.workspace);
      }),
  );

// Company commands
program
  .command("company")
  .description("Manage Aloma companies")
  .addCommand(
    new Command("list")
      .description("List all available companies")
      .action(async () => {
        await listCompanies();
      }),
  )
  .addCommand(
    new Command("switch")
      .argument("<identifier>", "Company name or ID")
      .description("Switch to a different company by name or ID")
      .action(async (identifier) => {
        await switchCompany(identifier);
      }),
  )
  .addCommand(
    new Command("add")
      .argument("<name>", "Company name")
      .description("Create a new company (admin only)")
      .option(
        "-e, --emails <emails>",
        "Comma-separated list of emails to invite",
      )
      .action(async (name, options) => {
        await addCompany(name, options.emails);
      }),
  );

// Step commands
program
  .command("step")
  .description("Manage steps")
  .addCommand(
    new Command("list")
      .description("List all steps")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-n, --name <name>", "Filter steps by name")
      .option("-d, --include-disabled", "Include disabled steps")
      .action(async (options) => {
        await listSteps(
          options.includeDisabled,
          options.workspace,
          options.name,
        );
      }),
  )
  .addCommand(
    new Command("show")
      .description("Show step details")
      .argument("<id>", "Step ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await showStep(id, options.workspace);
      }),
  )
  .addCommand(
    new Command("add")
      .description("Add a new step")
      .argument("<name>", "Step name")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-t, --type <type>", "Step type")
      .option(
        "-f, --file <path>",
        "Path to file containing step condition and content",
      )
      .action(async (name, options) => {
        await addStep(name, options.workspace, options.type, options.file);
      }),
  )
  .addCommand(
    new Command("delete")
      .description("Delete a step")
      .argument("<id>", "Step ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await deleteStep(id, options.workspace);
      }),
  )
  .addCommand(
    new Command("edit")
      .description("Edit a step")
      .argument("<id>", "Step ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await editStep(id, options.workspace);
      }),
  )
  .addCommand(
    new Command("clone")
      .description("Clone a step")
      .argument("<id>", "Step ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await cloneStep(id, options.workspace);
      }),
  )
  .addCommand(
    new Command("pull")
      .description("Pull steps from workspace to local files")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-s, --step <id>", "Step ID (if not specified, pulls all steps)")
      .option("-p, --path <path>", "Target path (default: current directory)")
      .action(async (options) => {
        await pullStep(options.workspace, options.step, options.path);
      }),
  )
  .addCommand(
    new Command("sync")
      .description("Sync local step files to workspace")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-s, --step <id>", "Step ID (if not specified, syncs all steps)")
      .option("-p, --path <path>", "Source path (default: current directory)")
      .action(async (options) => {
        await syncStep(options.workspace, options.step, options.path);
      }),
  );

// Library commands
program
  .command("library")
  .description("Manage automation libraries")
  .addCommand(
    new Command("list")
      .description("List all libraries")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-n, --name <name>", "Filter libraries by name")
      .action(async (options) => {
        await listLibraries(options.workspace, options.name);
      }),
  )
  .addCommand(
    new Command("show")
      .description("Show library details")
      .argument("<id>", "Library ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await showLibrary(id, options.workspace);
      }),
  )
  .addCommand(
    new Command("add")
      .description("Add a new library")
      .argument("<name>", "Library name")
      .argument("<namespace>", "Library namespace")
      .option("-w, --workspace <id>", "Workspace ID")
      .option(
        "-f, --file <path>",
        "Path to file containing library types and content",
      )
      .option("-t, --tags <tags>", "Comma-separated list of tags")
      .option("-e, --enabled <enabled>", "Enable/disable library (true/false)", "true")
      .action(async (name, namespace, options) => {
        const enabled = options.enabled === "true";
        const tags = options.tags ? options.tags.split(",").map(t => t.trim()) : [];
        await addLibrary(name, namespace, options.workspace, options.file, tags, enabled);
      }),
  )
  .addCommand(
    new Command("update")
      .description("Update a library")
      .argument("<id>", "Library ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .option(
        "-f, --file <path>",
        "Path to file containing library types and content",
      )
      .option("-n, --namespace <namespace>", "Library namespace")
      .option("-t, --tags <tags>", "Comma-separated list of tags")
      .option("-e, --enabled <enabled>", "Enable/disable library (true/false)")
      .action(async (id, options) => {
        const enabled = options.enabled !== undefined ? options.enabled === "true" : undefined;
        const tags = options.tags ? options.tags.split(",").map(t => t.trim()) : undefined;
        await updateLibrary(id, options.workspace, options.file, options.namespace, tags, enabled);
      }),
  )
  .addCommand(
    new Command("delete")
      .description("Delete a library")
      .argument("<id>", "Library ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await deleteLibrary(id, options.workspace);
      }),
  )
  .addCommand(
    new Command("pull")
      .description("Pull libraries from workspace to local files")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-l, --library <id>", "Library ID (if not specified, pulls all libraries)")
      .option("-p, --path <path>", "Target path (default: current directory)")
      .action(async (options) => {
        await pullLibrary(options.workspace, options.library, options.path);
      }),
  )
  .addCommand(
    new Command("sync")
      .description("Sync local library files to workspace")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-l, --library <id>", "Library ID (if not specified, syncs all libraries)")
      .option("-p, --path <path>", "Source path (default: current directory)")
      .action(async (options) => {
        await syncLibrary(options.workspace, options.library, options.path);
      }),
  );

// Task commands
program
  .command("task")
  .description("Manage tasks")
  .addCommand(
    new Command("list")
      .description("List all tasks")
      .option("-w, --workspace <id>", "Workspace ID")
      .option(
        "-s, --state <state>",
        "Filter by state (null, done, attention, error, ignored)",
      )
      .option("-n, --name <name>", "Filter by task name")
      .action(async (options) => {
        await listTasks(1, options.workspace, options.state, options.name);
      }),
  )
  .addCommand(
    new Command("log")
      .description("Log task details")
      .argument("<id>", "Task ID")
      .option("--logs", "Show console and audit logs for each step")
      .option("--changes", "Show diff changes for each step")
      .option("--inspect", "Show task data after each step")
      .option("--step <number>", "Show logs/changes for a specific step number")
      .action(async (id, options) => {
        await showTask(id, options);
      }),
  )
  .addCommand(
    new Command("new")
      .description("Create a new task")
      .argument("<name>", "Task name")
      .option("-w, --workspace <id>", "Workspace ID")
      .option(
        "-d, --data <json>",
        "JSON data to send with the task (e.g. '{\"test\":true}')",
      )
      .option("-f, --file <path>", "Path to YAML file containing task data")
      .action(async (name, options) => {
        await createTask(name, options.data, options.file, options.workspace);
      }),
  )
  .addCommand(
    new Command("clone")
      .description("Clone a task")
      .argument("<id>", "Task ID")
      .option("-s, --step <number>", "Step number to clone")
      .action(async (id, options) => {
        await cloneTask(id, options.step);
      }),
  )
  .addCommand(
    new Command("stop")
      .description("Stop a task")
      .argument("<id>", "Task ID")
      .action(async (id) => {
        await stopTask(id);
      }),
  )
  .addCommand(
    new Command("resume")
      .description("Resume a task")
      .argument("<id>", "Task ID")
      .action(async (id) => {
        await resumeTask(id);
      }),
  );

// Webhook commands
program
  .command("webhook")
  .description("Manage webhooks")
  .addCommand(
    new Command("list")
      .description("List all webhooks")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (options) => {
        await listWebhooks(options.workspace);
      }),
  )
  .addCommand(
    new Command("show")
      .description("Show webhook details")
      .argument("<id>", "Webhook ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await showWebhook(id, options.workspace);
      }),
  )
  .addCommand(
    new Command("add")
      .description("Add a new webhook")
      .argument("<name>", "Webhook name")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (name, options) => {
        await addWebhook(name, options.workspace);
      }),
  )
  .addCommand(
    new Command("delete")
      .description("Delete a webhook")
      .argument("<id>", "Webhook ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await deleteWebhook(id, options.workspace);
      }),
  );

// Secret commands
program
  .command("secret")
  .description("Manage secrets")
  .addCommand(
    new Command("list")
      .description("List all secrets")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (options) => {
        await listSecrets(options.workspace);
      }),
  )
  .addCommand(
    new Command("add")
      .description("Add a new secret")
      .argument("<name>", "Secret name")
      .argument("<value>", "Secret value")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-d, --description <description>", "Secret description")
      .option("-e, --encrypted", "Mark secret as encrypted")
      .option("-o, --options <yaml>", "YAML options for the secret")
      .action(async (name, value, options) => {
        let secretOptions = {};
        if (options.options) {
          try {
            secretOptions = yaml.load(options.options);
          } catch (error) {
            console.error(chalk.red("Invalid JSON in options:"), error.message);
            return;
          }
        }
        await addSecret(
          name,
          value,
          options.description,
          options.encrypted,
          secretOptions,
          options.workspace,
        );
      }),
  )
  .addCommand(
    new Command("delete")
      .description("Delete a secret")
      .argument("<name>", "Secret name")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (name, options) => {
        await deleteSecret(name, options.workspace);
      }),
  );

// Connector commands
program
  .command("connector")
  .description("Manage connectors")
  .addCommand(
    new Command("list")
      .description("List all connectors")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (options) => {
        await listConnectors(options.workspace);
      }),
  )
  .addCommand(
    new Command("list-available")
      .description(
        "List all available connector types and their configurations",
      )
      .option("-f, --filter-name <name>", "Filter connectors by name")
      .action(async (options) => {
        await listAvailableConnectors(null, options.filterName);
      }),
  )
  .addCommand(
    new Command("show")
      .description("Show connector details")
      .argument("<id>", "Connector ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await getConnector(id, options.workspace);
      }),
  )
  .addCommand(
    new Command("add")
      .description("Add a new connector")
      .argument("<connectorId>", "Connector ID")
      .option("-n, --name <name>", "Connector name")
      .option("-ns, --namespace <namespace>", "Connector namespace")
      .option("-t, --tags <tags>", "Comma-separated list of tags")
      .option("-s, --shared", "Share connector in realm")
      .option("-c, --config <json>", "JSON configuration for the connector")
      .option(
        "-f, --file <path>",
        "Path to JSON or YAML file containing connector configuration",
      )
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (connectorId, options) => {
        // Parse tags from comma-separated string
        const tags = options.tags ? options.tags.split(",") : undefined;
        // Parse config from JSON string
        const config = options.config ? JSON.parse(options.config) : undefined;

        await addConnector(
          connectorId,
          options.workspace,
          options.name,
          options.namespace,
          tags,
          options.shared,
          config,
          options.file,
        );
      }),
  )
  .addCommand(
    new Command("delete")
      .description("Delete a connector")
      .argument("<id>", "Connector ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await removeConnector(id, options.workspace);
      }),
  )
  .addCommand(
    new Command("update")
      .description("Update a connector")
      .argument("<id>", "Connector ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-n, --name <name>", "Connector name")
      .option("-ns, --namespace <namespace>", "Connector namespace")
      .option("-t, --tags <tags>", "Comma-separated list of tags")
      .option("-s, --shared", "Share connector in realm")
      .option("-c, --config <json>", "JSON configuration for the connector")
      .option(
        "-f, --file <path>",
        "Path to JSON file containing connector configuration",
      )
      .action(async (id, options) => {
        await updateConnector(
          id,
          options.workspace,
          options.name,
          options.namespace,
          options.tags,
          options.shared,
          options.config,
          options.file,
        );
      }),
  )
  .addCommand(
    new Command("logs")
      .description("View logs for a connector")
      .argument("<id>", "Connector ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .action(async (id, options) => {
        await getConnectorLogs(id, options.workspace);
      }),
  )
  .addCommand(
    new Command("oauth")
      .description("Start OAuth process for a connector")
      .argument("<id>", "Connector ID")
      .option("-w, --workspace <id>", "Workspace ID")
      .option("-d, --development", "Start OAuth in development mode")
      .action(async (id, options) => {
        await startConnectorOAuth(id, options.workspace, options.development);
      }),
  );

// User commands
program
  .command("user")
  .description("Manage users")
  .addCommand(
    new Command("list")
      .description("List all users in the current company")
      .action(async () => {
        await listUsers();
      }),
  )
  .addCommand(
    new Command("invite")
      .description("Invite a new user to the current company")
      .argument("<emails>", "Comma-separated list of user emails")
      .option(
        "-r, --roles <roles>",
        "Comma-separated list of roles to invite the user with",
      )
      .action(async (emails, options) => {
        await inviteUsers(emails, options.roles);
      }),
  )
  .addCommand(
    new Command("update")
      .description("Update a user")
      .argument("<id>", "User ID")
      .option(
        "-r, --roles <roles>",
        "Comma-separated list of roles to update the user with",
      )
      .action(async (id, options) => {
        await updateUser(id, options.roles);
      }),
  )
  .addCommand(
    new Command("remove")
      .description("Remove a user from the current company")
      .argument("<id>", "User ID")
      .action(async (id) => {
        await removeUser(id);
      }),
  );

// Deploy commands
program
  .command("deploy")
  .description("Deploy resources from a YAML configuration file")
  .argument("<yamlPath>", "Path to the YAML configuration file")
  // .option('-f, --force', 'Force overwrite existing resources')
  .action(async (yamlPath, options) => {
    try {
      await deployFromYaml(yamlPath);
      // await deployFromYaml(yamlPath, { force: options.force });
    } catch (error) {
      console.error(chalk.red("Deployment failed:"), error.message);
      process.exit(1);
    }
  });

// Setup command
program
  .command("setup")
  .description("Setup Aloma CLI configuration")
  .option("-f, --force", "Force overwrite existing configuration")
  .action(async (options) => {
    try {
      await setupCLIConfig({ force: options.force });
    } catch (error) {
      console.error(chalk.red("Setup failed:"), error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);

// Export for programmatic use
export default program;
