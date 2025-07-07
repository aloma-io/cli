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
import { getWorkspace, resolveWorkspaceId } from "../workspace/index.js";

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
    const fileName = `${step.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.js`;
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
 * content = () => {
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

  // Get workspace details to create folder with workspace name
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    console.log(chalk.red("Workspace not found"));
    return;
  }

  // Use current directory if no path specified
  const basePath = targetPath || process.cwd();
  const workspaceFolder = path.join(
    basePath,
    workspace.name.replace(/[^a-z0-9]/gi, "_").toLowerCase(),
  );

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

export async function syncStep(workspaceIdentifier, stepId, sourcePath) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  if (!workspaceId) return;

  // Get workspace details to find folder
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    console.log(chalk.red("Workspace not found"));
    return;
  }

  // Use current directory if no path specified
  const basePath = sourcePath || process.cwd();
  const workspaceFolder = path.join(
    basePath,
    workspace.name.replace(/[^a-z0-9]/gi, "_").toLowerCase(),
  );

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

      const stepFilePath = path.join(
        workspaceFolder,
        `${step.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.js`,
      );

      try {
        await fs.access(stepFilePath);
        await updateStepFromFile(step, stepFilePath);
        console.log(chalk.green(`Successfully synced step: ${step.name}`));
      } catch (error) {
        console.log(chalk.yellow(`Step file not found: ${stepFilePath}`));
      }
    } else {
      // Sync all steps
      const data = await graphQuery(LIST_STEPS_QUERY, {
        id: workspaceId,
        includeDisabled: true,
      });
      const steps = data.listAutomationSteps;

      if (!steps || steps.length === 0) {
        console.log(chalk.yellow("No steps found in workspace."));
        return;
      }

      let syncedCount = 0;
      for (const stepSummary of steps) {
        const stepData = await graphQuery(GET_STEP_QUERY, {
          id: stepSummary.id,
        });
        const step = stepData.getAutomationStep;
        if (step) {
          const stepFilePath = path.join(
            workspaceFolder,
            `${step.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.js`,
          );

          try {
            await fs.access(stepFilePath);
            await updateStepFromFile(step, stepFilePath);
            syncedCount++;
          } catch (error) {
            console.log(chalk.yellow(`Step file not found: ${stepFilePath}`));
          }
        }
      }

      console.log(
        chalk.green(
          `Successfully synced ${syncedCount} steps from: ${workspaceFolder}`,
        ),
      );
    }
  } catch (error) {
    console.error(chalk.red("Error syncing steps:"), error.message);
  }
}

// Helper function to create step file
async function createStepFile(step, workspaceFolder) {
  const fileName = `${step.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.js`;
  const filePath = path.join(workspaceFolder, fileName);

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
 * content = () => {
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
  }
}

// Helper function to parse step file and extract condition and content
async function parseStepFile(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, "utf8");

    // Extract condition and content using regex
    const conditionMatch = fileContent.match(
      /export const condition = ([\s\S]*?);/,
    );
    
    // More robust content extraction that handles nested braces
    const contentStart = fileContent.indexOf('export const content = async () => {');
    if (contentStart === -1) {
      throw new Error("Could not find content export");
    }
    
    const contentAfterStart = fileContent.substring(contentStart);
    const openBraceIndex = contentAfterStart.indexOf('{');
    if (openBraceIndex === -1) {
      throw new Error("Could not find opening brace in content");
    }
    
    // Find the matching closing brace by counting braces
    let braceCount = 0;
    let contentEndIndex = -1;
    
    for (let i = openBraceIndex; i < contentAfterStart.length; i++) {
      if (contentAfterStart[i] === '{') {
        braceCount++;
      } else if (contentAfterStart[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          contentEndIndex = i;
          break;
        }
      }
    }
    
    if (contentEndIndex === -1) {
      throw new Error("Could not find matching closing brace in content");
    }
    
    const content = contentAfterStart.substring(openBraceIndex + 1, contentEndIndex).trim();

    if (!conditionMatch) {
      throw new Error("Could not parse condition from file");
    }

    // Get the condition string directly without trying to parse it as JavaScript
    const conditionStr = conditionMatch[1].trim();

    // Validate the condition using the backend
    const validateRes = await graphQuery(VALIDATE_IF_QUERY, {
      content: conditionStr,
    });
    if (!validateRes.validateAutomationIf) {
      throw new Error("Condition is invalid, not a valid JSON object");
    }

    return {
      condition: conditionStr,
      content: content,
    };
  } catch (error) {
    throw new Error(`Error parsing step file: ${error.message}`);
  }
}
