import { Command } from "commander";
import chalk from "chalk";
import { graphQuery } from "../../utils.js";
import {
  LIST_AUTOMATION_LIBS_QUERY,
  REMOVE_AUTOMATION_LIB_MUTATION,
  UPDATE_AUTOMATION_LIB_MUTATION,
  GET_AUTOMATION_LIB_QUERY,
} from "./query.js";
import { resolveWorkspaceId } from "../../context.js";
import { CliError, UsageError, failure } from "../../runtime.js";
import { resolveByIdOrName, assertNameFree } from "../../names.js";
import { libraryResource, parseLibraryFile } from "../../resources/library.js";
import { pull, sync } from "../../resources/engine.js";

export { parseLibraryFile };

// Every library in the workspace: what library names are resolved against (PLAT-115).
const listWorkspaceLibraries = (workspaceId) =>
  libraryResource.list(workspaceId);

// A library id or a library name (unique in the workspace) to the library's id; anything else is refused.
async function resolveLibraryId(ref, workspaceId) {
  return resolveByIdOrName(
    await listWorkspaceLibraries(workspaceId),
    ref,
    "library",
  ).id;
}

export async function listLibraries(workspaceIdentifier, filterName = null) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  try {
    const data = await graphQuery(LIST_AUTOMATION_LIBS_QUERY, {
      id: workspaceId,
      name: filterName,
    });
    const libraries = data.listAutomationLibs;

    if (!libraries || libraries.length === 0) {
      console.log(chalk.yellow("No libraries found in current workspace."));
      return;
    }

    console.log(chalk.blue("\n📚 Libraries in Current Workspace\n"));
    libraries.forEach((library) => {
      console.log(`${chalk.bold(library.name)}`);
      console.log(`   ID: ${library.id}`);
      console.log(`   Namespace: ${library.namespace}`);
      console.log(
        `   Enabled: ${library.enabled ? chalk.green("Yes") : chalk.red("No")}`,
      );
      console.log(`   Tags: ${library.tags?.join(", ") || "None"}`);
      console.log(`   Version: ${library.version}`);
      console.log(`   Created: ${library.createdAt}`);
      console.log(`   Updated: ${library.updatedAt}\n`);
    });
  } catch (error) {
    throw failure("Error fetching libraries:", error);
  }
}

export async function showLibrary(libraryRef, workspaceIdentifier) {
  if (!libraryRef) {
    throw new UsageError("⚠ Please provide a library ID.");
  }
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  try {
    const libraryId = await resolveLibraryId(libraryRef, workspaceId);
    const data = await graphQuery(GET_AUTOMATION_LIB_QUERY, {
      id: libraryId,
    });
    const library = data.getAutomationLib;

    if (!library) {
      throw new CliError(`Library with ID ${libraryId} not found.`);
    }

    console.log(chalk.blue("\n📚 Library Details\n"));
    console.log(`${chalk.bold("Name:")} ${library.name}`);
    console.log(`${chalk.bold("ID:")} ${library.id}`);
    console.log(`${chalk.bold("Namespace:")} ${library.namespace || "N/A"}`);
    console.log(`${chalk.bold("Version:")} ${library.version}`);
    console.log(
      `${chalk.bold("Enabled:")} ${library.enabled ? chalk.green("Yes") : chalk.red("No")}`,
    );
    console.log(`${chalk.bold("Tags:")} ${library.tags?.join(", ") || "None"}`);

    if (library.types) {
      console.log(`\n${chalk.bold("Types:")}\n${library.types}`);
    }

    if (library.content) {
      console.log(`\n${chalk.bold("Content:")}\n${library.content.content}`);
    }
  } catch (error) {
    throw failure("Error fetching library details:", error);
  }
}

export async function addLibrary(
  name,
  namespace,
  workspaceIdentifier,
  filePath = null,
  tags = [],
  enabled = true,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  try {
    // Names are unique per workspace
    assertNameFree(
      await listWorkspaceLibraries(workspaceId),
      name.trim(),
      "library",
    );

    // Create the library first
    const libraryId = await libraryResource.create(name.trim(), workspaceId);
    console.log(
      chalk.green(`Created library [${name.trim()}] with ID: ${libraryId}`),
    );

    // Then save it once, with or without a file: namespace, tags and enabled only reach the API that way (M17)
    let parsed = {};
    if (filePath) {
      try {
        parsed = await parseLibraryFile(filePath);
      } catch (error) {
        throw failure("Error reading or parsing file:", error);
      }
    }
    const saved = await libraryResource.save(
      libraryResource.saveVars(libraryResource.blank(libraryId, name.trim()), {
        ...parsed,
        namespace,
        tags,
        enabled,
      }),
    );
    if (saved && filePath) {
      console.log(
        chalk.green(
          `Successfully added library content from file: ${filePath}`,
        ),
      );
    }
  } catch (error) {
    throw failure("Error creating library:", error);
  }
}

export async function updateLibrary(
  libraryRef,
  workspaceIdentifier,
  filePath = null,
  namespace = null,
  tags = null,
  enabled = null,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  if (!libraryRef) {
    throw new UsageError("⚠ Please provide a library ID.");
  }

  try {
    const libraryId = await resolveLibraryId(libraryRef, workspaceId);
    // Get current library details
    const currentData = await graphQuery(GET_AUTOMATION_LIB_QUERY, {
      id: libraryId,
    });
    const currentLibrary = currentData.getAutomationLib;

    if (!currentLibrary) {
      throw new CliError(`Library with ID ${libraryId} not found.`);
    }

    // Use provided values or fall back to current values
    const newNamespace = namespace || currentLibrary.namespace;
    const newTags = tags || currentLibrary.tags || [];
    const newEnabled = enabled !== null ? enabled : currentLibrary.enabled;

    // If a file is provided, parse it for new content and types;
    // otherwise keep the library's current content and types.
    let newContent = currentLibrary.content?.content || "";
    let newTypes = currentLibrary.types || "";
    if (filePath) {
      const parsed = await parseLibraryFile(filePath);
      newContent = parsed.content;
      newTypes = parsed.types;
    }

    // Update the library
    const updateData = await graphQuery(UPDATE_AUTOMATION_LIB_MUTATION, {
      id: libraryId,
      name: currentLibrary.name,
      namespace: newNamespace,
      content: newContent,
      types: newTypes,
      version: currentLibrary.version,
      tags: newTags,
      enabled: newEnabled,
    });

    if (updateData.saveAutomationLib) {
      console.log(
        chalk.green(`Successfully updated library: ${currentLibrary.name}`),
      );
    } else {
      throw new CliError("Failed to update library.");
    }
  } catch (error) {
    throw failure("Error updating library:", error);
  }
}

export async function deleteLibrary(libraryRef, workspaceIdentifier) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  if (!libraryRef) {
    throw new UsageError("⚠ Please provide a library ID.");
  }

  try {
    const libraryId = await resolveLibraryId(libraryRef, workspaceId);
    const data = await graphQuery(REMOVE_AUTOMATION_LIB_MUTATION, {
      id: libraryId,
      environment_id: workspaceId,
    });

    if (data.deleteAutomationLib) {
      console.log(
        chalk.green(`Successfully deleted library with ID: ${libraryId}`),
      );
    } else {
      throw new CliError(
        `Library with ID ${libraryId} not found or could not be deleted.`,
      );
    }
  } catch (error) {
    throw failure("Error deleting library:", error);
  }
}

export async function pullLibrary(workspaceIdentifier, libraryRef, targetPath) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  await pull(libraryResource, workspaceId, libraryRef, targetPath);
}

export async function syncLibrary(
  workspaceIdentifier,
  libraryRef,
  sourcePath,
  noPrompt = false,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  await sync(libraryResource, workspaceId, libraryRef, sourcePath, noPrompt);
}

export function register(program) {
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
        .argument("<id>", "Library ID or name")
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
        .option(
          "-e, --enabled <enabled>",
          "Enable/disable library (true/false)",
          "true",
        )
        .action(async (name, namespace, options) => {
          const enabled = options.enabled === "true";
          const tags = options.tags
            ? options.tags.split(",").map((t) => t.trim())
            : [];
          await addLibrary(
            name,
            namespace,
            options.workspace,
            options.file,
            tags,
            enabled,
          );
        }),
    )
    .addCommand(
      new Command("update")
        .description("Update a library")
        .argument("<id>", "Library ID or name")
        .option("-w, --workspace <id>", "Workspace ID")
        .option(
          "-f, --file <path>",
          "Path to file containing library types and content",
        )
        .option("-n, --namespace <namespace>", "Library namespace")
        .option("-t, --tags <tags>", "Comma-separated list of tags")
        .option(
          "-e, --enabled <enabled>",
          "Enable/disable library (true/false)",
        )
        .action(async (id, options) => {
          const enabled =
            options.enabled !== undefined
              ? options.enabled === "true"
              : undefined;
          const tags = options.tags
            ? options.tags.split(",").map((t) => t.trim())
            : undefined;
          await updateLibrary(
            id,
            options.workspace,
            options.file,
            options.namespace,
            tags,
            enabled,
          );
        }),
    )
    .addCommand(
      new Command("delete")
        .description("Delete a library")
        .argument("<id>", "Library ID or name")
        .option("-w, --workspace <id>", "Workspace ID")
        .action(async (id, options) => {
          await deleteLibrary(id, options.workspace);
        }),
    )
    .addCommand(
      new Command("pull")
        .description("Pull libraries from workspace to local files")
        .option("-w, --workspace <id>", "Workspace ID")
        .option(
          "-l, --library <id>",
          "Library ID or name (if not specified, pulls all libraries)",
        )
        .option("-p, --path <path>", "Target path (default: current directory)")
        .action(async (options) => {
          await pullLibrary(options.workspace, options.library, options.path);
        }),
    )
    .addCommand(
      new Command("sync")
        .description("Sync local library files to workspace")
        .option("-w, --workspace <id>", "Workspace ID")
        .option(
          "-l, --library <id>",
          "Library ID or name (if not specified, syncs all libraries)",
        )
        .option("-p, --path <path>", "Source path (default: current directory)")
        .action(async (options) => {
          await syncLibrary(options.workspace, options.library, options.path);
        }),
    );
}
