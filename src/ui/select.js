import chalk from "chalk";
import { CliError } from "../runtime.js";

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const CTRL_C = "\u0003";
const ESCAPE = "\u001b";

// The one arrow-key picker: shows `items` ({ id, name }) under `title`, returns the one the user picks with
// Enter, and rejects with a CliError when the user cancels (Escape or Ctrl+C). Whichever way it ends (a pick,
// a cancel or an error) raw mode is switched off and the input is paused again.
export function selectFromList({
  title,
  items,
  currentId,
  input = process.stdin,
  output = process.stdout,
}) {
  const hint = chalk.gray(
    "Use ↑/↓ arrows to navigate, Enter to select, Ctrl+C to cancel\n",
  );
  const print = (line) => output.write(`${line}\n`);

  let selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === currentId),
  );

  print(chalk.blue(`\n${title}`));
  print(hint);

  return new Promise((resolve, reject) => {
    let finished = false;

    const restoreTerminal = () => {
      input.off("data", handleKeyPress);
      try {
        if (typeof input.setRawMode === "function") input.setRawMode(false);
      } finally {
        input.pause();
      }
    };

    const finish = (settle, value) => {
      if (finished) return;
      finished = true;
      try {
        restoreTerminal();
      } catch (error) {
        reject(error);
        return;
      }
      settle(value);
    };

    const display = () => {
      // Clear screen and move cursor to top
      output.write("\x1B[2J\x1B[0f");
      print(chalk.blue(title));
      print(hint);

      items.forEach((item, index) => {
        const isSelected = index === selectedIndex;
        const isCurrent = item.id === currentId;
        const prefix = isSelected ? chalk.cyan("❯ ") : "  ";
        const name = isSelected
          ? chalk.cyan.bold(item.name)
          : chalk.white(item.name);
        const current = isCurrent ? chalk.green(" [current]") : "";
        const id = chalk.gray(` (ID: ${item.id})`);

        print(`${prefix}${name}${id}${current}`);
      });
    };

    const handleKeyPress = (key) => {
      if (finished) return;
      try {
        if (key === CTRL_C || key === ESCAPE) {
          finish(reject, new CliError("\nSelection cancelled."));
          return;
        }

        if (key === "\r" || key === "\n") {
          const selected = items[selectedIndex];
          print(chalk.green(`\nSelected: ${selected.name}`));
          finish(resolve, selected);
          return;
        }

        if (key === UP) {
          selectedIndex =
            selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
          display();
        } else if (key === DOWN) {
          selectedIndex =
            selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
          display();
        }
      } catch (error) {
        finish(reject, error);
      }
    };

    try {
      // Raw mode for key capture; piped input has none (same message as before the picker was shared)
      if (typeof input.setRawMode !== "function") {
        throw new TypeError("process.stdin.setRawMode is not a function");
      }
      input.setRawMode(true);
      input.resume();
      input.setEncoding("utf8");
      display();
      input.on("data", handleKeyPress);
    } catch (error) {
      finish(reject, error);
    }
  });
}
