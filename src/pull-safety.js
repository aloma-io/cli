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
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel))
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
