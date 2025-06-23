import fs from "fs";
import path from "path";
import { homedir } from "os";
import chalk from "chalk";
import { execSync } from "child_process";
import ora from "ora";
import { CONFIG_DIR, CONFIG_FILE, KEYS_FILE } from "./config.js";

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

  console.log(
    chalk.blue(
      `\n🚀 Creating new Aloma automation project: ${chalk.bold(name)}\n`,
    ),
  );

  // Check if directory exists
  if (fs.existsSync(projectPath)) {
    if (!overwrite) {
      console.error(
        chalk.red(
          `Error: Directory ${projectPath} already exists. Use --force to overwrite.`,
        ),
      );
      process.exit(1);
    }
    console.warn(
      chalk.yellow(`Warning: Overwriting existing directory ${projectPath}`),
    );
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
    console.log(
      chalk.green(`\n✅ Project created successfully in ${projectPath}`),
    );
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
  const spinner = ora("Initializing project").start();

  try {
    // Create package.json if it doesn't exist
    if (!fs.existsSync("package.json")) {
      const packageJson = {
        name,
        version: "1.0.0",
        description: "Aloma automation project",
        main: "index.js",
        type: "module",
        scripts: {
          start: "node index.js",
          test: 'echo "Error: no test specified" && exit 1',
        },
        keywords: ["aloma", "automation"],
        author: "",
        license: "ISC",
        dependencies: {
          aloma: "^1.0.0",
        },
      };

      fs.writeFileSync("package.json", JSON.stringify(packageJson, null, 2));

      // Install dependencies
      spinner.text = "Installing dependencies...";
      execSync("npm install", { stdio: "ignore" });
    }

    spinner.succeed("Project initialized");
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
  const spinner = ora("Creating template files").start();

  try {
    // Create directories
    const directories = ["automations", "config", "logs"];
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
    fs.writeFileSync("index.js", indexContent);

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
    fs.writeFileSync("automations/example.js", exampleAutomationContent);

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
    fs.writeFileSync("config/config.js", configContent);

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
    fs.writeFileSync(".gitignore", gitignoreContent);

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
    fs.writeFileSync("README.md", readmeContent);

    spinner.succeed("Template files created");
  } catch (error) {
    spinner.fail(`Failed to create template files: ${error.message}`);
    throw error;
  }
}

/**
 * Setup CLI configuration
 * This function should be called during npm install via postinstall script
 * or when user runs "aloma setup"
 *
 * @param {Object} options - Setup options
 * @param {boolean} options.force - Force overwrite existing config
 * @returns {Promise<void>}
 */
export async function setupCLIConfig(options = {}) {
  const { force = false } = options;

  console.log(chalk.blue("\n🔧 Setting up Aloma CLI configuration...\n"));

  const spinner = ora("Creating configuration directory").start();

  try {
    // Create config directory
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      spinner.text = "Configuration directory created";
    } else {
      spinner.text = "Configuration directory exists";
    }

    // Download/setup configuration files
    await setupConfigFiles(force);

    spinner.succeed("CLI configuration setup completed");

    console.log(chalk.green("\n✅ Aloma CLI is now configured!"));
    console.log(chalk.white("\nConfiguration stored in:"));
    console.log(chalk.gray(`  Config: ${CONFIG_FILE}`));
    console.log(chalk.gray(`  Keys: ${KEYS_FILE}`));
    console.log(chalk.white("\nYou can now use: aloma auth\n"));
  } catch (error) {
    spinner.fail(`Setup failed: ${error.message}`);
    console.error(
      chalk.red(
        "\n❌ CLI setup failed. Please check your internet connection and try again.",
      ),
    );
    throw error;
  }
}

/**
 * Setup configuration files by downloading from remote or using defaults
 *
 * @param {boolean} force - Force overwrite existing files
 * @returns {Promise<void>}
 */
async function setupConfigFiles(force) {
  // Check if config files already exist
  const configExists = fs.existsSync(CONFIG_FILE);
  const keysExist = fs.existsSync(KEYS_FILE);

  if ((configExists || keysExist) && !force) {
    console.log(
      chalk.yellow(
        "Configuration files already exist. Use --force to overwrite.",
      ),
    );
    return;
  }

  // Detect environment
  const environment =
    process.env.ALOMA_ENV || process.env.NODE_ENV || "production";

  try {
    // Try to fetch configuration from remote endpoint
    const configData = await fetchRemoteConfig(environment);
    const keysData = await fetchRemoteKeys(environment);

    // Write configuration files
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configData, null, 2));
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keysData, null, 2));

    console.log(
      chalk.green(
        `\n✅ Configuration loaded from template for ${environment} environment`,
      ),
    );

    if (configData.setupMethod === "template") {
      console.log(
        chalk.yellow(
          "\n⚠️  Using template configuration with placeholder secrets.",
        ),
      );
      console.log(
        chalk.white("Please set the following environment variables:"),
      );
      console.log(
        chalk.gray('  export ALOMA_CLIENT_SECRET="your-client-secret"'),
      );
      console.log(
        chalk.gray('  export ALOMA_AUTH_PUBLIC_KEY="your-auth-public-key"'),
      );

      if (environment === "development") {
        console.log(chalk.white("\nOr to use production environment:"));
        console.log(chalk.gray('  export ALOMA_ENV="production"'));
      }
    }
  } catch (error) {
    console.warn(chalk.red(`\nError during setup: ${error.message}`));
    throw error;
  }
}

/**
 * Load configuration template based on environment
 *
 * @param {string} environment - Environment name (production, development)
 * @returns {Object}
 */
function loadConfigTemplate(environment) {
  const templatePath = path.join(
    path.dirname(process.argv[1] || import.meta.url.replace("file://", "")),
    "..",
    "config",
    `${environment}.json`,
  );

  try {
    const templateData = fs.readFileSync(templatePath, "utf8");
    return JSON.parse(templateData);
  } catch (error) {
    console.warn(
      `Could not load template for ${environment}. Using minimal defaults.`,
    );
    return {
      environment,
      keycloakRealmUrl:
        environment === "development"
          ? "https://accounts-dev.aloma.io/realms/master"
          : "https://accounts.aloma.io/realms/master",
      clientId: "graph",
      redirectUri: "http://localhost:8989",
      scope: "openid profile email groups",
      graphqlUrl:
        environment === "development"
          ? "https://test.graph.aloma.io/graphql"
          : "https://graph.aloma.io/graphql",
      graphqlHost:
        environment === "development"
          ? "test.graph.aloma.io"
          : "graph.aloma.io",
    };
  }
}

/**
 * Fetch configuration from remote endpoint
 * Replace this URL with your actual configuration endpoint
 *
 * @param {string} environment - Environment name
 * @returns {Promise<Object>}
 */
async function fetchRemoteConfig(environment = "production") {
  try {
    // This is a placeholder - replace with your actual configuration endpoint
    // const response = await fetch(`https://api.aloma.io/cli/config/${environment}`);
    // if (!response.ok) throw new Error('Failed to fetch config');
    // const remoteConfig = await response.json();
    // return remoteConfig;

    // For now, throw error to use fallback
    throw new Error("Remote configuration not available");
  } catch (error) {
    // Fallback to template configuration
    const templateConfig = loadConfigTemplate(environment);

    // Add setup metadata
    templateConfig.setupTime = new Date().toISOString();
    templateConfig.setupMethod = "template";

    return templateConfig;
  }
}

/**
 * Fetch keys from remote endpoint
 * Replace this URL with your actual keys endpoint
 *
 * @param {string} environment - Environment name
 * @returns {Promise<Object>}
 */
async function fetchRemoteKeys(environment = "production") {
  try {
    // This is a placeholder - replace with your actual keys endpoint
    // const response = await fetch(`https://api.aloma.io/cli/keys/${environment}`);
    // if (!response.ok) throw new Error('Failed to fetch keys');
    // const remoteKeys = await response.json();
    // return remoteKeys;

    // For now, throw error to use fallback
    throw new Error("Remote keys not available");
  } catch (error) {
    // Return empty keys that will be populated by environment variables or manual setup
    return {
      setupTime: new Date().toISOString(),
      setupMethod: "template",
    };
  }
}
