import readline from "readline";

// Ask a y/N question on the terminal: only "y" or "yes" (any case, surrounding spaces ignored) is a yes.
export function confirm(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(message, (answer) => {
      rl.close();
      const reply = answer.trim().toLowerCase();
      resolve(reply === "y" || reply === "yes");
    });
  });
}
