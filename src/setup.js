import fs from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import { getPackageRoot } from "./utils.js";

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

  const spinner = ora("Creating configuration directory\n").start();

  try {
    // Get package root and create config directory
    const packageRoot = await getPackageRoot();
    console.log("packageRoot: ", packageRoot);
    const configDir = path.join(packageRoot, ".config");
    const configFile = path.join(configDir, "config.json");

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      spinner.text = "Configuration directory created";
    } else {
      spinner.text = "Configuration directory exists";
    }

    // Download/setup configuration files
    await setupConfigFiles(force, configFile);

    spinner.succeed("CLI configuration setup completed");

    console.log(chalk.green("\n✅ Aloma CLI is now configured!"));
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
 * @param {string} configFile - Configuration file path
 * @returns {Promise<void>}
 */
async function setupConfigFiles(force, configFile) {
  // Check if config files already exist
  const configExists = fs.existsSync(configFile);

  if (configExists && !force) {
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
    // Load configuration from template files
    const configData = loadConfigTemplate(environment);

    if (!configData) {
      throw new Error(
        `Configuration template not found for environment: ${environment}`,
      );
    }

    // Write the configuration to config.json
    fs.writeFileSync(configFile, JSON.stringify(configData, null, 2));
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
  // Get the directory of this setup.js file
  const __filename = decodeURIComponent(import.meta.url.replace("file://", ""));
  const __dirname = path.dirname(__filename);

  // Build path to config templates relative to this file
  const templatePath = path.join(
    __dirname,
    "..",
    "config",
    `${environment}.json`,
  );

  try {
    const templateData = fs.readFileSync(templatePath, "utf8");
    return JSON.parse(templateData);
  } catch (error) {
    console.warn(
      `Could not load template for ${environment} from ${templatePath}. Error: ${error.message}`,
    );
    return null;
  }
}
