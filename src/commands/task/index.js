import chalk from "chalk";
import { graphQuery } from "../../utils.js";
import {
  CREATE_TASK_MUTATION,
  LIST_TASKS_QUERY,
  GET_TASK_QUERY,
  CLONE_TASK_MUTATION,
  STOP_TASK_MUTATION,
  RESUME_TASK_MUTATION,
  NEW_TASK_FROM_HISTORY_MUTATION,
} from "./query.js";
import { color } from "./utils.js";
import { getSelectedWorkspace } from "../workspace/index.js";
import fs from "fs/promises";
import { diffJson } from "diff";

export async function listTasks(
  page = 1,
  workspaceIdentifier,
  state = null,
  name = null,
) {
  try {
    let workspaceId = workspaceIdentifier;
    if (!workspaceIdentifier) {
      workspaceId = await getSelectedWorkspace();
      if (!workspaceId) {
        console.log(chalk.yellow("⚠ Workspace ID is required"));
        return;
      }
    }

    const limit = 10;
    const offset = (page - 1) * limit;

    const response = await graphQuery(LIST_TASKS_QUERY, {
      id: workspaceId,
      state,
      name,
      offset,
      limit,
    });

    const tasks = response.listAutomationEnvironmentTasks;

    if (!tasks || tasks.length === 0) {
      console.log(chalk.yellow("No tasks found in current workspace."));
      return;
    }

    console.log(chalk.blue("\n📊 Tasks in Current Workspace\n"));
    tasks.forEach((task) => {
      // Map task state to status
      let taskStatus = task.state.toLowerCase();
      if (taskStatus === "completed") taskStatus = "done";
      if (taskStatus === "running") taskStatus = "processing";

      // Get status color
      const statusColor = color[taskStatus] || "#ccc";
      const statusText =
        taskStatus.charAt(0).toUpperCase() + taskStatus.slice(1);

      console.log(`${chalk.bold(task.name)}`);
      console.log(`   ID: ${task.id}`);
      console.log(`   Status: ${chalk.hex(statusColor)(`● ${statusText}`)}`);
      console.log(
        `   Duration: ${task.duration ? `${task.duration}ms` : "N/A"}`,
      );
      console.log(`   Steps: ${task.steps}`);
      if (task.tags && task.tags.length > 0) {
        console.log(`   Tags: ${task.tags.join(", ")}`);
      }
      console.log(`   Created: ${new Date(task.createdAt).toLocaleString()}\n`);
    });
  } catch (error) {
    console.error(chalk.red("Error listing tasks:"), error.message);
  }
}

// Helper to print JSON with diff highlights
function printJsonDiff(prev, curr) {
  const diff = diffJson(prev, curr);
  diff.forEach((part) => {
    if (part.value !== "{}") {
      let color = chalk.gray;
      if (part.added) color = chalk.green;
      if (part.removed) color = chalk.red;
      process.stdout.write(color(part.value));
    }
  });
  process.stdout.write("\n");
}

function getNormalizedHistory(task, history) {
  if (history && history.length > 0) {
    // Add created event if not present
    if (!history.find((item) => item.state === "created")) {
      history.unshift({
        context: { timestamp: new Date(task.createdAt).getTime() },
        updatedAt: task.createdAt,
        error: task.error,
        task_id: task.id,
        id: "created",
        title: "created",
        state: "created",
        data: task.content?.data || {},
      });
    }

    // Normalize and filter history items
    const normalized = history
      .filter((item) => item && item.context)
      .map((item, idx) => {
        const isV3 = item.v === 3;
        const context = item.context;
        const content = context?.content || {};
        const date = new Date(
          context?.snapshot?.timestamp || context?.timestamp || item.updatedAt,
        ).getTime();

        let executionTime;
        if (item.rule && context?.content?.context?.appliedRules) {
          const ruleId = item.rule.id;
          const found = context.content.context.appliedRules.find(
            (r) => r.id === ruleId,
          );
          if (found && found.executionDuration !== undefined) {
            executionTime = found.executionDuration;
          }
        }

        return {
          id: item.id,
          taskId: item.task_id,
          title: item.event,
          state: item.state,
          cardTitle: item.rule?.name
            ? item.rule.name
            : item.event || item.state,
          error: item.error || context?.error,
          date: new Date(date).toLocaleTimeString(),
          rule: item.rule,
          console:
            context?.content?._currentConsoleLog ||
            item.context?.consoleLog ||
            [],
          audit:
            context?.content?._currentAuditLog || item.context?.auditLog || [],
          visualize: content?._currentVisualize || context?.visualization || [],
          executionTime,
          integrations: (
            (isV3
              ? Object.values(content?._currentIntegration || {})
              : context?.integrations) || []
          ).sort((a, b) => (a.alias > b.alias ? 1 : -1)),
          startedSubtasks:
            content?._startedSubtasks || context?.startedSubtasks || [],
          finishedSubtasks:
            context?._finishedSubtasks || context?.finishedSubtasks || [],
          isApplying: item.event === "applying",
          isCurrentlyRunning:
            idx === history.length - 1 && item.event === "applying",
          changes: content.changes || [],
          data: content.data || item.data || {},
        };
      })
      .filter((item, idx) => {
        if (item.isApplying && !item.isCurrentlyRunning) return false;
        if (item.audit.length) return true;
        return (
          item.rule != null ||
          item.state === "created" ||
          idx === history.length - 1
        );
      });
    return normalized;
  }
  return [];
}

export async function showTask(taskId, options = {}) {
  try {
    if (!taskId) {
      console.log(chalk.yellow("⚠ Please provide a task ID"));
      return;
    }

    const response = await graphQuery(GET_TASK_QUERY, {
      id: taskId,
    });

    const task = response.getAutomationEnvironmentTask;
    const history = response.getAutomationEnvironmentTaskHistory;

    if (!task) {
      console.log(chalk.yellow(`⚠ Task with ID ${taskId} not found`));
      return;
    }

    // Map task state to status
    let taskStatus = task.state.toLowerCase();
    if (taskStatus === "completed") taskStatus = "done";
    if (taskStatus === "running") taskStatus = "processing";

    // Get status color
    const statusColor = color[taskStatus] || "#ccc";
    const statusText = taskStatus.charAt(0).toUpperCase() + taskStatus.slice(1);

    console.log(chalk.blue("\n📊 Task Details\n"));
    console.log(`${chalk.bold("Name:")} ${task.name}`);
    console.log(`${chalk.bold("ID:")} ${task.id}`);
    console.log(
      `${chalk.bold("Status:")} ${chalk.hex(statusColor)(`● ${statusText}`)}`,
    );
    console.log(
      `${chalk.bold("Created:")} ${new Date(task.createdAt).toLocaleString()}`,
    );
    console.log(
      `${chalk.bold("Updated:")} ${new Date(task.updatedAt).toLocaleString()}`,
    );
    console.log(
      `${chalk.bold("Duration:")} ${task.duration ? `${task.duration}ms` : "N/A"}`,
    );
    if (task.tags && task.tags.length > 0) {
      console.log(`${chalk.bold("Tags:")} ${task.tags.join(", ")}`);
    }

    if (task.content) {
      console.log(`\n${chalk.bold("Content:")}`);
      console.log(JSON.stringify(task.content, null, 2));
    }

    if (history && history.length > 0) {
      // Get normalized history
      const normalized = getNormalizedHistory(task, history);

      // If --step is specified, filter to that step
      let entriesToShow = normalized.map((item) => item.id);
      if (options.step) {
        const stepIdx = parseInt(options.step, 10);
        if (!isNaN(stepIdx) && stepIdx >= 0 && stepIdx < normalized.length) {
          entriesToShow = [normalized[stepIdx].id];
        } else {
          console.log(chalk.red("Invalid step number specified."));
          return;
        }
      }

      console.log(`\n${chalk.bold("Execution History")}`);
      console.log(
        chalk.gray(
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        ),
      );
      normalized.forEach((entry, idx) => {
        // Get status color for each event
        let eventStatus = entry.state?.toLowerCase() || entry.event;
        if (eventStatus === "completed") eventStatus = "done";
        if (eventStatus === "running") eventStatus = "processing";
        const eventColor = color[eventStatus] || "#ccc";

        console.log(`\n${chalk.bold(entry.cardTitle)}`);
        console.log(`${chalk.gray("Time:")} ${entry.date}`);
        console.log(
          `${chalk.gray("State:")} ${chalk.hex(eventColor)(`● ${entry.state || entry.event}`)}`,
        );

        // Add execution time if available
        if (entry.executionTime) {
          console.log(`${chalk.gray("Duration:")} ${entry.executionTime}ms`);
        }

        // Show logs if requested
        if (
          options.logs &&
          entriesToShow.includes(entry.id) &&
          entry.state !== "incomplete"
        ) {
          // Show console logs if available
          if (entry.console.length > 0) {
            console.log(`\n${chalk.gray("Console Log:")}`);
            entry.console.forEach((log) => {
              const timestamp = new Date(log.ts).toLocaleTimeString();
              console.log(`${chalk.gray(`[${timestamp}]`)} ${log.msg}`);
            });
          }
          // Show audit logs if available
          if (entry.audit.length > 0) {
            console.log(`\n${chalk.gray("Audit Log:")}`);
            entry.audit.forEach((audit) => {
              if (audit.type === "message") {
                console.log(audit.msg);
              } else if (audit.type === "subtask") {
                if (audit.action === "add") {
                  console.log(
                    `${audit.name} ${chalk.hex(color.created)(`● created`)}`,
                  );
                  console.log(`    ${chalk.gray("ID:")} ${audit.id}`);
                } else if (audit.action === "resolve") {
                  console.log(
                    `${audit.name} ${chalk.hex(color.done)(`● completed`)}`,
                  );
                  console.log(`    ${chalk.gray("ID:")} ${audit.id}`);
                }
              } else if (audit.type === "reference") {
                if (audit.url) {
                  console.log(
                    `Reference: ${audit.name || audit.role} - ${audit.url}`,
                  );
                } else if (audit.id) {
                  console.log(
                    `Reference: ${audit.name || audit.role} - ${audit.id}`,
                  );
                }
              }
            });
          }
        }

        // Show changes (diff) if requested and not for the last step
        if (
          options.changes &&
          entriesToShow.includes(entry.id) &&
          entry.state !== "incomplete" &&
          idx !== normalized.length - 1
        ) {
          // Get current and previous data for this step
          const prevData = idx > 0 ? normalized[idx - 1].data : {};
          const currData = entry.data;
          console.log(`\n${chalk.gray("Step Data Diff:")}`);
          printJsonDiff(prevData, currData);
        }

        // Show task data after each step if requested and not for the last step
        if (
          options.inspect &&
          entriesToShow.includes(entry.id) &&
          entry.state !== "incomplete" &&
          idx !== normalized.length - 1
        ) {
          console.log(`\n${chalk.gray("Step Data:")}`);
          console.log(JSON.stringify(entry.data, null, 2));
        }

        if (entry.error) {
          console.log(`\n${chalk.red("Error:")} ${entry.error}`);
        }

        console.log(
          chalk.gray(
            "──────────────────────────────────────────────────────────────────────────",
          ),
        );
      });
    }
  } catch (error) {
    console.error(chalk.red("Error showing task:"), error.message);
  }
}

export async function createTask(
  name,
  taskData,
  taskFile,
  workspaceIdentifier,
) {
  try {
    let workspaceId = workspaceIdentifier;
    if (!workspaceIdentifier) {
      workspaceId = await getSelectedWorkspace();
      if (!workspaceId) {
        console.log(chalk.yellow("⚠ Workspace ID is required"));
        return;
      }
    }

    if (!name) {
      console.log(chalk.yellow("⚠ Please provide a task name"));
      return;
    }

    let data = null;
    try {
      if (taskData) {
        data = typeof taskData === "string" ? JSON.parse(taskData) : taskData;
      } else if (taskFile) {
        data = JSON.parse(await fs.readFile(taskFile, "utf8"));
      } else {
        console.log(chalk.yellow("⚠ No data provided"));
        return;
      }
    } catch (e) {
      console.error(chalk.red("Error parsing JSON data:"), e.message);
      return;
    }

    const response = await graphQuery(CREATE_TASK_MUTATION, {
      name: name,
      content: data,
      environment_id: workspaceId,
    });

    const taskId = response.createAutomationTask;
    console.log(chalk.green(`✓ Task created successfully with ID: ${taskId}`));

    // // Show the newly created task
    // await showTask(taskId);
  } catch (error) {
    console.error(chalk.red("Error creating task:"), error.message);
  }
}

export async function cloneTask(taskId, step = null) {
  try {
    if (!taskId) {
      console.log(chalk.yellow("⚠ Please provide a task ID"));
      return;
    }

    if (step) {
      const taskData = await graphQuery(GET_TASK_QUERY, {
        id: taskId,
      });
      const task = taskData.getAutomationEnvironmentTask;
      const history = taskData.getAutomationEnvironmentTaskHistory;
      const normalized = getNormalizedHistory(task, history);
      const stepIdx = parseInt(step, 10);
      if (!isNaN(stepIdx) && stepIdx >= 0 && stepIdx < normalized.length) {
        const stepId = normalized[stepIdx].id;
        const response = await graphQuery(NEW_TASK_FROM_HISTORY_MUTATION, {
          id: stepId,
        });
        const newTaskId = response.createAutomationTaskFromHistory;
        console.log(
          chalk.green(`✓ Task created successfully with ID: ${newTaskId}`),
        );
      } else {
        console.log(chalk.red("Invalid step number specified."));
        return;
      }
    } else {
      const response = await graphQuery(CLONE_TASK_MUTATION, {
        id: taskId,
      });

      const newTaskId = response.createAutomationTaskFromTask;
      console.log(
        chalk.green(`✓ Task cloned successfully with ID: ${newTaskId}`),
      );
    }

    // // Show the newly cloned task
    // await showTask(newTaskId);
  } catch (error) {
    console.error(chalk.red("Error cloning task:"), error.message);
  }
}

export async function stopTask(taskId) {
  try {
    if (!taskId) {
      console.log(chalk.yellow("⚠ Please provide a task ID"));
      return;
    }

    const response = await graphQuery(STOP_TASK_MUTATION, {
      id: taskId,
    });

    if (response.stopAutomationTask) {
      console.log(chalk.green(`✓ Task ${taskId} stopped successfully`));
    } else {
      console.log(chalk.yellow(`⚠ Task ${taskId} could not be stopped`));
    }
  } catch (error) {
    console.error(chalk.red("Error stopping task:"), error.message);
  }
}

export async function resumeTask(taskId) {
  try {
    if (!taskId) {
      console.log(chalk.yellow("⚠ Please provide a task ID"));
      return;
    }

    const response = await graphQuery(RESUME_TASK_MUTATION, {
      id: taskId,
    });

    if (response.resumeAutomationTaskFromHistory) {
      console.log(chalk.green(`✓ Task ${taskId} resumed successfully`));
    } else {
      console.log(chalk.yellow(`⚠ Task ${taskId} could not be resumed`));
    }
  } catch (error) {
    console.error(chalk.red("Error resuming task:"), error.message);
  }
}
