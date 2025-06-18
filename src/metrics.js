import chalk from 'chalk';
import Table from 'cli-table3';

// Mock data: Tasks and their metrics
const mockTasks = [
  {
    id: 'task1',
    name: 'Daily Data Sync',
    status: 'running',
    type: 'scheduled',
    schedule: '0 0 * * *', // Cron: midnight daily
    lastRun: new Date(Date.now() - 3600000), // 1 hour ago
    nextRun: new Date(Date.now() + 82800000), // 23 hours from now
    metrics: {
      totalRuns: 187,
      successRate: 98.4,
      avgDuration: 45.2,
      lastRunDuration: 42.7,
      errors: 3,
      dataProcessed: '1.2GB',
    },
  },
  {
    id: 'task2',
    name: 'Customer Analytics',
    status: 'failed',
    type: 'scheduled',
    schedule: '0 */6 * * *', // Every 6 hours
    lastRun: new Date(Date.now() - 7200000), // 2 hours ago
    nextRun: new Date(Date.now() + 14400000), // 4 hours from now
    metrics: {
      totalRuns: 723,
      successRate: 94.6,
      avgDuration: 128.3,
      lastRunDuration: 139.8,
      errors: 39,
      dataProcessed: '4.5GB',
    },
  },
  {
    id: 'task3',
    name: 'Order Processing',
    status: 'idle',
    type: 'trigger',
    trigger: 'new_order',
    lastRun: new Date(Date.now() - 86400000), // 1 day ago
    metrics: {
      totalRuns: 3542,
      successRate: 99.7,
      avgDuration: 2.3,
      lastRunDuration: 1.9,
      errors: 11,
      dataProcessed: '12.8MB',
    },
  },
  {
    id: 'task4',
    name: 'Report Generation',
    status: 'completed',
    type: 'scheduled',
    schedule: '0 9 * * 1', // 9am on Mondays
    lastRun: new Date(Date.now() - 259200000), // 3 days ago
    nextRun: new Date(Date.now() + 345600000), // 4 days from now
    metrics: {
      totalRuns: 48,
      successRate: 100.0,
      avgDuration: 347.9,
      lastRunDuration: 352.1,
      errors: 0,
      dataProcessed: '8.7GB',
    },
  },
  {
    id: 'task5',
    name: 'ML Model Training',
    status: 'running',
    type: 'scheduled',
    schedule: '0 0 * * 0', // Midnight on Sundays
    lastRun: new Date(Date.now() - 172800000), // 2 days ago
    nextRun: new Date(Date.now() + 432000000), // 5 days from now
    metrics: {
      totalRuns: 24,
      successRate: 91.7,
      avgDuration: 3720.0, // in seconds (over an hour)
      lastRunDuration: 3682.5,
      errors: 2,
      dataProcessed: '120GB',
    },
  },
];

// Helper function to format time duration nicely
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  } else if (seconds < 3600) {
    return `${(seconds / 60).toFixed(1)}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

// Helper function to format dates
function formatDate(date) {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Helper function to get status color
function getStatusColor(status) {
  switch (status.toLowerCase()) {
    case 'running':
      return chalk.green;
    case 'completed':
      return chalk.blue;
    case 'idle':
      return chalk.gray;
    case 'failed':
      return chalk.red;
    default:
      return chalk.white;
  }
}

// Get a colored status string
function getStatusString(status) {
  const statusColor = getStatusColor(status);
  return statusColor(`● ${status.toUpperCase()}`);
}

// Function to display the task metrics table
function displayTaskMetrics(tasks = mockTasks) {
  console.log(chalk.bold.blue('\n📊 ALOMA TASK METRICS SUMMARY\n'));

  // Task Status Table
  const tasksTable = new Table({
    head: [
      chalk.bold('ID'),
      chalk.bold('Name'),
      chalk.bold('Status'),
      chalk.bold('Type'),
      chalk.bold('Last Run'),
      chalk.bold('Next Run'),
      chalk.bold('Success Rate'),
    ],
    style: {
      head: [], // Disable colors in the header (we manually set them above)
      border: [], // Disable colors in the border
    },
  });

  tasks.forEach((task) => {
    const statusColor = getStatusColor(task.status);

    tasksTable.push([
      task.id,
      chalk.bold(task.name),
      getStatusString(task.status),
      task.type === 'scheduled' ? `⏰ ${task.schedule}` : `🔔 ${task.trigger}`,
      formatDate(task.lastRun),
      task.nextRun ? formatDate(task.nextRun) : '—',
      task.metrics.successRate >= 98
        ? chalk.green(`${task.metrics.successRate}%`)
        : task.metrics.successRate >= 90
          ? chalk.yellow(`${task.metrics.successRate}%`)
          : chalk.red(`${task.metrics.successRate}%`),
    ]);
  });

  console.log(tasksTable.toString());

  // Detailed Metrics Table
  console.log(chalk.bold.blue('\n📈 DETAILED METRICS\n'));

  const metricsTable = new Table({
    head: [
      chalk.bold('Task'),
      chalk.bold('Total Runs'),
      chalk.bold('Avg Duration'),
      chalk.bold('Last Duration'),
      chalk.bold('Errors'),
      chalk.bold('Data Processed'),
    ],
    style: {
      head: [],
      border: [],
    },
  });

  tasks.forEach((task) => {
    metricsTable.push([
      chalk.bold(task.name),
      task.metrics.totalRuns.toLocaleString(),
      formatDuration(task.metrics.avgDuration),
      formatDuration(task.metrics.lastRunDuration),
      task.metrics.errors === 0 ? chalk.green('0') : chalk.red(task.metrics.errors.toString()),
      task.metrics.dataProcessed,
    ]);
  });

  console.log(metricsTable.toString());

  // Overall System Metrics
  const totalRuns = tasks.reduce((sum, task) => sum + task.metrics.totalRuns, 0);
  const avgSuccessRate =
    tasks.reduce((sum, task) => sum + task.metrics.successRate, 0) / tasks.length;
  const totalErrors = tasks.reduce((sum, task) => sum + task.metrics.errors, 0);

  console.log(chalk.bold.blue('\n🔍 SYSTEM OVERVIEW\n'));

  const overviewTable = new Table();

  overviewTable.push(
    { [chalk.bold('Total Tasks')]: chalk.cyan(tasks.length.toString()) },
    {
      [chalk.bold('Active Tasks')]: chalk.green(
        tasks.filter((t) => t.status === 'running').length.toString()
      ),
    },
    {
      [chalk.bold('Failed Tasks')]: chalk.red(
        tasks.filter((t) => t.status === 'failed').length.toString()
      ),
    },
    { [chalk.bold('Total Task Runs')]: chalk.yellow(totalRuns.toLocaleString()) },
    {
      [chalk.bold('Average Success Rate')]:
        avgSuccessRate >= 98
          ? chalk.green(`${avgSuccessRate.toFixed(1)}%`)
          : avgSuccessRate >= 90
            ? chalk.yellow(`${avgSuccessRate.toFixed(1)}%`)
            : chalk.red(`${avgSuccessRate.toFixed(1)}%`),
    },
    {
      [chalk.bold('Total Errors')]:
        totalErrors === 0 ? chalk.green('0') : chalk.red(totalErrors.toString()),
    }
  );

  console.log(overviewTable.toString());
}

function getDemoMetrics() {
  return {
    totalRuns: 1000,
    successRate: 95.5,
    avgDuration: 30.5,
    lastRunDuration: 29.8,
    errors: 5,
    dataProcessed: '1.2GB',
  };
}

// Export functions and data for use in CLI
export { mockTasks, displayTaskMetrics, getDemoMetrics };
