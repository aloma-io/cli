import { headerText } from "../../pull-safety.js";
import chalk from "chalk";
import { graphQuery } from "../../utils.js";
import {
  LIST_STEPS_QUERY,
  CREATE_STEP_MUTATION,
  GET_STEP_QUERY,
  DELETE_STEP_MUTATION,
  SAVE_STEP_MUTATION,
  GENERATE_STEP_MUTATION,
} from "./query.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import open from "open";
import { resolveWorkspaceId } from "../../context.js";
import { CliError, UsageError, failure } from "../../runtime.js";
import { resolveByIdOrName, assertNameFree } from "../../names.js";
import readline from "readline";
import { stepResource, parseStepFile } from "../../resources/step.js";
import { pull, sync } from "../../resources/engine.js";

// Every step in the workspace, disabled ones too: what step names are resolved against (PLAT-115).
const listWorkspaceSteps = (workspaceId) => stepResource.list(workspaceId);

// A step id or a step name (unique in the workspace) to the step's id; anything else is refused.
async function resolveStepId(ref, workspaceId) {
  return resolveByIdOrName(await listWorkspaceSteps(workspaceId), ref, "step")
    .id;
}

export async function addStep(
  name,
  workspaceIdentifier,
  nocodeType = null,
  filePath = null,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  try {
    // Names are unique per workspace
    assertNameFree(await listWorkspaceSteps(workspaceId), name.trim(), "step");

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
        throw failure("Error reading or parsing file:", error);
      }
    }
  } catch (error) {
    throw failure("Error creating step:", error);
  }
}

export async function listSteps(
  includeDisabled = false,
  workspaceIdentifier,
  name = null,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

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
    throw failure("Error fetching steps:", error);
  }
}

export async function showStep(stepRef, workspaceIdentifier) {
  if (!stepRef) {
    throw new UsageError("⚠ Please provide a step ID.");
  }
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  try {
    const stepId = await resolveStepId(stepRef, workspaceId);
    const data = await graphQuery(GET_STEP_QUERY, {
      id: stepId,
    });
    const step = data.getAutomationStep;

    if (!step) {
      throw new CliError(`Step with ID ${stepId} not found.`);
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
    throw failure("Error fetching step details:", error);
  }
}

export async function deleteStep(stepRef, workspaceIdentifier) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  if (!stepRef) {
    throw new UsageError("⚠ Please provide a step ID.");
  }

  try {
    const stepId = await resolveStepId(stepRef, workspaceId);
    const data = await graphQuery(DELETE_STEP_MUTATION, {
      id: stepId,
      environment_id: workspaceId, // TODO: remove this
    });

    if (data.deleteAutomationStep) {
      console.log(chalk.green(`Successfully deleted step with ID: ${stepId}`));
    } else {
      throw new CliError(
        `Step with ID ${stepId} not found or could not be deleted.`,
      );
    }
  } catch (error) {
    throw failure("Error deleting step:", error);
  }
}

export async function editStep(stepRef, workspaceIdentifier) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  if (!stepRef) {
    throw new UsageError("⚠ Please provide a step ID.");
  }

  try {
    const stepId = await resolveStepId(stepRef, workspaceId);
    // Get step details
    const data = await graphQuery(GET_STEP_QUERY, {
      id: stepId,
    });
    const step = data.getAutomationStep;

    if (!step) {
      throw new CliError(`Step with ID ${stepId} not found.`);
    }

    // Create temporary file
    const tempDir = os.tmpdir();
    // If the step name contains slashes, use only the last segment for the temp file
    const stepSegments = step.name.split("/");
    const fileName = `${stepSegments[stepSegments.length - 1]}.js`;
    const tempFilePath = path.join(tempDir, fileName);

    // Prepare the file content
    const fileContent = `/**
 * Step: ${headerText(step.name)}
 * ID: ${headerText(step.id)}
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
    let editError = null;
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
        editError = new CliError(`Failed to update step: ${step.name}`);
      }
    } catch (error) {
      editError = failure("Error parsing or updating step:", error);
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
    if (editError) throw editError;
  } catch (error) {
    throw failure("Error editing step:", error);
  }
}

export async function cloneStep(stepRef, workspaceIdentifier) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  if (!stepRef) {
    throw new UsageError("Please provide a step ID to clone.");
  }

  try {
    // The source is resolved in the selected workspace; -w names the target
    const stepId = await resolveStepId(stepRef, await resolveWorkspaceId());
    // Get source step details
    const sourceData = await graphQuery(GET_STEP_QUERY, {
      id: stepId,
    });
    const sourceStep = sourceData.getAutomationStep;

    if (!sourceStep) {
      throw new CliError(`Step with ID ${stepId} not found.`);
    }

    // Names are unique per workspace
    assertNameFree(
      await listWorkspaceSteps(workspaceId),
      sourceStep.name,
      "step",
    );

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
    throw failure("Error cloning step:", error);
  }
}

export async function pullStep(workspaceIdentifier, stepRef, targetPath) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  await pull(stepResource, workspaceId, stepRef, targetPath);
}

export async function syncStep(
  workspaceIdentifier,
  stepRef,
  sourcePath,
  noPrompt,
) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
  await sync(stepResource, workspaceId, stepRef, sourcePath, noPrompt);
}

export async function generateStep(filePath, workspaceIdentifier) {
  const workspaceId = await resolveWorkspaceId(workspaceIdentifier);

  if (!filePath) {
    throw new UsageError("⚠ Please provide a file path with -f or --file");
  }

  try {
    // Ensure the directory exists
    const dir = path.dirname(filePath);
    if (dir !== "." && dir !== "") {
      await fs.mkdir(dir, { recursive: true });
    }

    // Initialize chat history
    const chatHistory = [];

    // Create or read existing file
    let existingContent = "";
    try {
      existingContent = await fs.readFile(filePath, "utf8");
      console.log(chalk.blue(`Reading existing file: ${filePath}`));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      console.log(chalk.blue(`Creating new file: ${filePath}`));
    }

    // Create readline interface for interactive input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.blue("\n🤖 Starting interactive step generation..."));
    console.log(
      chalk.gray(
        "Type your requirements, or 'exit'/'quit' to end the session\n",
      ),
    );

    // Helper function to write step to file
    const writeStepToFile = async (step) => {
      let conditionStr = "{}";

      if (step.condition) {
        if (typeof step.condition === "object") {
          conditionStr = JSON.stringify(step.condition, null, 2);
        } else {
          // If it's already a string, use it directly (might be JSON or JS object literal)
          conditionStr = step.condition;
        }
      }

      const descriptionLine = step.description
        ? ` * ${headerText(step.description)}\n`
        : "";
      const idLine = step.id ? ` * ID: ${headerText(step.id)}\n` : "";
      const hasMetaInfo = step.id || step.description;

      const fileContent = `/**
 * Step: ${headerText(step.name || "Generated Step")}
${idLine}${descriptionLine}${hasMetaInfo ? " *\n" : ""} * Edit the condition and content below.
 * The condition should be a valid JavaScript object (trailing commas are allowed).
 * The content should be JavaScript code that will be executed.
 */

export const condition = ${conditionStr};

export const content = async () => {
${step.content || ""}
};
`;

      await fs.writeFile(filePath, fileContent, "utf8");
      console.log(chalk.green(`\n✓ Code written to ${filePath}`));
    };

    // Main chat loop
    const askQuestion = () => {
      return new Promise((resolve) => {
        rl.question(chalk.cyan("You: "), async (userInput) => {
          const trimmedInput = userInput.trim();

          if (
            !trimmedInput ||
            trimmedInput.toLowerCase() === "exit" ||
            trimmedInput.toLowerCase() === "quit"
          ) {
            rl.close();
            console.log(chalk.yellow("\n👋 Ending session. Goodbye!"));
            resolve(null);
            return;
          }

          // Add user message to chat history
          const userMessage = {
            role: "user",
            content: trimmedInput,
          };
          chatHistory.push(userMessage);

          console.log(chalk.gray("\n🤔 Generating step..."));

          try {
            // Call the mutation
            const data = await graphQuery(GENERATE_STEP_MUTATION, {
              userInput: trimmedInput,
              environmentId: workspaceId,
              chatHistory: chatHistory.slice(0, -1), // Send history without current message
            });

            const result = data.generateAutomationStep;

            if (!result || !result.success || !result.step) {
              console.log(
                chalk.red(
                  `\n❌ Error: ${result?.explanation || "Failed to generate step"}`,
                ),
              );
              // Still add assistant message to history
              chatHistory.push({
                role: "assistant",
                content:
                  result?.chatMessage ||
                  "I encountered an error generating the step.",
              });
              resolve(true);
              return;
            }

            const step = result.step;

            // Display AI response
            if (result.chatMessage) {
              console.log(chalk.blue(`\n🤖 Assistant: ${result.chatMessage}`));
            }

            // Write step to file
            await writeStepToFile(step);

            // Add assistant message to chat history
            chatHistory.push({
              role: "assistant",
              content:
                result.chatMessage ||
                "I've generated a step based on your request.",
            });

            resolve(true);
          } catch (error) {
            console.error(chalk.red(`\n❌ Error: ${error.message}`));
            chatHistory.push({
              role: "assistant",
              content: `Sorry, I encountered an error: ${error.message}`,
            });
            resolve(true);
          }
        });
      });
    };

    // Start the chat loop
    let shouldContinue = true;
    while (shouldContinue) {
      const result = await askQuestion();
      if (result === null) {
        shouldContinue = false;
      }
    }
  } catch (error) {
    throw failure("Error in step generation:", error);
  }
}
