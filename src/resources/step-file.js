// The pure rules for a step file (PLAT-78). The API stores and returns a step's condition and content
// verbatim, so a file is read as written: the text is cut out of the file, never parsed and re-printed.
import { createHash } from "crypto";

const CONDITION_START = /^export const condition[ \t]*=[ \t]*/m;
// the end of the condition (its `;` is optional), then the content's arrow function up to its `{`
const CONTENT_START =
  /;?[ \t]*\r?\n(?:[ \t]*\r?\n)*export const content[ \t]*=[ \t]*async[ \t]*\([ \t]*\)[ \t]*=>[ \t]*\{/;
const CONTENT_END = /(?:^|\r?\n)\};?[ \t]*(?:\r?\n)*$/;
const ONE_LINE_END = /\}[ \t]*;?[ \t]*(?:\r?\n)*$/;
const CONTENT_LAYOUT =
  "Could not parse content from file: expected `export const content = async () => {` after the condition and a closing `};`";

// {condition, content}: the exact text of the file's `export const condition` value and the body of its
// `export const content = async () => {...}`. Throws when either is missing. A body that starts on its own line
// is kept byte for byte; a one-line body (`{ x(); };`) is trimmed.
export function readStepFile(text) {
  const start = CONDITION_START.exec(text);
  if (!start) throw new Error("Could not parse condition from file");
  const startAt = start.index + start[0].length;
  const open = CONTENT_START.exec(text.slice(startAt));
  if (!open) throw new Error(CONTENT_LAYOUT);
  const condition = text.slice(startAt, startAt + open.index);
  if (condition.trim() === "") {
    throw new Error("Could not parse condition from file");
  }
  const rest = text.slice(startAt + open.index + open[0].length);
  const newline = /^[ \t]*\r?\n/.exec(rest);
  if (newline) {
    const end = CONTENT_END.exec(rest.slice(newline[0].length));
    if (!end) throw new Error(CONTENT_LAYOUT);
    return {
      condition,
      content: rest.slice(newline[0].length).slice(0, end.index),
    };
  }
  const end = ONE_LINE_END.exec(rest);
  if (!end) throw new Error(CONTENT_LAYOUT);
  return { condition, content: rest.slice(0, end.index).trim() };
}

// The name of the first `$` operator key in a condition (`{ a: { $in: [] } }` gives "$in"), else null.
// The API refuses to save such a condition. Comments and string values are skipped; a key is a `$name` (bare or
// quoted) that follows `{` or `,` and is followed by `:`.
export function findDollarOperator(condition) {
  let i = 0;
  let prev = ""; // the last significant character before i
  const n = condition.length;
  const nextIsColon = (from) => /^\s*:/.test(condition.slice(from));
  while (i < n) {
    const ch = condition[i];
    if (condition.startsWith("//", i)) {
      while (i < n && condition[i] !== "\n") i++;
    } else if (condition.startsWith("/*", i)) {
      const close = condition.indexOf("*/", i + 2);
      i = close === -1 ? n : close + 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && condition[j] !== ch) j += condition[j] === "\\" ? 2 : 1;
      const name = condition.slice(i + 1, j);
      if (
        (prev === "{" || prev === ",") &&
        ch !== "`" &&
        /^\$[A-Za-z_][\w$]*$/.test(name) &&
        nextIsColon(j + 1)
      ) {
        return name;
      }
      i = j + 1;
      prev = ch;
    } else if (ch === "$" && (prev === "{" || prev === ",")) {
      const word = /^\$[A-Za-z_][\w$]*/.exec(condition.slice(i));
      if (word && nextIsColon(i + word[0].length)) return word[0];
      i += 1;
      prev = ch;
    } else {
      if (!/\s/.test(ch)) prev = ch;
      i++;
    }
  }
  return null;
}

// The hash of a step's exact condition and content, to compare with the `content_hash` the API returns.
export function stepContentHash(condition, content) {
  return createHash("sha256")
    .update(JSON.stringify({ if: condition, do: content }))
    .digest("hex");
}
