// Export CLI functionality for programmatic use
export { default as CLI } from "./cli.js";

// Export utility functions
export * from "./utils.js";

// Export configuration
export * from "./config.js";

// Legacy export for backward compatibility
export function helloAloma() {
  console.log("Hello from the aloma-io package!");
}
