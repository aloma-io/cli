// The pure rules for a step file (PLAT-78). The API stores and returns a step's condition and content
// verbatim, so a file is read as written: the text is cut out of the file, never parsed and re-printed.
import { createHash } from "crypto";

const CONDITION_START = /^export const condition[ \t]*=[ \t]*/m;
// the `;` ending the condition, then the content's arrow function opening line
const CONTENT_START =
  /;[ \t]*\r?\n(?:[ \t]*\r?\n)*export const content[ \t]*=[ \t]*async[ \t]*\([ \t]*\)[ \t]*=>[ \t]*\{[ \t]*\r?\n/;
const CONTENT_END = /(?:^|\r?\n)\};?[ \t]*(?:\r?\n)*$/;

// {condition, content}: the exact text of the file's `export const condition` value and the body of its
// `export const content = async () => {...}`. Throws when either is missing.
export function readStepFile(text) {
  const start = CONDITION_START.exec(text);
  if (!start) throw new Error("Could not parse condition from file");
  const startAt = start.index + start[0].length;
  const open = CONTENT_START.exec(text.slice(startAt));
  if (!open) throw new Error("Could not parse content from file");
  const condition = text.slice(startAt, startAt + open.index);
  if (condition.trim() === "") {
    throw new Error("Could not parse condition from file");
  }
  const rest = text.slice(startAt + open.index + open[0].length);
  const end = CONTENT_END.exec(rest);
  if (!end) throw new Error("Could not parse content from file");
  return { condition, content: rest.slice(0, end.index) };
}

// The name of the first `$` operator key in a condition (`{ a: { $in: [] } }` gives "$in"), else null.
// The API refuses to save such a condition.
export function findDollarOperator(condition) {
  const match = /[{,][\s]*["']?(\$[A-Za-z_][\w$]*)["']?[ \t\r\n]*:/.exec(
    condition,
  );
  return match ? match[1] : null;
}

// The hash of a step's exact condition and content, to compare with the `content_hash` the API returns.
export function stepContentHash(condition, content) {
  return createHash("sha256")
    .update(JSON.stringify({ if: condition, do: content }))
    .digest("hex");
}
