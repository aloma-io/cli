#!/usr/bin/env node
import { Command } from "commander";
import { register as registerAuth } from "./commands/auth/index.js";
import { register as registerWorkspace } from "./commands/workspace/index.js";
import { register as registerCompany } from "./commands/company/index.js";
import { register as registerStep } from "./commands/step/index.js";
import { register as registerLibrary } from "./commands/library/index.js";
import { register as registerTask } from "./commands/task/index.js";
import { register as registerWebhook } from "./commands/webhook/index.js";
import { register as registerSecret } from "./commands/secret/index.js";
import { register as registerConnector } from "./commands/connector/index.js";
import { register as registerUser } from "./commands/user/index.js";
import { register as registerDeploy } from "./commands/deploy/index.js";
import { register as registerSetup } from "./commands/setup/index.js";
import { getPackageVersion } from "./package-utils.js";
import { run } from "./runtime.js";
import { workspaceRef } from "./context.js";

const program = new Command();

program
  .name("aloma")
  .description("CLI for interacting with Aloma services and utilities")
  .version(getPackageVersion());

registerAuth(program);
registerWorkspace(program);
registerCompany(program);
registerStep(program);
registerLibrary(program);
registerTask(program);
registerWebhook(program);
registerSecret(program);
registerConnector(program);
registerUser(program);
registerDeploy(program);
registerSetup(program);

// PLAT-116: wherever a command takes a workspace (`-w` or a `[workspace]` argument), `--workspace-id <id>`
// names it by id with no name lookup. Giving both is a usage error.
function addWorkspaceIdOption(command) {
  command.commands.forEach(addWorkspaceIdOption);
  const byOption = command.options.some((o) => o.long === "--workspace");
  const argIndex = command.registeredArguments.findIndex(
    (a) => a.name() === "workspace",
  );
  if (!byOption && argIndex < 0) return;
  command.option("--workspace-id <id>", "Workspace ID (no name lookup)");
  command.hook("preAction", (cmd) => {
    const { workspace, workspaceId } = cmd.opts();
    if (byOption) {
      cmd.setOptionValue("workspace", workspaceRef(workspace, workspaceId));
    } else {
      cmd.processedArgs[argIndex] = workspaceRef(
        cmd.processedArgs[argIndex],
        workspaceId,
      );
    }
  });
}
addWorkspaceIdOption(program);

await run(program, process.argv);

// Export for programmatic use
export default program;
