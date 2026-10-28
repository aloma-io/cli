// One resolver for items that have an id and a name, such as steps and libraries (PLAT-115).
// Names are unique per workspace, but the backend still allows duplicates: the CLI never guesses.
// An exact id wins, then an exact name; more than one name match is refused with the ids listed,
// and a reference that matches nothing is refused instead of being passed on as if it were an id.
import { CliError } from "./runtime.js";
import { oneLine } from "./pull-safety.js";

const idList = (items) => items.map((item) => oneLine(item.id)).join(", ");

// The one item named `name` in `items`, or null. Several items with that name: a CliError listing their ids.
// `where` finishes the sentence ("in this workspace", "among your companies").
export function uniqueByName(items, name, kind, where = "in this workspace") {
  const matches = items.filter((item) => item.name === name);
  if (matches.length > 1) {
    throw new CliError(
      `The ${kind} name ${JSON.stringify(name)} is ambiguous ${where} (ids: ${idList(matches)}). Use the id.`,
    );
  }
  return matches[0] ?? null;
}

// The item whose id is `ref`, else the one item named `ref`. No match: a CliError.
export function resolveByIdOrName(
  items,
  ref,
  kind,
  where = "in this workspace",
) {
  const byId = items.find((item) => item.id === ref);
  if (byId) return byId;
  const byName = uniqueByName(items, ref, kind, where);
  if (byName) return byName;
  throw new CliError(
    `No ${kind} with the id or name ${JSON.stringify(ref)} ${where}.${nearMatchHint(items, ref)}`,
  );
}

// Names match exactly; when only the case differs, say which items were probably meant.
export function nearMatchHint(items, ref) {
  const lower = String(ref).toLowerCase();
  const near = items.filter((item) => item.name?.toLowerCase?.() === lower);
  if (near.length === 0) return "";
  const list = near
    .map(
      (item) =>
        `${JSON.stringify(oneLine(item.name))} (id: ${oneLine(item.id)})`,
    )
    .join(", ");
  return ` Names are case-sensitive: did you mean ${list}?`;
}

// Refuse a new item whose name is already taken in the workspace.
export function assertNameFree(items, name, kind) {
  const matches = items.filter((item) => item.name === name);
  if (matches.length > 0) {
    throw new CliError(
      `A ${kind} named ${JSON.stringify(name)} already exists in this workspace (${matches.length > 1 ? "ids" : "id"}: ${idList(matches)}). Names are unique per workspace.`,
    );
  }
}
