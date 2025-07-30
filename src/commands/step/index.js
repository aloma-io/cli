import chalk from "chalk";
import { graphQuery } from "../../utils.js";
import {
  LIST_STEPS_QUERY,
  CREATE_STEP_MUTATION,
  GET_STEP_QUERY,
  DELETE_STEP_MUTATION,
  SAVE_STEP_MUTATION,
  VALIDATE_IF_QUERY,
} from "./query.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import open from "open";
import { resolveWorkspaceId } from "../workspace/index.js";
import readline from "readline";
import parser from "@babel/parser";
import generate from "@babel/generator";

export async function addStep(
  name,
  workspaceIdentifier,
  nocodeType = null,
  filePath = null,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  try {
    // Create the step first
    const data = await graphQuery(CREATE_STEP_MUTATION, {
      name: name.trim(),
      environment_id: workspaceId,
      nocode_type: nocodeType,
    });

    const stepId = data.createAutomationStep;
    console.log(
      chalk.green(`Created step [${name.trim()}] with ID: ${stepId}`),
    );

    // If a file path is provided, read and parse it
    if (filePath) {
      try {
        const { condition: newCondition, content: newContent } =
          await parseStepFile(filePath);

        // Update the step with the parsed content
        const updateData = await graphQuery(SAVE_STEP_MUTATION, {
          id: stepId,
          name: name.trim(),
          if: newCondition,
          do: newContent,
          enabled: true,
          version: 0,
          nocode_content: null,
          config_content: null,
        });

        if (updateData.saveAutomationStep) {
          console.log(
            chalk.green(
              `Successfully added step content from file: ${filePath}`,
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
    console.error(chalk.red("Error creating step:"), error.message);
  }
}

export async function listSteps(
  includeDisabled = false,
  workspaceIdentifier,
  name = null,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  try {
    const data = await graphQuery(LIST_STEPS_QUERY, {
      id: workspaceId,
      includeDisabled,
      name,
    });
    const steps = data.listAutomationSteps;

    if (!steps || steps.length === 0) {
      console.log(chalk.yellow("No steps found in current workspace."));
      return;
    }

    console.log(chalk.blue("\n📊 Steps in Current Workspace\n"));
    steps.forEach((step) => {
      const status = step.enabled
        ? chalk.green("● Enabled")
        : chalk.red("● Disabled");
      const valid = step.valid
        ? chalk.green("✓ Valid")
        : chalk.red("✗ Invalid");
      console.log(`${chalk.bold(step.name)}`);
      console.log(`   ID: ${step.id}`);
      console.log(`   Status: ${status} | ${valid}`);
      console.log(`   Last Used: ${step.last_used_at || "Never"}\n`);
    });
  } catch (error) {
    console.error(chalk.red("Error fetching steps:"), error.message);
  }
}

export async function showStep(stepId) {
  if (!stepId) {
    console.log(chalk.yellow("⚠ Please provide a step ID."));
    return;
  }

  try {
    const data = await graphQuery(GET_STEP_QUERY, {
      id: stepId,
    });
    const step = data.getAutomationStep;

    if (!step) {
      console.log(chalk.yellow(`Step with ID ${stepId} not found.`));
      return;
    }

    console.log(chalk.blue("\n📊 Step Details\n"));
    console.log(`${chalk.bold("Name:")} ${step.name}`);
    console.log(`${chalk.bold("ID:")} ${step.id}`);
    console.log(
      `${chalk.bold("Status:")} ${step.enabled ? chalk.green("Enabled") : chalk.red("Disabled")}`,
    );
    console.log(
      `${chalk.bold("Valid:")} ${step.valid ? chalk.green("Yes") : chalk.red("No")}`,
    );
    console.log(`${chalk.bold("Version:")} ${step.version}`);
    console.log(`${chalk.bold("Type:")} ${step.nocode_type || "Standard"}`);

    if (step.content) {
      console.log(
        `\n${chalk.bold("Content:")}\n${JSON.stringify(step.content, null, 2)}`,
      );
    }

    if (step.nocode_content) {
      console.log(
        `\n${chalk.bold("NoCode Content:")}\n${JSON.stringify(step.nocode_content, null, 2)}`,
      );
    }
  } catch (error) {
    console.error(chalk.red("Error fetching step details:"), error.message);
  }
}

export async function deleteStep(stepId, workspaceIdentifier) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  if (!stepId) {
    console.log(chalk.yellow("⚠ Please provide a step ID."));
    return;
  }

  try {
    const data = await graphQuery(DELETE_STEP_MUTATION, {
      id: stepId,
      environment_id: workspaceId, // TODO: remove this
    });

    if (data.deleteAutomationStep) {
      console.log(chalk.green(`Successfully deleted step with ID: ${stepId}`));
    } else {
      console.log(
        chalk.yellow(
          `Step with ID ${stepId} not found or could not be deleted.`,
        ),
      );
    }
  } catch (error) {
    console.error(chalk.red("Error deleting step:"), error.message);
  }
}

export async function editStep(stepId, workspaceIdentifier) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  if (!stepId) {
    console.log(chalk.yellow("⚠ Please provide a step ID."));
    return;
  }

  try {
    // Get step details
    const data = await graphQuery(GET_STEP_QUERY, {
      id: stepId,
    });
    const step = data.getAutomationStep;

    if (!step) {
      console.log(chalk.yellow(`Step with ID ${stepId} not found.`));
      return;
    }

    // Create temporary file
    const tempDir = os.tmpdir();
    // If the step name contains slashes, use only the last segment for the temp file
    const stepSegments = step.name.split("/");
    const fileName = `${stepSegments[stepSegments.length - 1]}.js`;
    const tempFilePath = path.join(tempDir, fileName);

    // Prepare the file content
    const fileContent = `/**
 * Step: ${step.name}
 * ID: ${step.id}
 * 
 * Edit the condition and content below.
 * The condition should be a valid JavaScript object (trailing commas are allowed).
 * The content should be JavaScript code that will be executed.
 * 
 * Example:
 * condition = {
 *   newStep: true,  // trailing commas are fine
 *   status: "active"
 * };
 * 
 * content = async () => {
 *   console.log('running step');
 *   data.newStep = true;
 * };
 */

export const condition = ${step.content?.if || "{}"};


export const content = async () => {
${step.content?.do || ""}
};
`;

    // Write the temporary file
    await fs.writeFile(tempFilePath, fileContent, "utf8");
    console.log(chalk.blue(`Opening editor for step: ${step.name}`));

    // Open the file in the default editor in a new window
    const editor = await open(tempFilePath, { wait: true, newInstance: true });

    // Read the modified file
    const modifiedContent = await fs.readFile(tempFilePath, "utf8");

    // Parse the modified content
    try {
      const { condition: newCondition, content: newContent } =
        await parseStepFile(tempFilePath);

      // Update the step
      const updateData = await graphQuery(SAVE_STEP_MUTATION, {
        id: stepId,
        name: step.name,
        if: newCondition,
        do: newContent,
        enabled: step.enabled,
        version: step.version,
        nocode_content: step.nocode_content,
        config_content: step.config_content,
      });

      if (updateData.saveAutomationStep) {
        console.log(chalk.green(`Successfully updated step: ${step.name}`));
      } else {
        console.log(chalk.yellow(`Failed to update step: ${step.name}`));
      }
    } catch (error) {
      console.error(
        chalk.red("Error parsing or updating step:"),
        error.message,
      );
    }

    // Clean up the temporary file
    try {
      await fs.unlink(tempFilePath);
    } catch (error) {
      console.warn(
        chalk.yellow(
          "Warning: Could not delete temporary file:",
          error.message,
        ),
      );
    }
  } catch (error) {
    console.error(chalk.red("Error editing step:"), error.message);
  }
}

export async function cloneStep(stepId, workspaceIdentifier) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  if (!stepId) {
    console.log(chalk.yellow("Please provide a step ID to clone."));
    return;
  }

  try {
    // Get source step details
    const sourceData = await graphQuery(GET_STEP_QUERY, {
      id: stepId,
    });
    const sourceStep = sourceData.getAutomationStep;

    if (!sourceStep) {
      console.log(chalk.yellow(`Step with ID ${stepId} not found.`));
      return;
    }

    // Create the step in the target workspace
    const data = await graphQuery(CREATE_STEP_MUTATION, {
      name: sourceStep.name,
      environment_id: workspaceId,
      nocode_type: sourceStep.nocode_type,
    });

    const newStepId = data.createAutomationStep;

    // If the source step has content, copy it to the new step
    if (sourceStep.content) {
      await graphQuery(SAVE_STEP_MUTATION, {
        id: newStepId,
        name: sourceStep.name,
        if: sourceStep.content.if,
        do: sourceStep.content.do,
        enabled: sourceStep.enabled,
        version: 0,
        nocode_content: sourceStep.nocode_content,
        config_content: sourceStep.config_content,
      });
    }

    console.log(
      chalk.green(`Successfully cloned step to workspace: ${workspaceId}`),
    );
    return newStepId;
  } catch (error) {
    console.error(chalk.red(`Error cloning step: ${error.message}`));
  }
}

export async function pullStep(workspaceIdentifier, stepId, targetPath) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  // Use current directory if no path specified
  const workspaceFolder = targetPath || process.cwd();

  try {
    // Create workspace folder if it doesn't exist
    await fs.mkdir(workspaceFolder, { recursive: true });

    if (stepId) {
      // Pull specific step
      const data = await graphQuery(GET_STEP_QUERY, { id: stepId });
      const step = data.getAutomationStep;

      if (!step) {
        console.log(chalk.yellow(`Step with ID ${stepId} not found.`));
        return;
      }

      await createStepFile(step, workspaceFolder);
      console.log(chalk.green(`Successfully pulled step: ${step.name}`));
    } else {
      // Pull all steps
      const data = await graphQuery(LIST_STEPS_QUERY, {
        id: workspaceId,
        includeDisabled: true,
      });
      const steps = data.listAutomationSteps;

      if (!steps || steps.length === 0) {
        console.log(chalk.yellow("No steps found in workspace."));
        return;
      }

      // Get full details for each step
      for (const stepSummary of steps) {
        const stepData = await graphQuery(GET_STEP_QUERY, {
          id: stepSummary.id,
        });
        const step = stepData.getAutomationStep;
        if (step) {
          await createStepFile(step, workspaceFolder);
        }
      }

      console.log(
        chalk.green(
          `Successfully pulled ${steps.length} steps to: ${workspaceFolder}`,
        ),
      );
    }
  } catch (error) {
    console.error(chalk.red("Error pulling steps:"), error.message);
  }
}

export async function syncStep(
  workspaceIdentifier,
  stepId,
  sourcePath,
  noPrompt,
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

    if (stepId) {
      // Sync specific step
      const data = await graphQuery(GET_STEP_QUERY, { id: stepId });
      const step = data.getAutomationStep;

      if (!step) {
        console.log(chalk.yellow(`Step with ID ${stepId} not found.`));
        return;
      }

      // If the step name contains slashes, create subfolders accordingly
      const stepSegments = step.name.split("/");
      const fileName = `${stepSegments[stepSegments.length - 1]}.js`;
      const subfolders = stepSegments.slice(0, -1);
      const targetFolder = path.join(workspaceFolder, ...subfolders);
      const stepFilePath = path.join(targetFolder, fileName);

      try {
        await fs.access(stepFilePath);
        // Prompt for confirmation
        let confirmed = true;
        if (!noPrompt) {
          confirmed = await promptConfirmation(
            `Are you sure you want to overwrite the step '${step.name}' with the contents of '${stepFilePath}'? (y/N): `,
          );
        }
        if (!confirmed) {
          console.log(chalk.yellow("Sync cancelled by user."));
          return;
        }
        try {
          await updateStepFromFile(step, stepFilePath);
          console.log(chalk.green(`Successfully synced step: ${step.name}`));
        } catch (error) {
          console.log(chalk.red(`Error updating step: ${step.name}`));
        }
      } catch (error) {
        console.log(chalk.yellow(`Step file not found: ${stepFilePath}`));
      }
    } else {
      // Sync all steps
      const data = await graphQuery(LIST_STEPS_QUERY, {
        id: workspaceId,
        includeDisabled: true,
      });
      const steps = data.listAutomationSteps || [];
      // Map step name to step object for quick lookup
      const stepMap = new Map();
      for (const stepSummary of steps) {
        stepMap.set(stepSummary.name, stepSummary);
      }

      // Get all .js files in workspaceFolder recursively
      const jsFiles = await getAllJsFiles(workspaceFolder);
      if (jsFiles.length === 0) {
        console.log(
          chalk.yellow("No .js step files found in workspace folder."),
        );
        return;
      }

      // Prompt for confirmation ONCE
      let confirmed = true;
      if (!noPrompt) {
        confirmed = await promptConfirmation(
          `Are you sure you want to overwrite steps in the workspace with the contents of ${jsFiles.length} file(s) from '${workspaceFolder}'? (y/N): `,
        );
      }
      if (!confirmed) {
        console.log(chalk.yellow("Sync cancelled by user."));
        return;
      }

      let updatedCount = 0;
      let createdCount = 0;
      for (const { absPath, relPath } of jsFiles) {
        // Derive step name from relPath (remove .js extension, convert path separators to /)
        const stepName = relPath.replace(/\\/g, "/").replace(/\.js$/, "");
        const step = stepMap.get(stepName);
        if (step) {
          // Update existing step
          try {
            // Get full step details for update
            const stepData = await graphQuery(GET_STEP_QUERY, { id: step.id });
            const fullStep = stepData.getAutomationStep;
            await updateStepFromFile(fullStep, absPath);
            updatedCount++;
          } catch (error) {
            console.log(chalk.red(`Error updating step: ${stepName}`));
          }
        } else {
          // Create new step
          try {
            const { condition: newCondition, content: newContent } =
              await parseStepFile(absPath);
            // Create the step first
            const createData = await graphQuery(CREATE_STEP_MUTATION, {
              name: stepName,
              environment_id: workspaceId,
              nocode_type: null,
            });
            const newStepId = createData.createAutomationStep;
            // Update the step with the parsed content
            await graphQuery(SAVE_STEP_MUTATION, {
              id: newStepId,
              name: stepName,
              if: newCondition,
              do: newContent,
              enabled: true,
              version: 0,
              nocode_content: null,
              config_content: null,
            });
            createdCount++;
          } catch (error) {
            console.log(chalk.red(`Error creating step: ${stepName}`));
          }
        }
      }
      console.log(
        chalk.green(
          `Successfully synced steps from: ${workspaceFolder}\nUpdated: ${updatedCount}, Created: ${createdCount}`,
        ),
      );
    }
  } catch (error) {
    console.error(chalk.red("Error syncing steps:"), error.message);
  }
}

// Helper function to create step file
async function createStepFile(step, workspaceFolder) {
  // If the step name contains slashes, create subfolders accordingly
  const stepSegments = step.name.split("/");
  const fileName = `${stepSegments[stepSegments.length - 1]}.js`;
  const subfolders = stepSegments.slice(0, -1);
  const targetFolder = path.join(workspaceFolder, ...subfolders);
  await fs.mkdir(targetFolder, { recursive: true });
  const filePath = path.join(targetFolder, fileName);

  const fileContent = `/**
 * Step: ${step.name}
 * ID: ${step.id}
 * 
 * Edit the condition and content below.
 * The condition should be a valid JavaScript object (trailing commas are allowed).
 * The content should be JavaScript code that will be executed.
 * 
 * Example:
 * condition = {
 *   newStep: true,  // trailing commas are fine
 *   status: "active"
 * };
 * 
 * content = async () => {
 *   console.log('running step');
 *   data.newStep = true;
 * };
 */

export const condition = ${step.content?.if || "{}"};

export const content = async () => {
${step.content?.do || ""}
};
`;

  await fs.writeFile(filePath, fileContent, "utf8");
}

// Helper function to update step from file
async function updateStepFromFile(step, filePath) {
  try {
    const { condition: newCondition, content: newContent } =
      await parseStepFile(filePath);

    // Update the step
    const updateData = await graphQuery(SAVE_STEP_MUTATION, {
      id: step.id,
      name: step.name,
      if: newCondition,
      do: newContent,
      enabled: step.enabled,
      version: step.version,
      nocode_content: step.nocode_content,
      config_content: step.config_content,
    });

    if (!updateData.saveAutomationStep) {
      console.log(chalk.yellow(`Failed to update step: ${step.name}`));
    }
  } catch (error) {
    console.error(chalk.red(`Error updating step from file: ${error.message}`));
    throw new Error(`Error updating step from file: ${error.message}`);
  }
}

// Helper function to parse step file and extract condition and content
async function parseStepFile(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, "utf8");
    const ast = parser.parse(fileContent, {
      sourceType: "module",
      plugins: ["jsx", "asyncGenerators", "classProperties", "dynamicImport", "objectRestSpread"],
    });

    let conditionStr = null;
    let contentStr = null;

    for (const node of ast.program.body) {
      // Extract export const condition = ...
      if (
        node.type === "ExportNamedDeclaration" &&
        node.declaration &&
        node.declaration.type === "VariableDeclaration"
      ) {
        for (const decl of node.declaration.declarations) {
          if (decl.id.name === "condition") {
              conditionStr = generate.default(decl.init).code;
            }
          if (
            decl.id.name === "content" &&
            decl.init.type === "ArrowFunctionExpression"
          ) {
            contentStr = generate.default(decl.init.body).code;
            // Remove wrapping braces if present
            if (contentStr.startsWith("{") && contentStr.endsWith("}")) {
              contentStr = contentStr.slice(1, -1).trim();
            }
          }
        }
      }
    }

    if (!conditionStr) throw new Error("Could not parse condition from file");
    if (!contentStr) throw new Error("Could not parse content from file");

    // Validate the condition using the backend
    const validateRes = await graphQuery(VALIDATE_IF_QUERY, {
      content: conditionStr,
    });
    if (!validateRes.validateAutomationIf) {
      throw new Error("Condition is invalid, not a valid JSON object");
    }
    return {
      condition: conditionStr,
      content: contentStr,
    };
  } catch (error) {
    throw new Error(`Error parsing step file. ${error.message}`);
  }
}
