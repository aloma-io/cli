import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration file paths
const CONFIG_DIR = join(homedir(), ".aloma");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const KEYS_FILE = join(CONFIG_DIR, "keys.json");

// Default configuration templates path (for fallback)
const TEMPLATE_DIR = join(__dirname, "..", "config");

// Get current environment
const ENVIRONMENT =
  process.env.ALOMA_ENV || process.env.NODE_ENV || "production";

// Load configuration from local files
function loadConfig() {
  try {
    const configData = readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(configData);
  } catch (error) {
    // Fallback to template configuration if available
    try {
      const templatePath = join(TEMPLATE_DIR, `${ENVIRONMENT}.json`);
      const templateData = readFileSync(templatePath, "utf8");
      console.warn(
        `Using template configuration for ${ENVIRONMENT} environment.`,
      );
      console.warn('Run "aloma setup" to configure the CLI properly.');
      return JSON.parse(templateData);
    } catch (templateError) {
      console.warn(
        'No configuration found. Run "aloma setup" to configure the CLI.',
      );
      return {};
    }
  }
}

function loadKeys() {
  try {
    const keysData = readFileSync(KEYS_FILE, "utf8");
    return JSON.parse(keysData);
  } catch (error) {
    console.warn(
      'Aloma keys not found. Run "aloma setup" to configure the CLI.',
    );
    return {};
  }
}

// Load configuration
const config = loadConfig();
const keys = loadKeys();

// Export all configuration with environment variable overrides
export const ENVIRONMENT_NAME = ENVIRONMENT;
export const KEYCLOAK_REALM_URL =
  process.env.ALOMA_KEYCLOAK_REALM_URL || config.keycloakRealmUrl || "";
export const CLIENT_ID =
  process.env.ALOMA_CLIENT_ID || config.clientId || "graph";
export const CLIENT_SECRET =
  process.env.ALOMA_CLIENT_SECRET || config.clientSecret || "";
export const REDIRECT_URI =
  process.env.ALOMA_REDIRECT_URI ||
  config.redirectUri ||
  "http://localhost:8989";
export const SCOPE =
  process.env.ALOMA_SCOPE || config.scope || "openid profile email groups";
export const GRAPHQL_URL =
  process.env.ALOMA_GRAPHQL_URL || config.graphqlUrl || "";
export const GRAPHQL_HOST =
  process.env.ALOMA_GRAPHQL_HOST || config.graphqlHost || "";
export const AUTH_PUBLIC_KEY =
  process.env.ALOMA_AUTH_PUBLIC_KEY ||
  keys.authPublicKey ||
  config.authPublicKey ||
  "";

// Export configuration paths for setup script
export { CONFIG_DIR, CONFIG_FILE, KEYS_FILE };
