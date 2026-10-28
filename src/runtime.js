// One exit-code rule for every command (PLAT-81).
// Command code throws when its operation fails; the action() wrapper prints the error once, to stderr, and sets
// the exit code: 1 for a failed operation, 2 for a usage error (bad arguments or options, as commander does).
// A stack trace is printed only when DEBUG is set.
import chalk from "chalk";

export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export class CliError extends Error {
  constructor(message, { exitCode = EXIT_FAILURE, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export class UsageError extends CliError {
  constructor(message, options = {}) {
    super(message, { ...options, exitCode: EXIT_USAGE });
    this.name = "UsageError";
  }
}

// Turn a lower-level error into the command's own message ("Error listing webhooks: <reason>").
// An error that is already a CliError carries its final message and passes through unchanged.
export function failure(label, error) {
  if (error instanceof CliError) return error;
  return new CliError(`${label} ${error?.message ?? error}`, { cause: error });
}

// Print an error the way every command does: one line on stderr, the stack only with DEBUG.
export function reportError(error) {
  const message =
    error instanceof CliError
      ? error.message
      : `${error?.prefix ?? `${error?.name ?? "Error"}:`} ${error?.message ?? error}`;
  console.error(chalk.red(message));
  if (process.env.DEBUG && error?.stack) {
    console.error(error.cause?.stack ?? error.stack);
  }
}

// Run the program: every action handler's error ends up here, is printed once and sets the exit code.
// Commander's own parse errors (missing argument, unknown option or command, ...) exit 2; help and --version 0.
export async function run(program, argv) {
  useUsageExitCodes(program);
  try {
    await program.parseAsync(argv);
  } catch (error) {
    reportError(error);
    process.exitCode =
      error instanceof CliError ? error.exitCode : EXIT_FAILURE;
  }
}

function useUsageExitCodes(command) {
  command.exitOverride((err) => {
    process.exit(err.exitCode === 0 ? 0 : EXIT_USAGE);
  });
  command.commands.forEach(useUsageExitCodes);
}
