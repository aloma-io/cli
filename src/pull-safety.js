import fs from "fs/promises";
import path from "path";

// Step and library names come from the server (anyone who can edit the workspace chooses them).
// When `pull` turns a name into a file path and a file header, it must not be able to:
// - write outside the target folder ("..", absolute paths, empty or "." segments, backslashes,
//   control characters), or
// - close the header comment and put code at the top of the file ("*/", line breaks).

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;

export class UnsafeNameError extends Error {}

// The .js file for `name` ("a/b/c" -> <folder>/a/b/c.js), guaranteed to be inside `folder`.
export function pullTargetFile(name, folder, kind = "step") {
  const unsafe = () =>
    new UnsafeNameError(`unsafe ${kind} name ${JSON.stringify(name)}`);
  if (typeof name !== "string" || name === "" || path.isAbsolute(name))
    throw unsafe();
  const segments = name.split("/");
  for (const seg of segments) {
    if (
      seg === "" ||
      seg === "." ||
      seg === ".." ||
      seg.includes("\\") ||
      CONTROL.test(seg)
    )
      throw unsafe();
    if (process.platform === "win32" && /[:<>"|?*]/.test(seg)) throw unsafe();
  }
  const base = path.resolve(folder);
  const file = path.resolve(
    base,
    ...segments.slice(0, -1),
    `${segments[segments.length - 1]}.js`,
  );
  const rel = path.relative(base, file);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  )
    throw unsafe();
  return file;
}

// Text that is safe inside a /** ... */ header line: no comment end, no line breaks.
export function headerText(value) {
  return String(value ?? "")
    .replace(/\*\//g, "* /")
    .replace(/[\r\n\u2028\u2029]+/g, " ");
}

// One printable line for messages (server-supplied text, control characters removed).
export function oneLine(value) {
  return String(value ?? "").replace(
    /[\u0000-\u001f\u007f\u2028\u2029]+/g,
    " ",
  );
}

const inside = (base, target) => {
  const rel = path.relative(base, target);
  return (
    rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  );
};

// The real location of `target` (links resolved), also when the end of it does not exist yet: the part that
// exists is resolved, the rest is appended. A link that points nowhere is returned as null (it cannot be
// resolved, so it cannot be shown to stay inside).
async function realLocation(target) {
  const rest = [];
  let current = target;
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...rest);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    const exists = await fs.lstat(current).then(
      () => true,
      () => false,
    );
    if (exists) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    rest.unshift(path.basename(current));
    current = parent;
  }
}

// `ref` (a path relative to `folder`) as a real path inside the real `folder`, or null when it is absolute
// or its real location is outside. Nothing is created or read. The returned path has no links in it, so
// using it directly cannot go anywhere else.
export async function realPathInside(folder, ref) {
  if (typeof ref !== "string" || ref === "" || ref.includes("\0")) return null;
  if (path.isAbsolute(ref)) return null;
  const base = await fs.realpath(path.resolve(folder));
  const real = await realLocation(path.resolve(base, ref));
  return real !== null && inside(base, real) ? real : null;
}

// Where pull writes `file` (from pullTargetFile) for `name`: inside the real `folder`, links resolved, or the
// name is refused (named in the error) and nothing is written.
export async function pullWritePath(file, name, folder, kind = "step") {
  const base = await fs.realpath(path.resolve(folder));
  const real = await realLocation(path.resolve(file));
  if (real === null || !inside(base, real) || real === base) {
    throw new UnsafeNameError(
      `${kind} name ${JSON.stringify(name)} is outside the folder`,
    );
  }
  return real;
}
