import chalk from "chalk";
import { graphQuery } from "../../utils.js";
import {
  LIST_AUTOMATION_LIBS_QUERY,
  ADD_AUTOMATION_LIB_MUTATION,
  REMOVE_AUTOMATION_LIB_MUTATION,
  UPDATE_AUTOMATION_LIB_MUTATION,
  GET_AUTOMATION_LIB_QUERY,
} from "./query.js";
import fs from "fs/promises";
import path from "path";
import { resolveWorkspaceId } from "../workspace/index.js";
import readline from "readline";
import parser from "@babel/parser";
import generate from "@babel/generator";

export async function listLibraries(workspaceIdentifier, filterName = null) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

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
    console.error(chalk.red("Error fetching libraries:"), error.message);
  }
}

export async function showLibrary(libraryId, workspaceIdentifier) {
  if (!libraryId) {
    console.log(chalk.yellow("⚠ Please provide a library ID."));
    return;
  }

  try {
    const data = await graphQuery(GET_AUTOMATION_LIB_QUERY, {
      id: libraryId,
    });
    const library = data.getAutomationLib;

    if (!library) {
      console.log(chalk.yellow(`Library with ID ${libraryId} not found.`));
      return;
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
    console.error(chalk.red("Error fetching library details:"), error.message);
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
  if (!workspaceId) return;

  try {
    // Create the library first
    const data = await graphQuery(ADD_AUTOMATION_LIB_MUTATION, {
      name: name.trim(),
      environment_id: workspaceId,
    });

    const libraryId = data.createAutomationLib;
    console.log(
      chalk.green(`Created library [${name.trim()}] with ID: ${libraryId}`),
    );

    // If a file path is provided, read and parse it
    if (filePath) {
      try {
        const { types: newTypes, content: newContent } =
          await parseLibraryFile(filePath);

        // Update the library with the parsed content
        const updateData = await graphQuery(UPDATE_AUTOMATION_LIB_MUTATION, {
          id: libraryId,
          name: name.trim(),
          namespace: namespace,
          content: newContent,
          types: newTypes,
          version: 0,
          tags: tags,
          enabled: enabled,
        });

        if (updateData.saveAutomationLib) {
          console.log(
            chalk.green(
              `Successfully added library content from file: ${filePath}`,
            ),
          );
        }
      } catch (error) {
        console.error(
          chalk.red(`Error reading or parsing file: ${error.message}`),
        );
      }
    }
  } catch (error) {
    console.error(chalk.red("Error creating library:"), error.message);
  }
}

export async function updateLibrary(
  libraryId,
  workspaceIdentifier,
  filePath = null,
  namespace = null,
  tags = null,
  enabled = null,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  if (!libraryId) {
    console.log(chalk.yellow("⚠ Please provide a library ID."));
    return;
  }

  try {
    // Get current library details
    const currentData = await graphQuery(GET_AUTOMATION_LIB_QUERY, {
      id: libraryId,
    });
    const currentLibrary = currentData.getAutomationLib;

    if (!currentLibrary) {
      console.log(chalk.yellow(`Library with ID ${libraryId} not found.`));
      return;
    }

    // Use provided values or fall back to current values
    const newNamespace = namespace || currentLibrary.namespace;
    const newTags = tags || currentLibrary.tags || [];
    const newEnabled = enabled !== null ? enabled : currentLibrary.enabled;

    // Update the library
    const updateData = await graphQuery(UPDATE_AUTOMATION_LIB_MUTATION, {
      id: libraryId,
      name: currentLibrary.name,
      namespace: newNamespace,
      content: currentLibrary.content.content || "",
      types: currentLibrary.types || "",
      version: currentLibrary.version,
      tags: newTags,
      enabled: newEnabled,
    });

    if (updateData.saveAutomationLib) {
      console.log(
        chalk.green(`Successfully updated library: ${currentLibrary.name}`),
      );
    } else {
      console.log(chalk.red("Failed to update library."));
    }
  } catch (error) {
    console.error(chalk.red("Error updating library:"), error.message);
  }
}

export async function deleteLibrary(libraryId, workspaceIdentifier) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  if (!libraryId) {
    console.log(chalk.yellow("⚠ Please provide a library ID."));
    return;
  }

  try {
    const data = await graphQuery(REMOVE_AUTOMATION_LIB_MUTATION, {
      id: libraryId,
      environment_id: workspaceId,
    });

    if (data.deleteAutomationLib) {
      console.log(
        chalk.green(`Successfully deleted library with ID: ${libraryId}`),
      );
    } else {
      console.log(
        chalk.yellow(
          `Library with ID ${libraryId} not found or could not be deleted.`,
        ),
      );
    }
  } catch (error) {
    console.error(chalk.red("Error deleting library:"), error.message);
  }
}

export async function pullLibrary(workspaceIdentifier, libraryId, targetPath) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  // Use current directory if no path specified
  const workspaceFolder = targetPath || process.cwd();

  try {
    // Create workspace folder if it doesn't exist
    await fs.mkdir(workspaceFolder, { recursive: true });

    if (libraryId) {
      // Pull specific library
      const data = await graphQuery(GET_AUTOMATION_LIB_QUERY, {
        id: libraryId,
      });
      const library = data.getAutomationLib;

      if (!library) {
        console.log(chalk.yellow(`Library with ID ${libraryId} not found.`));
        return;
      }

      await createLibraryFile(library, workspaceFolder);
      console.log(chalk.green(`Successfully pulled library: ${library.name}`));
    } else {
      // Pull all libraries
      const data = await graphQuery(LIST_AUTOMATION_LIBS_QUERY, {
        id: workspaceId,
      });
      const libraries = data.listAutomationLibs;

      if (!libraries || libraries.length === 0) {
        console.log(chalk.yellow("No libraries found in workspace."));
        return;
      }

      // Get full details for each library
      for (const librarySummary of libraries) {
        const libraryData = await graphQuery(GET_AUTOMATION_LIB_QUERY, {
          id: librarySummary.id,
        });
        const library = libraryData.getAutomationLib;
        if (library) {
          await createLibraryFile(library, workspaceFolder);
        }
      }

      console.log(
        chalk.green(
          `Successfully pulled ${libraries.length} libraries to: ${workspaceFolder}`,
        ),
      );
    }
  } catch (error) {
    console.error(chalk.red("Error pulling libraries:"), error.message);
  }
}

export async function syncLibrary(
  workspaceIdentifier,
  libraryId,
  sourcePath,
  noPrompt = false,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  // Use current directory if no path specified
  const workspaceFolder = sourcePath || process.cwd();

  // Helper to prompt for confirmation
  async function promptConfirmation(message) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(message, (answer) => {
        rl.close();
        resolve(
          answer.trim().toLowerCase() === "y" ||
            answer.trim().toLowerCase() === "yes",
        );
      });
    });
  }

  // Helper to recursively get all .js files in a directory
  async function getAllJsFiles(dir, baseDir = dir) {
    let results = [];
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const file of list) {
      const filePath = path.join(dir, file.name);
      if (file.isDirectory()) {
        results = results.concat(await getAllJsFiles(filePath, baseDir));
      } else if (file.isFile() && file.name.endsWith(".js")) {
        results.push({
          absPath: filePath,
          relPath: path.relative(baseDir, filePath),
        });
      }
    }
    return results;
  }

  try {
    // Check if workspace folder exists
    try {
      await fs.access(workspaceFolder);
    } catch (error) {
      console.log(
        chalk.yellow(`Workspace folder not found: ${workspaceFolder}`),
      );
      return;
    }

    if (libraryId) {
      // Sync specific library
      const data = await graphQuery(GET_AUTOMATION_LIB_QUERY, {
        id: libraryId,
      });
      const library = data.getAutomationLib;

      if (!library) {
        console.log(chalk.yellow(`Library with ID ${libraryId} not found.`));
        return;
      }

      // If the library name contains slashes, create subfolders accordingly
      const librarySegments = library.name.split("/");
      const fileName = `${librarySegments[librarySegments.length - 1]}.js`;
      const subfolders = librarySegments.slice(0, -1);
      const targetFolder = path.join(workspaceFolder, ...subfolders);
      const libraryFilePath = path.join(targetFolder, fileName);

      try {
        await fs.access(libraryFilePath);
        // Prompt for confirmation
        let confirmed = true;
        if (!noPrompt) {
          confirmed = await promptConfirmation(
            `Are you sure you want to overwrite the library '${library.name}' with the contents of '${libraryFilePath}'? (y/N): `,
          );
        }
        if (!confirmed) {
          console.log(chalk.yellow("Sync cancelled by user."));
          return;
        }
        try {
          await updateLibraryFromFile(library, libraryFilePath);
          console.log(
            chalk.green(`Successfully synced library: ${library.name}`),
          );
        } catch (error) {
          console.log(chalk.red(`Error updating library: ${library.name}`));
        }
      } catch (error) {
        console.log(chalk.yellow(`Library file not found: ${libraryFilePath}`));
      }
    } else {
      // Sync all libraries
      const data = await graphQuery(LIST_AUTOMATION_LIBS_QUERY, {
        id: workspaceId,
      });
      const libraries = data.listAutomationLibs || [];
      // Map library name to library object for quick lookup
      const libraryMap = new Map();
      for (const librarySummary of libraries) {
        libraryMap.set(librarySummary.name, librarySummary);
      }

      // Get all .js files in workspaceFolder recursively
      const jsFiles = await getAllJsFiles(workspaceFolder);
      if (jsFiles.length === 0) {
        console.log(
          chalk.yellow("No .js library files found in workspace folder."),
        );
        return;
      }

      // Prompt for confirmation ONCE
      let confirmed = true;
      if (!noPrompt) {
        confirmed = await promptConfirmation(
          `Are you sure you want to overwrite libraries in the workspace with the contents of ${jsFiles.length} file(s) from '${workspaceFolder}'? (y/N): `,
        );
      }
      if (!confirmed) {
        console.log(chalk.yellow("Sync cancelled by user."));
        return;
      }

      let updatedCount = 0;
      let createdCount = 0;
      for (const { absPath, relPath } of jsFiles) {
        // Derive library name from relPath (remove .js extension, convert path separators to /)
        const libraryName = relPath.replace(/\\/g, "/").replace(/\.js$/, "");
        const library = libraryMap.get(libraryName);
        if (library) {
          // Update existing library
          try {
            // Get full library details for update
            const libraryData = await graphQuery(GET_AUTOMATION_LIB_QUERY, {
              id: library.id,
            });
            const fullLibrary = libraryData.getAutomationLib;
            await updateLibraryFromFile(fullLibrary, absPath);
            updatedCount++;
          } catch (error) {
            console.log(chalk.red(`Error updating library: ${libraryName}`));
          }
        } else {
          // Create new library
          try {
            const { types: newTypes, content: newContent } =
              await parseLibraryFile(absPath);
            // Create the library first
            const createData = await graphQuery(ADD_AUTOMATION_LIB_MUTATION, {
              name: libraryName,
              environment_id: workspaceId,
            });
            const newLibraryId = createData.createAutomationLib;
            // Update the library with the parsed content
            await graphQuery(UPDATE_AUTOMATION_LIB_MUTATION, {
              id: newLibraryId,
              name: libraryName,
              namespace: libraryName.split("/")[0] || "default", // Use first part of name as namespace
              content: newContent,
              types: newTypes,
              version: 0,
              tags: [],
              enabled: true,
            });
            createdCount++;
          } catch (error) {
            console.log(chalk.red(`Error creating library: ${libraryName}`));
          }
        }
      }
      console.log(
        chalk.green(
          `Successfully synced libraries from: ${workspaceFolder}\nUpdated: ${updatedCount}, Created: ${createdCount}`,
        ),
      );
    }
  } catch (error) {
    console.error(chalk.red("Error syncing libraries:"), error.message);
  }
}

// Helper function to create library file
async function createLibraryFile(library, workspaceFolder) {
  // If the library name contains slashes, create subfolders accordingly
  const librarySegments = library.name.split("/");
  const fileName = `${librarySegments[librarySegments.length - 1]}.js`;
  const subfolders = librarySegments.slice(0, -1);
  const targetFolder = path.join(workspaceFolder, ...subfolders);
  await fs.mkdir(targetFolder, { recursive: true });
  const filePath = path.join(targetFolder, fileName);

  const fileContent = `/**
 * Library: ${library.name}
 * ID: ${library.id}
 * 
 * Edit the types and content below.
 * The types should be a function that returns type definitions.
 * The content should be JavaScript code with function implementations and exports.
 * 
 * Example:
 * types = () => {
 *   return "function processData(data: any): any";
 * };
 * 
 * content = () => {
 *   const processData = (data) => {
 *     return data.map(item => ({ ...item, processed: true }));
 *   };
 *   module.exports = { processData };
 * };
 */

export const types = () => {
  return \`${library.types || ""}\`;
};

export const content = () => {
${library.content.content || ""}
};
`;

  await fs.writeFile(filePath, fileContent, "utf8");
}

// Helper function to update library from file
async function updateLibraryFromFile(library, filePath) {
  try {
    const { types: newTypes, content: newContent } =
      await parseLibraryFile(filePath);

    // Update the library
    const updateData = await graphQuery(UPDATE_AUTOMATION_LIB_MUTATION, {
      id: library.id,
      name: library.name,
      namespace: library.namespace,
      content: newContent,
      types: newTypes,
      enabled: library.enabled,
      version: library.version,
      tags: library.tags || [],
    });

    if (!updateData.saveAutomationLib) {
      console.log(chalk.yellow(`Failed to update library: ${library.name}`));
    }
  } catch (error) {
    console.error(
      chalk.red(`Error updating library from file: ${error.message}`),
    );
    throw new Error(`Error updating library from file: ${error.message}`);
  }
}

// Helper function to parse library file and extract types and content
export async function parseLibraryFile(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, "utf8");
    const ast = parser.parse(fileContent, {
      sourceType: "module",
      plugins: [
        "jsx",
        "asyncGenerators",
        "classProperties",
        "dynamicImport",
        "objectRestSpread",
      ],
    });

    let typesStr = null;
    let contentStr = null;

    for (const node of ast.program.body) {
      // Extract export const types = ...
      if (
        node.type === "ExportNamedDeclaration" &&
        node.declaration &&
        node.declaration.type === "VariableDeclaration"
      ) {
        for (const decl of node.declaration.declarations) {
          if (decl.id.name === "types") {
            // Handle types as a function that returns a string
            if (
              decl.init.type === "ArrowFunctionExpression" ||
              decl.init.type === "FunctionExpression"
            ) {
              // Extract the return statement content
              const body = decl.init.body;
              if (body.type === "BlockStatement") {
                // Look for return statement
                for (const stmt of body.body) {
                  if (stmt.type === "ReturnStatement" && stmt.argument) {
                    typesStr = generate.default(stmt.argument).code;
                    // Remove quotes if it's a string literal, but preserve template literals
                    if (typesStr.startsWith('"') && typesStr.endsWith('"')) {
                      typesStr = typesStr.slice(1, -1);
                    } else if (
                      typesStr.startsWith("'") &&
                      typesStr.endsWith("'")
                    ) {
                      typesStr = typesStr.slice(1, -1);
                    } else if (
                      typesStr.startsWith("`") &&
                      typesStr.endsWith("`")
                    ) {
                      // Keep template literal as-is, just remove the backticks
                      typesStr = typesStr.slice(1, -1);
                    }
                    break;
                  }
                }
              } else if (body.type === "StringLiteral") {
                // Arrow function with implicit return
                typesStr = body.value;
              }
            } else if (decl.init.type === "StringLiteral") {
              // Fallback: direct string assignment
              typesStr = decl.init.value;
            }
          }
          if (decl.id.name === "content") {
            // Handle content as a function that contains the code
            if (
              decl.init.type === "ArrowFunctionExpression" ||
              decl.init.type === "FunctionExpression"
            ) {
              const body = decl.init.body;
              if (body.type === "BlockStatement") {
                // Extract all statements and convert them to code
                const statements = body.body.map(
                  (stmt) => generate.default(stmt).code,
                );
                contentStr = statements.join("\n");
              } else if (body.type === "StringLiteral") {
                // Arrow function with implicit return
                contentStr = body.value;
              }
            } else if (decl.init.type === "StringLiteral") {
              // Fallback: direct string assignment
              contentStr = decl.init.value;
            }
          }
        }
      }
    }

    if (!typesStr) throw new Error("Could not parse types from file");
    if (!contentStr) throw new Error("Could not parse content from file");

    return {
      types: typesStr,
      content: contentStr,
    };
  } catch (error) {
    throw new Error(`Error parsing library file. ${error.message}`);
  }
}
