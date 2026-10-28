// One resolver for items that have an id and a name: steps, libraries (PLAT-115), and workspaces,
// companies and connectors (PLAT-116). The backend allows duplicate names, so the CLI never guesses.
// An exact id wins. Otherwise names match regardless of case (Patrick, 28 Oct): exactly one match is
// used, more than one is refused with the names and ids listed, and a reference that matches nothing is
// refused instead of being passed on as if it were an id.
import { CliError } from "./runtime.js";
import { oneLine } from "./pull-safety.js";

// Ids only when the matches share one spelling; with the name too when they differ in case.
const idList = (items) => {
  const spellings = new Set(items.map((item) => item.name));
  return items
    .map((item) =>
      spellings.size > 1
        ? `${oneLine(item.id)} ${JSON.stringify(oneLine(item.name))}`
        : oneLine(item.id),
    )
    .join(", ");
};

// The key two names are compared by: the same regardless of case.
export const nameKey = (name) => String(name).toLowerCase();

const named = (items, name) =>
  items.filter(
    (item) =>
      typeof item.name === "string" && nameKey(item.name) === nameKey(name),
  );

// The one item named `name` (any case) in `items`, or null. Several: a CliError listing their names and ids.
// `where` finishes the sentence ("in this workspace", "among your companies").
export function uniqueByName(items, name, kind, where = "in this workspace") {
  const matches = named(items, name);
  if (matches.length > 1) {
    throw new CliError(
      `The ${kind} name ${JSON.stringify(name)} is ambiguous ${where} (ids: ${idList(matches)}). Use the id.`,
    );
  }
  return matches[0] ?? null;
}

// The item whose id is `ref`, else the one item named `ref` in any case. No match: a CliError.
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
    `No ${kind} with the id or name ${JSON.stringify(ref)} ${where}.`,
  );
}

// Refuse a new item whose name (in any case) is already taken in the workspace.
export function assertNameFree(items, name, kind) {
  const matches = named(items, name);
  if (matches.length > 0) {
    throw new CliError(
      `A ${kind} named ${JSON.stringify(name)} already exists in this workspace (${matches.length > 1 ? "ids" : "id"}: ${idList(matches)}). Names are unique per workspace.`,
    );
  }
}
