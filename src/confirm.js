import readline from "readline";

// Only "y" or "yes" (any case, surrounding spaces ignored) is a yes.
export function isYes(reply) {
  const text = typeof reply === "string" ? reply.trim().toLowerCase() : "";
  return text === "y" || text === "yes";
}

// Ask a y/N question on the terminal. No answer (input ended first) is a no.
export function confirm(
  message,
  { input = process.stdin, output = process.stdout } = {},
) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    rl.on("close", () => settle(false));
    rl.question(message, (answer) => {
      settle(isYes(answer));
      rl.close();
    });
  });
}
