// The CLI's context for one invocation (PLAT-116): who is signed in (`me`), the current company and
// its region, the selected workspace, and the one way to turn a company, workspace or connector
// reference into an item. References follow the one rule in src/names.js: an exact id, then a name in any
// case (Patrick, 28 Oct); ambiguity and no match are refused, and a name is never sent on as if it were an id.
import chalk from "chalk";
import { graphQuery, getSessionData, updateSessionData } from "./utils.js";
import { ME_QUERY } from "./commands/auth/query.js";
import {
  LIST_ENVIRONMENTS_QUERY,
  LIST_WORKSPACES_QUERY,
  CREATE_GETTING_STARTED_MUTATION,
} from "./commands/workspace/query.js";
import { LIST_AVAILABLE_CONNECTOR_QUERY } from "./commands/connector/query.js";
import { CliError, UsageError, failure } from "./runtime.js";
import { resolveByIdOrName, uniqueByName } from "./names.js";

// `me` is fetched once per session token; a failed fetch is not kept.
let mePromise = null;

export function getMe() {
  if (!mePromise) {
    const pending = graphQuery(ME_QUERY).then((data) => data?.me ?? null);
    pending.catch(() => {
      if (mePromise === pending) mePromise = null;
    });
    mePromise = pending;
  }
  return mePromise;
}

// The session token changed (company switch): the next getMe() asks the API again.
export function forgetMe() {
  mePromise = null;
}

export async function currentCompany() {
  return (await getMe())?.realm ?? null;
}

export async function listCompanies() {
  return (await getMe())?.realms ?? [];
}

export async function currentRegion() {
  return (await currentCompany())?.region ?? null;
}

// `url` on the current company's region host, e.g. https://eu.connect.aloma.io/...
export async function urlForRegion(url) {
  const region = await currentRegion();
  if (region && !url.startsWith(`https://${region}.`)) {
    url = url.replace(/https:\/\//, `https://${region}.`);
  }
  return url;
}

// The company (realm) whose id or name is `ref`.
export async function resolveCompany(ref) {
  const realms = await listCompanies();
  if (realms.length === 0) {
    throw new CliError("No companies found.");
  }
  return resolveByIdOrName(realms, ref, "company", "among your companies");
}

// The selected workspace id, read from the session file once.
let selectedWorkspaceId = null;

export async function saveSelectedWorkspace(workspaceId) {
  try {
    await updateSessionData("selectedWorkspace", workspaceId);
    selectedWorkspaceId = workspaceId;
    return true;
  } catch (error) {
    throw failure("Failed to save workspace selection:", error);
  }
}

export async function getSelectedWorkspace() {
  if (selectedWorkspaceId) {
    return selectedWorkspaceId;
  }

  try {
    const selectedWorkspace = await getSessionData("selectedWorkspace");
    selectedWorkspaceId = selectedWorkspace;
    return selectedWorkspace;
  } catch (error) {
    throw failure("Failed to read workspace selection:", error);
  }
}

// The workspace whose id or name is `ref` in an already fetched list.
export function pickWorkspace(workspaces, ref) {
  return resolveByIdOrName(
    workspaces,
    ref,
    "workspace",
    "among your workspaces",
  );
}

// A workspace reference is a name or id (looked up), `{ id }` (already known, e.g. --workspace-id:
// no lookup), or nothing (the selected workspace). Returns `{ id, name }`; name is null when not looked up.
export async function resolveWorkspace(ref) {
  if (ref && typeof ref === "object") {
    return { id: ref.id, name: ref.name ?? null };
  }
  if (!ref) {
    const id = await getSelectedWorkspace();
    if (!id) {
      throw new CliError(
        "No workspace selected. Use `aloma workspace switch` to select one.",
      );
    }
    return { id, name: null };
  }
  const data = await graphQuery(LIST_ENVIRONMENTS_QUERY);
  return pickWorkspace(data?.listAutomationEnvironmentWithStats ?? [], ref);
}

export async function resolveWorkspaceId(ref) {
  return (await resolveWorkspace(ref)).id;
}

// For deploy: the one workspace with this name in any case, or null when there is none (it is then
// created). Several (case included) are refused rather than guessed.
export async function findWorkspaceByName(name) {
  const data = await graphQuery(LIST_ENVIRONMENTS_QUERY);
  return uniqueByName(
    data?.listAutomationEnvironmentWithStats ?? [],
    name,
    "workspace",
    "among your workspaces",
  );
}

// The command-line form: `-w <name or id>` or `--workspace-id <id>`, at most one of them.
export function workspaceRef(name, workspaceId) {
  if (name && workspaceId) {
    throw new UsageError(
      "Give either a workspace name or --workspace-id, not both.",
    );
  }
  return workspaceId ? { id: workspaceId } : name;
}

// After sign-in or a company switch: select the first workspace, creating a getting-started one if there is none.
export async function selectDefaultWorkspace() {
  let defaultWorkspace = null;
  const data = await graphQuery(LIST_WORKSPACES_QUERY);
  const workspaces = data.listAutomationEnvironmentWithStats;

  if (!workspaces || workspaces.length === 0) {
    const dataCreated = await graphQuery(CREATE_GETTING_STARTED_MUTATION);
    if (dataCreated.createGettingStarted) {
      // List again to get the new workspace
      const data = await graphQuery(LIST_WORKSPACES_QUERY);
      defaultWorkspace = data.listAutomationEnvironmentWithStats[0];
    }
  } else {
    defaultWorkspace = workspaces[0];
  }

  if (defaultWorkspace) {
    await saveSelectedWorkspace(defaultWorkspace.id);
    console.log(
      chalk.green(`Switched to workspace [${defaultWorkspace.name}]`),
    );
  }
}

// The available connector (connector type) whose id or name is `ref`, for the workspace `workspace`.
export async function resolveConnector(ref, workspace) {
  const workspaceId = await resolveWorkspaceId(workspace);
  const data = await graphQuery(LIST_AVAILABLE_CONNECTOR_QUERY, {
    id: workspaceId,
    mine: false,
    name: ref,
  });
  return resolveByIdOrName(
    data?.listAutomationAvailableConnectors ?? [],
    ref,
    "connector",
    "among the available connectors",
  );
}
