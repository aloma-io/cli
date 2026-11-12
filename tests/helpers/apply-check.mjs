// Shared by both mutation runners (PLAT-464): when a break applies, which ids a run covers, and the arguments.
import { readFileSync } from "node:fs";
import path from "node:path";

// A break applies only when its old text is in the file exactly once; returns the changed text, or null.
export function applyBreak(original, find, replace) {
  return original.split(find).length - 1 === 1 ? original.replace(find, () => replace) : null;
}

const FLAGS = ["--check-apply", "--list", "--md"];

// ids: the arguments that are neither flags nor the --root value; root: the --root value (--root <dir> or
// --root=<dir>) and nothing else, never an environment variable. Any other flag is an error naming it.
export function parseArgs(argv) {
  const ids = [];
  const flags = [];
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") {
      const next = argv[i + 1];
      if (next === undefined || next === "" || next.startsWith("--")) throw new Error("--root needs a directory");
      root = argv[++i];
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
      if (!root) throw new Error("--root needs a directory");
    } else if (arg.startsWith("--")) {
      if (!FLAGS.includes(arg)) throw new Error(`unknown flag ${arg}`);
      flags.push(arg);
    } else ids.push(arg);
  }
  return { ids, flags, root };
}

// No ids wanted means every known id; wanted ids that are not known are returned, not dropped.
export function selectIds(wanted, known) {
  return {
    selected: wanted.length ? known.filter((id) => wanted.includes(id)) : [...known],
    unknown: [...new Set(wanted.filter((id) => !known.includes(id)))],
  };
}

// The repository root a run reads from: --root when given, else the repo this file sits in.
export function repoRoot(root, fallback) {
  return root ? path.resolve(root) : fallback;
}

// null when the break applies; else the line to print. A missing file is "does not apply"; any other read error
// (a directory, a permission error) is reported with its own message.
export function checkBreak(root, { id, file, find, replace }, read = readFileSync) {
  let text;
  try {
    text = read(path.join(root, file), "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return `${id} does not apply to ${file}`;
    return `${id} cannot read ${file}: ${err?.message ?? err}`;
  }
  return applyBreak(text, find, replace) === null ? `${id} does not apply to ${file}` : null;
}

// Parses the arguments for a runner; a bad argument prints its message and exits 1.
export function parseArgsOrExit(argv) {
  try {
    return parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
