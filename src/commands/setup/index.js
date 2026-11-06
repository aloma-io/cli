import { setupCLIConfig } from "../../setup.js";
import { failure } from "../../runtime.js";

export function register(program) {
  program
    .command("setup")
    .description("Setup Aloma CLI configuration")
    .option("-f, --force", "Force overwrite existing configuration")
    .action(async (options) => {
      try {
        await setupCLIConfig({ force: options.force });
      } catch (error) {
        throw failure("Setup failed:", error);
      }
    });
}
