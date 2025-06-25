import chalk from "chalk";
import { graphQuery } from "../../utils.js";
import {
  LIST_STEPS_QUERY,
  CREATE_STEP_MUTATION,
  GET_STEP_QUERY,
  DELETE_STEP_MUTATION,
  SAVE_STEP_MUTATION,
} from "./query.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import open from "open";
import { getSelectedWorkspace } from "../workspace/index.js";

export async function addStep(
  name,
  workspaceIdentifier,
  nocodeType = null,
  filePath = null,
) {
  let workspaceId = workspaceIdentifier;
  if (!workspaceIdentifier) {
    workspaceId = await getSelectedWorkspace();
    if (!workspaceId) {
      console.log(chalk.yellow("⚠ Workspace ID is required"));
      return;
    }
  }

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
        const fileContent = await fs.readFile(filePath, "utf8");

        // Extract condition and content using regex
        const conditionMatch = fileContent.match(
          /export const condition = ([\s\S]*?);/,
        );
        const contentMatch = fileContent.match(
          /export const content = \(\) => \{([\s\S]*?)\};/,
        );

        if (!conditionMatch || !contentMatch) {
          console.error(
            chalk.yellow(
              "⚠ Could not parse condition and content from file. Using empty defaults.",
            ),
          );
          return;
        }

        // Parse the condition as JavaScript object and convert to JSON string
        let newCondition;
        try {
          // First, try to evaluate the condition as a JavaScript object
          const conditionStr = conditionMatch[1].trim();
          // Use Function constructor to safely evaluate the object
          const conditionObj = new Function(`return ${conditionStr}`)();
          // Then convert to JSON string
          newCondition = JSON.stringify(conditionObj);
        } catch (error) {
          console.error(
            chalk.red(
              `Invalid condition format: ${error.message}\nPlease ensure it is a valid JavaScript object.`,
            ),
          );
          return;
        }
        const newContent = contentMatch[1].trim();

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

export async function listSteps(includeDisabled = false, workspaceIdentifier, name = null) {
  let workspaceId = workspaceIdentifier;
  if (!workspaceIdentifier) {
    workspaceId = await getSelectedWorkspace();
    if (!workspaceId) {
      console.log(chalk.yellow("⚠ Workspace ID is required"));
      return;
    }
  }

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
  let workspaceId = workspaceIdentifier;
  if (!workspaceIdentifier) {
    workspaceId = await getSelectedWorkspace();
    if (!workspaceId) {
      console.log(chalk.yellow("⚠ Workspace ID is required"));
      return;
    }
  }

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
  let workspaceId = workspaceIdentifier;
  if (!workspaceIdentifier) {
    workspaceId = await getSelectedWorkspace();
    if (!workspaceId) {
      console.log(chalk.yellow("⚠ Workspace ID is required"));
      return;
    }
  }

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
    console.log(tempFilePath);
    console.log(step);
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

export const condition = ${(() => {
  try {
    if (step.content?.if) {
      // Use Function constructor to safely evaluate the JavaScript object
      const conditionObj = new Function(`return ${step.content.if}`)();
      return JSON.stringify(conditionObj, null, 2);
    }
    return JSON.stringify({}, null, 2);
  } catch (error) {
    console.warn(chalk.yellow(`Warning: Could not parse condition: ${error.message}`));
    return JSON.stringify({}, null, 2);
  }
})()};

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
      // Extract condition and content using regex
      const conditionMatch = modifiedContent.match(
        /export const condition = ([\s\S]*?);/,
      );
      const contentMatch = modifiedContent.match(
        /export const content = async \(\) => \{([\s\S]*?)\};/,
      );

      if (!conditionMatch || !contentMatch) {
        console.error(chalk.red("Could not parse the modified file"));
        return;
      }

      // Parse the condition as JavaScript object and convert to JSON string
      let newCondition;
      try {
        // First, try to evaluate the condition as a JavaScript object
        const conditionStr = conditionMatch[1].trim();
        // Use Function constructor to safely evaluate the object
        const conditionObj = new Function(`return ${conditionStr}`)();
        // Then convert to JSON string
        newCondition = JSON.stringify(conditionObj);
      } catch (error) {
        console.error(
          chalk.red(
            `Invalid condition format: ${error.message}\nPlease ensure it is a valid JavaScript object.`,
          ),
        );
        return;
      }
      const newContent = contentMatch[1].trim();

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
  let workspaceId = workspaceIdentifier;
  if (!workspaceIdentifier) {
    workspaceId = await getSelectedWorkspace();
    if (!workspaceId) {
      console.log(chalk.yellow("⚠ Workspace ID is required"));
      return;
    }
  }

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
