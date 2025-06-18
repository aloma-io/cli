import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import ora from 'ora';

/**
 * Creates a new Aloma automation project
 *
 * @param {string} name - The name of the project
 * @param {Object} options - Configuration options
 * @param {string} options.directory - Directory to create the project in
 * @param {boolean} options.overwrite - Whether to overwrite existing directory
 * @returns {Promise<void>}
 */
export async function createProject(name, options = {}) {
  const { directory = name, overwrite = false } = options;

  // Create full path
  const projectPath = path.resolve(process.cwd(), directory);

  console.log(chalk.blue(`\n🚀 Creating new Aloma automation project: ${chalk.bold(name)}\n`));

  // Check if directory exists
  if (fs.existsSync(projectPath)) {
    if (!overwrite) {
      console.error(
        chalk.red(`Error: Directory ${projectPath} already exists. Use --force to overwrite.`)
      );
      process.exit(1);
    }
    console.warn(chalk.yellow(`Warning: Overwriting existing directory ${projectPath}`));
  }

  try {
    // Create directory if it doesn't exist
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    // Move to project directory
    process.chdir(projectPath);

    // Initialize project
    await initializeProject(name);

    // Create template files
    await createTemplateFiles(name);

    // Success message
    console.log(chalk.green(`\n✅ Project created successfully in ${projectPath}`));
    console.log(chalk.white(`\nNext steps:`));
    console.log(chalk.white(`  1. cd ${directory}`));
    console.log(chalk.white(`  2. npm install (if needed)`));
    console.log(chalk.white(`  3. npm start\n`));
  } catch (error) {
    console.error(chalk.red(`\n❌ Failed to create project: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Initialize npm project
 *
 * @param {string} name - Project name
 * @returns {Promise<void>}
 */
async function initializeProject(name) {
  const spinner = ora('Initializing project').start();

  try {
    // Create package.json if it doesn't exist
    if (!fs.existsSync('package.json')) {
      const packageJson = {
        name,
        version: '1.0.0',
        description: 'Aloma automation project',
        main: 'index.js',
        type: 'module',
        scripts: {
          start: 'node index.js',
          test: 'echo "Error: no test specified" && exit 1',
        },
        keywords: ['aloma', 'automation'],
        author: '',
        license: 'ISC',
        dependencies: {
          aloma: '^1.0.0',
        },
      };

      fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));

      // Install dependencies
      spinner.text = 'Installing dependencies...';
      execSync('npm install', { stdio: 'ignore' });
    }

    spinner.succeed('Project initialized');
  } catch (error) {
    spinner.fail(`Failed to initialize project: ${error.message}`);
    throw error;
  }
}

/**
 * Create template files for the project
 *
 * @param {string} name - Project name
 * @returns {Promise<void>}
 */
async function createTemplateFiles(name) {
  const spinner = ora('Creating template files').start();

  try {
    // Create directories
    const directories = ['automations', 'config', 'logs'];
    directories.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Create index.js
    const indexContent = `// Main entry point for ${name}
import { Aloma } from 'aloma';

// Initialize Aloma
const aloma = new Aloma({
  projectName: '${name}',
  logDirectory: './logs',
  configPath: './config'
});

// Load automations
aloma.loadAutomationsFromDirectory('./automations');

// Start the automation engine
aloma.start()
  .then(() => {
    console.log('Automation engine started successfully');
  })
  .catch(err => {
    console.error('Failed to start automation engine:', err);
    process.exit(1);
  });
`;
    fs.writeFileSync('index.js', indexContent);

    // Create example automation
    const exampleAutomationContent = `// Example automation
export default {
  name: 'example-automation',
  description: 'An example automation task',
  schedule: '0 */2 * * *', // Run every 2 hours
  enabled: true,

  // Main task function
  async run({ logger }) {
    logger.info('Starting example automation');

    try {
      // Your automation logic here
      logger.info('Performing task...');

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 1000));

      logger.success('Task completed successfully');
      return { status: 'success', message: 'Task completed' };
    } catch (error) {
      logger.error('Task failed', error);
      return { status: 'error', message: error.message };
    }
  }
};
`;
    fs.writeFileSync('automations/example.js', exampleAutomationContent);

    // Create config file
    const configContent = `// Configuration for ${name}
export default {
  // Global settings
  global: {
    concurrency: 3,
    defaultTimeout: 60000, // 1 minute
    retryAttempts: 3,
    retryDelay: 5000, // 5 seconds
  },

  // Task-specific settings
  tasks: {
    'example-automation': {
      timeout: 120000, // 2 minutes
      priority: 1
    }
  }
};
`;
    fs.writeFileSync('config/config.js', configContent);

    // Create .gitignore
    const gitignoreContent = `# Node.js
node_modules/
npm-debug.log
yarn-debug.log
yarn-error.log

# Logs
logs/
*.log

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Editor folders
.idea/
.vscode/
*.swp
*.swo

# Operating System
.DS_Store
Thumbs.db
`;
    fs.writeFileSync('.gitignore', gitignoreContent);

    // Create README.md
    const readmeContent = `# ${name}

An Aloma automation project.

## Getting Started

1. Install dependencies:
   \`\`\`
   npm install
   \`\`\`

2. Start the automation engine:
   \`\`\`
   npm start
   \`\`\`

## Project Structure

- \`/automations\`: Contains automation task definitions
- \`/config\`: Configuration files
- \`/logs\`: Log files (created automatically)
- \`index.js\`: Main entry point

## Creating Automations

Create new automations in the \`/automations\` directory. Each automation should export an object with:

- \`name\`: Unique identifier for the task
- \`description\`: Human-readable description
- \`schedule\`: Cron pattern for scheduling (or null for manual execution)
- \`enabled\`: Boolean to enable/disable the task
- \`run\`: Async function that performs the task logic

Example:

\`\`\`javascript
export default {
  name: 'my-task',
  description: 'My custom task',
  schedule: '0 0 * * *', // Run daily at midnight
  enabled: true,

  async run({ logger }) {
    // Your task logic here
    logger.info('Task running');
    return { status: 'success' };
  }
};
\`\`\`
`;
    fs.writeFileSync('README.md', readmeContent);

    spinner.succeed('Template files created');
  } catch (error) {
    spinner.fail(`Failed to create template files: ${error.message}`);
    throw error;
  }
}
