// Shared by both mutation runners (PLAT-464): when a break applies, which ids a run covers, and the arguments.
import path from "node:path";

// A break applies only when its old text is in the file exactly once; returns the changed text, or null.
export function applyBreak(original, find, replace) {
  return original.split(find).length - 1 === 1 ? original.replace(find, () => replace) : null;
}

// ids: the arguments that are neither flags nor the --root value; root: --root, else the REPO variable, else null.
export function parseArgs(argv, env) {
  const ids = [];
  const flags = [];
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      root = argv[++i];
      if (!root) throw new Error("--root needs a directory");
    } else if (argv[i].startsWith("--")) flags.push(argv[i]);
    else ids.push(argv[i]);
  }
  return { ids, flags, root: root ?? env.REPO ?? null };
}

// No ids wanted means every known id; wanted ids that are not known are returned, not dropped.
export function selectIds(wanted, known) {
  return {
    selected: wanted.length ? known.filter((id) => wanted.includes(id)) : [...known],
    unknown: [...new Set(wanted.filter((id) => !known.includes(id)))],
  };
}

// The repository root a run reads from: --root / REPO when given, else the repo this file sits in.
export function repoRoot(root, fallback) {
  return root ? path.resolve(root) : fallback;
}
