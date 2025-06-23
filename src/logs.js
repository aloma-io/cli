import chalk from "chalk";
import { mockTasks } from "./metrics.js";

// Log levels with their display properties
const LOG_LEVELS = {
  INFO: {
    color: chalk.blue,
    label: "INFO",
    prefix: "ℹ️",
  },
  DEBUG: {
    color: chalk.cyan,
    label: "DEBUG",
    prefix: "🔍",
  },
  WARN: {
    color: chalk.yellow,
    label: "WARN",
    prefix: "⚠️",
  },
  ERROR: {
    color: chalk.red,
    label: "ERROR",
    prefix: "❌",
  },
  SUCCESS: {
    color: chalk.green,
    label: "SUCCESS",
    prefix: "✅",
  },
};

// Common log message patterns for different task types
const LOG_PATTERNS = {
  "Daily Data Sync": [
    { level: "INFO", message: "Starting data synchronization process" },
    { level: "DEBUG", message: "Connected to data source" },
    { level: "INFO", message: "Fetching records from API endpoint" },
    { level: "DEBUG", message: "Processing batch of {x} records" },
    { level: "WARN", message: "Slow response time detected: {x}ms" },
    { level: "ERROR", message: "Failed to process record: {uuid}" },
    { level: "INFO", message: "Successfully synced {x} records" },
    { level: "SUCCESS", message: "Data sync completed in {x} seconds" },
  ],
  "Customer Analytics": [
    { level: "INFO", message: "Starting analytics calculation job" },
    { level: "DEBUG", message: "Loading customer segments" },
    { level: "INFO", message: "Processing {x} customer profiles" },
    { level: "WARN", message: "Missing data points for segment: {segment}" },
    {
      level: "ERROR",
      message: "Analytics calculation failed for customer: {id}",
    },
    { level: "DEBUG", message: "Generated report for time period: {period}" },
    { level: "SUCCESS", message: "Analytics job completed successfully" },
  ],
  "Order Processing": [
    { level: "INFO", message: "Received new order: {orderNumber}" },
    { level: "DEBUG", message: "Validating order items" },
    { level: "INFO", message: "Processing payment for ${x}" },
    { level: "WARN", message: "Inventory low for product: {sku}" },
    { level: "ERROR", message: "Payment processing failed: {errorCode}" },
    { level: "SUCCESS", message: "Order {orderNumber} successfully processed" },
  ],
  "Report Generation": [
    { level: "INFO", message: "Starting report generation" },
    { level: "DEBUG", message: "Gathering data from {x} sources" },
    { level: "INFO", message: "Generating {reportType} report" },
    { level: "WARN", message: "Some data points are missing for {section}" },
    { level: "ERROR", message: "Failed to generate chart: {chartType}" },
    { level: "DEBUG", message: "Applying formatting templates" },
    { level: "SUCCESS", message: "Report successfully generated: {filename}" },
  ],
  "ML Model Training": [
    { level: "INFO", message: "Starting model training with {x} data points" },
    { level: "DEBUG", message: "Preprocessing training data" },
    { level: "INFO", message: "Training epoch {x}/{y} - loss: {loss}" },
    { level: "WARN", message: "High variance detected in feature: {feature}" },
    {
      level: "ERROR",
      message: "Training interrupted due to resource constraints",
    },
    { level: "DEBUG", message: "Model validation F1 score: {score}" },
    {
      level: "SUCCESS",
      message: "Model training completed. Accuracy: {accuracy}%",
    },
  ],
  default: [
    { level: "INFO", message: "Task started" },
    { level: "DEBUG", message: "Processing data" },
    { level: "WARN", message: "Potential issue detected" },
    { level: "ERROR", message: "Task encountered an error" },
    { level: "SUCCESS", message: "Task completed successfully" },
  ],
};

// Generate a random log record
function generateLogRecord(task) {
  const timestamp = new Date().toISOString();
  const taskName = task.name;

  // Get log patterns for this task type, or use default if not found
  const patterns = LOG_PATTERNS[taskName] || LOG_PATTERNS.default;

  // Randomly select a log pattern
  const pattern = patterns[Math.floor(Math.random() * patterns.length)];

  // Generate random values to insert into the log message templates
  let message = pattern.message
    .replace("{x}", Math.floor(Math.random() * 1000))
    .replace("{y}", Math.floor(Math.random() * 100))
    .replace(
      "{uuid}",
      `${Math.random().toString(36).substring(2, 10)}-${Math.random().toString(36).substring(2, 6)}`,
    )
    .replace("{id}", `cust_${Math.floor(Math.random() * 10000)}`)
    .replace(
      "{segment}",
      ["premium", "standard", "basic"][Math.floor(Math.random() * 3)],
    )
    .replace(
      "{period}",
      ["daily", "weekly", "monthly"][Math.floor(Math.random() * 3)],
    )
    .replace("{orderNumber}", `ORD-${Math.floor(Math.random() * 100000)}`)
    .replace("{sku}", `SKU-${Math.floor(Math.random() * 10000)}`)
    .replace(
      "{errorCode}",
      ["AUTH_FAILED", "INSUFFICIENT_FUNDS", "TIMEOUT"][
        Math.floor(Math.random() * 3)
      ],
    )
    .replace(
      "{reportType}",
      ["financial", "performance", "compliance"][Math.floor(Math.random() * 3)],
    )
    .replace(
      "{section}",
      ["revenue", "expenses", "projections"][Math.floor(Math.random() * 3)],
    )
    .replace(
      "{chartType}",
      ["bar", "line", "pie"][Math.floor(Math.random() * 3)],
    )
    .replace("{filename}", `report-${Math.floor(Math.random() * 1000)}.pdf`)
    .replace(
      "{feature}",
      ["age", "income", "location"][Math.floor(Math.random() * 3)],
    )
    .replace("{loss}", (Math.random() * 0.5).toFixed(4))
    .replace("{score}", (Math.random() * 0.3 + 0.7).toFixed(4))
    .replace("{accuracy}", (Math.random() * 15 + 85).toFixed(2));

  // Format the price if needed
  message = message.replace(
    /\${x}/g,
    `$${(Math.random() * 500 + 50).toFixed(2)}`,
  );

  const level = pattern.level;
  const logLevel = LOG_LEVELS[level];

  return {
    timestamp,
    level,
    taskId: task.id,
    taskName,
    message,
    logLevel,
  };
}

// Format and print a log record
function printLogRecord(logRecord) {
  const { timestamp, logLevel, taskId, message } = logRecord;

  // Extract just time part for cleaner display
  const timeStr = timestamp.split("T")[1].substr(0, 12);

  // Format: [time] [emoji prefix] [colored LEVEL] [taskId] message
  console.log(
    `${chalk.gray(timeStr)} ${logLevel.prefix} ${logLevel.color(logLevel.label.padEnd(7))} ${chalk.cyan(`[${taskId}]`)} ${message}`,
  );
}

// Find a task by ID
function findTaskById(taskId) {
  return mockTasks.find((task) => task.id === taskId);
}

// Start tailing logs for a specific task
function tailTaskLogs(taskId, options = {}) {
  const task = findTaskById(taskId);

  if (!task) {
    console.error(chalk.red(`Error: Task with ID "${taskId}" not found.`));
    console.log(chalk.yellow("Available tasks:"));
    mockTasks.forEach((t) => {
      console.log(`  ${chalk.cyan(t.id)} - ${t.name} (${t.status})`);
    });
    return;
  }

  // Default options
  const opts = {
    interval: options.interval || 1000, // milliseconds between logs
    limit: options.limit || 0, // 0 means unlimited logs
    filter: options.filter || null, // null means no filtering
  };

  console.log(
    chalk.bold(
      `\n📋 Tailing logs for task: ${chalk.cyan(taskId)} - ${chalk.yellow(task.name)}\n`,
    ),
  );
  console.log(chalk.gray("Press Ctrl+C to stop...\n"));

  let logCount = 0;

  // Generate initial logs
  const initialLogs = 5;
  for (let i = 0; i < initialLogs; i++) {
    const logRecord = generateLogRecord(task);

    // Apply level filter if specified
    if (opts.filter && logRecord.level !== opts.filter) {
      i--; // Try again to generate a log that matches the filter
      continue;
    }

    printLogRecord(logRecord);
    logCount++;
  }

  // Continue generating logs at intervals
  const intervalId = setInterval(() => {
    // Generate a log
    const logRecord = generateLogRecord(task);

    // Apply level filter if specified
    if (opts.filter && logRecord.level !== opts.filter) {
      return; // Skip this log due to filter
    }

    // Print the log
    printLogRecord(logRecord);

    logCount++;

    // Stop if we hit the limit
    if (opts.limit > 0 && logCount >= opts.limit) {
      clearInterval(intervalId);
      console.log(chalk.gray("\nLog limit reached. Stopped tailing."));
    }
  }, opts.interval);

  // Return the interval ID so it can be cleared if needed
  return intervalId;
}

// List available tasks with their IDs
function listTasksForLogs() {
  console.log(chalk.bold("\n📋 Available tasks for log tailing:\n"));

  const statuses = {
    running: chalk.green("● RUNNING"),
    failed: chalk.red("● FAILED"),
    idle: chalk.gray("● IDLE"),
    completed: chalk.blue("● COMPLETED"),
  };

  mockTasks.forEach((task) => {
    console.log(
      `  ${chalk.cyan(task.id)} - ${chalk.bold(task.name)} (${statuses[task.status] || task.status})`,
    );
  });

  console.log(chalk.gray("\nUsage: aloma logs <taskId> [options]"));
}

function listAvailableTasks() {
  return mockTasks.map((task) => task.id);
}

export { tailTaskLogs, listTasksForLogs, listAvailableTasks };
