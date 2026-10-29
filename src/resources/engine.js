// One pull, one sync and one ensure for every kind that has a descriptor (PLAT-118): steps and libraries.
// A descriptor ({kind, list, get, create, save, filePath, render, parse, key, ...}) says how; this file says what.
import { isDeepStrictEqual } from "util";
import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import { CliError, failure } from "../runtime.js";
import { uniqueByName, resolveByIdOrName, nameKey } from "../names.js";
import { oneLine, UnsafeNameError } from "../pull-safety.js";
import { confirm } from "../confirm.js";
import { walkJsFiles } from "../walk.js";

// Save, and treat a save the API refuses as a failure.
async function saveOrFail(desc, vars) {
  if (!(await desc.save(vars))) {
    throw new CliError(`Failed to save ${desc.kind}: ${vars.name}`);
  }
}

// Bring a stored item to the desired fields: saved only when that changes what would be sent.
async function apply(desc, current, desired, dryRun) {
  const next = desc.saveVars(current, desired);
  if (isDeepStrictEqual(next, desc.saveVars(current))) return "unchanged";
  if (!dryRun) await saveOrFail(desc, next);
  return "updated";
}

// The desired state of one item: `{name, file?, ...fields}`. Found by key among `items` (listed when not
// given; none when there is no workspace yet), created if absent, saved only if different. Never throws:
// returns {kind, name, status, action, id?, error?} with status created / updated / unchanged / refused / failed.
// With dryRun, reads only: nothing is created or saved.
export async function ensure(
  desc,
  workspaceId,
  desired,
  { dryRun = false, items } = {},
) {
  const name = desired.name;
  const result = (status, extra = {}) => ({
    kind: desc.kind,
    name,
    status,
    ...extra,
  });
  let existing;
  try {
    const all = items ?? (workspaceId ? await desc.list(workspaceId) : []);
    try {
      existing = uniqueByName(all, desc.key(desired), desc.kind);
    } catch (error) {
      return result("refused", { error, action: "match" });
    }
  } catch (error) {
    return result("failed", { error, action: "match" });
  }

  const action = existing ? "update" : "create";
  try {
    const want = desired.file
      ? { ...desired, ...(await desc.parse(desired.file)) }
      : desired;
    if (!existing) {
      if (dryRun) return result("created", { action });
      const id = await desc.create(name, workspaceId, want);
      if (desc.saveAfterCreate(want)) {
        await saveOrFail(desc, desc.saveVars(desc.blank(id, name), want));
      }
      return result("created", { action, id });
    }
    const current = await desc.get(existing.id);
    if (!current) {
      throw new CliError(`${desc.title} with ID ${existing.id} not found.`);
    }
    const status = await apply(desc, current, want, dryRun);
    return result(status, { action, id: existing.id });
  } catch (error) {
    return result("failed", { error, action });
  }
}

// One line for an item that was refused or failed.
export function describeFailure(desc, item) {
  if (item.status === "refused") return item.error.message;
  const verb = item.action === "create" ? "creating" : "updating";
  return `Error ${verb} ${desc.kind}: ${item.name}: ${item.error?.message ?? item.error}`;
}

async function assertFolder(folder) {
  try {
    await fs.access(folder);
  } catch (error) {
    throw new CliError(`Workspace folder not found: ${folder}`);
  }
}

// Every .js file under `folder` as an item named by its relative path (without .js, "/" separated).
export async function folderEntries(folder) {
  await assertFolder(folder);
  return (await walkJsFiles(folder)).map(({ absPath, relPath }) => ({
    name: relPath.replace(/\\/g, "/").replace(/\.js$/, ""),
    file: absPath,
  }));
}

// Ensure every file under `folder` against one listing of the workspace.
export async function ensureFolder(
  desc,
  workspaceId,
  folder,
  { dryRun = false } = {},
) {
  const entries = await folderEntries(folder);
  const items = workspaceId ? await desc.list(workspaceId) : [];
  const results = [];
  for (const entry of entries) {
    results.push(await ensure(desc, workspaceId, entry, { dryRun, items }));
  }
  return results;
}

// `pull`: write one item (by id or name) or every item of the workspace to files under `folder`.
export async function pull(desc, workspaceId, ref, targetPath) {
  const folder = targetPath || process.cwd();
  try {
    await fs.mkdir(folder, { recursive: true });

    if (ref) {
      const id = resolveByIdOrName(
        await desc.list(workspaceId),
        ref,
        desc.kind,
      ).id;
      const item = await desc.get(id);
      if (!item) {
        throw new CliError(`${desc.title} with ID ${id} not found.`);
      }
      await writeItemFile(desc, item, folder);
      console.log(
        chalk.green(`Successfully pulled ${desc.kind}: ${item.name}`),
      );
      return;
    }

    const items = await desc.list(workspaceId);
    if (items.length === 0) {
      console.log(chalk.yellow(`No ${desc.plural} found in workspace.`));
      return;
    }

    // Get full details for each item; a name several items share is refused (it names one file)
    const ambiguous = new Set();
    for (const summary of items) {
      try {
        uniqueByName(items, summary.name, desc.kind);
      } catch (error) {
        if (!ambiguous.has(nameKey(summary.name))) {
          ambiguous.add(nameKey(summary.name));
          console.error(chalk.red(error.message));
        }
        continue;
      }
      const item = await desc.get(summary.id);
      if (item) {
        try {
          await writeItemFile(desc, item, folder);
        } catch (error) {
          if (!(error instanceof UnsafeNameError)) throw error;
          console.log(
            chalk.yellow(
              `Skipped ${desc.kind} ${oneLine(item.id)}: unsafe name ${JSON.stringify(item.name)}`,
            ),
          );
        }
      }
    }

    if (ambiguous.size > 0) {
      throw new CliError(
        `${desc.titlePlural} with ${ambiguous.size} ambiguous name(s) were not pulled to: ${folder}`,
      );
    }
    console.log(
      chalk.green(
        `Successfully pulled ${items.length} ${desc.plural} to: ${folder}`,
      ),
    );
  } catch (error) {
    throw failure(`Error pulling ${desc.plural}:`, error);
  }
}

// A name with slashes becomes subfolders, always inside `folder` (see pull-safety.js)
async function writeItemFile(desc, item, folder) {
  const filePath = desc.filePath(item.name, folder);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, desc.render(item), "utf8");
}

const counts = (results, status) =>
  results.filter((r) => r.status === status).length;

// `sync`: bring one item (by id or name) or every file under `sourcePath` into the workspace, after a y/N prompt.
export async function sync(desc, workspaceId, ref, sourcePath, noPrompt) {
  const folder = sourcePath || process.cwd();
  try {
    await assertFolder(folder);
    if (ref) {
      await syncOne(desc, workspaceId, ref, folder, noPrompt);
      return;
    }

    const items = await desc.list(workspaceId);
    const entries = await folderEntries(folder);
    if (entries.length === 0) {
      console.log(
        chalk.yellow(`No .js ${desc.kind} files found in workspace folder.`),
      );
      return;
    }
    if (
      !noPrompt &&
      !(await confirm(
        `Are you sure you want to overwrite ${desc.plural} in the workspace with the contents of ${entries.length} file(s) from '${folder}'? (y/N): `,
      ))
    ) {
      throw new CliError("Sync cancelled by user.");
    }

    const results = [];
    for (const entry of entries) {
      const result = await ensure(desc, workspaceId, entry, { items });
      if (result.error) console.error(chalk.red(describeFailure(desc, result)));
      results.push(result);
    }
    const unchanged = counts(results, "unchanged");
    const tally = `Updated: ${counts(results, "updated")}, Created: ${counts(results, "created")}${unchanged > 0 ? `, Unchanged: ${unchanged}` : ""}`;
    const failed = results.filter((r) => r.error).length;
    if (failed > 0) {
      throw new CliError(
        `${desc.title} sync from ${folder} failed for ${failed} file(s)\n${tally}, Failed: ${failed}`,
      );
    }
    console.log(
      chalk.green(
        `Successfully synced ${desc.plural} from: ${folder}\n${tally}`,
      ),
    );
  } catch (error) {
    throw failure(`Error syncing ${desc.plural}:`, error);
  }
}

async function syncOne(desc, workspaceId, ref, folder, noPrompt) {
  const id = resolveByIdOrName(await desc.list(workspaceId), ref, desc.kind).id;
  const item = await desc.get(id);
  if (!item) {
    throw new CliError(`${desc.title} with ID ${id} not found.`);
  }

  // If the name contains slashes, the file is in subfolders accordingly; the name comes from the server,
  // so it is checked with the same containment as pull (an unsafe name throws, nothing is read)
  desc.filePath(item.name, folder);
  const segments = item.name.split("/");
  const filePath = path.join(
    folder,
    ...segments.slice(0, -1),
    `${segments[segments.length - 1]}.js`,
  );
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new CliError(`${desc.title} file not found: ${filePath}`);
  }

  if (
    !noPrompt &&
    !(await confirm(
      `Are you sure you want to overwrite the ${desc.kind} '${item.name}' with the contents of '${filePath}'? (y/N): `,
    ))
  ) {
    throw new CliError("Sync cancelled by user.");
  }
  let status;
  try {
    status = await apply(desc, item, await desc.parse(filePath), false);
  } catch (error) {
    throw failure(`Error updating ${desc.kind}: ${item.name}:`, error);
  }
  if (status === "unchanged") {
    console.log(chalk.green(`${desc.title} ${item.name} is unchanged.`));
  } else {
    console.log(chalk.green(`Successfully synced ${desc.kind}: ${item.name}`));
  }
}
