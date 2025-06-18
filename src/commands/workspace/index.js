import chalk from 'chalk';
import { graphQuery, updateSessionData, getSessionData } from '../../utils.js';
import { LIST_ENVIRONMENTS_QUERY, CREATE_WORKSPACE_MUTATION, LIST_WORKSPACES_QUERY } from './query.js';

// Global variable to store the selected workspace ID
let selectedWorkspaceId = null;

// Save the selected workspace ID
export async function saveSelectedWorkspace(workspaceId) {
  try {
    await updateSessionData('selectedWorkspace', workspaceId);
    selectedWorkspaceId = workspaceId;
    return true;
  } catch (error) {
    console.error(chalk.red('Failed to save workspace selection:'), error.message);
    return false;
  }
}

// Get the selected workspace ID
export async function getSelectedWorkspace() {
  if (selectedWorkspaceId) {
    return selectedWorkspaceId;
  }

  try {
    const selectedWorkspace = await getSessionData('selectedWorkspace');
    selectedWorkspaceId = selectedWorkspace;
    return selectedWorkspace;
  } catch (error) {
    console.error(chalk.red('Failed to read workspace selection:'), error.message);
    return null;
  }
}
// switch workspace by name or id
export async function switchWorkspace(workspaceIdentifier) {
  try {
    if (!workspaceIdentifier) {
      console.log(chalk.yellow('⚠ Workspace identifier is required'));
      return;
    }
    const data = await graphQuery(LIST_WORKSPACES_QUERY);
    const workspaces = data.listAutomationEnvironmentWithStats;

    if (!workspaces || workspaces.length === 0) {
      console.log(chalk.yellow('No workspaces found.'));
      return;
    }

    // Try to find and switch to it
    const workspace = workspaces.find(
      (w) =>
        w.name.toLowerCase() === workspaceIdentifier.toLowerCase() || w.id === workspaceIdentifier
    );

    if (workspace) {
      await saveSelectedWorkspace(workspace.id);
      console.log(chalk.green(`Switched to workspace [${workspace.name}]`));
      return;
    } else {
      console.log(chalk.red(`Workspace '${workspaceIdentifier}' not found.`));
      return;
    }
  } catch (error) {
    console.error(chalk.red('Error fetching workspaces:'), error.message);
  }
}

export async function createWorkspace(name, tags) {
  let workspaceTag = null;

  if (tags) {
    workspaceTag = tags.split(',').map((tag) => tag.trim());
  }

  try {
    const data = await graphQuery(CREATE_WORKSPACE_MUTATION, {
      name: name.trim(),
      tags: workspaceTag,
    });

    const workspace = data.createAutomationEnvironment;
    console.log(chalk.green(`Created workspace [${name.trim()}]`));
    console.log(chalk.green(`ID: ${workspace.id}`));
    // Automatically switch to the new workspace
    await saveSelectedWorkspace(workspace.id);
    console.log(chalk.green(`Switched to workspace [${name.trim()}]`));
  } catch (error) {
    console.error(chalk.red('Error creating workspace:'), error.message);
  }
}

export async function listWorkspaces() {
  try {
    const data = await graphQuery(LIST_ENVIRONMENTS_QUERY);
    const environments = data.listAutomationEnvironmentWithStats;
    const currentWorkspaceId = await getSelectedWorkspace();

    if (!environments || environments.length === 0) {
      console.log(chalk.yellow('No environments found.'));
      return;
    }
    console.log(chalk.blue('\nAvailable workspaces:'));
    environments.forEach((env) => {
      const isCurrent = env.id === currentWorkspaceId;
      console.log(`${env.name} (ID:${env.id})${isCurrent ? ' [*]' : ''}`);
    });
  } catch (error) {
    console.error(chalk.red('Error fetching environments:'), error.message);
  }
}

export async function showWorkspace() {
  const workspaceId = await getSelectedWorkspace();
  if (workspaceId) {
    console.log(chalk.green(`Current workspace ID: ${workspaceId}`));
  } else {
    console.log(
      chalk.yellow('No workspace selected. Use `aloma workspace --switch` to select one.')
    );
  }
}

export async function getWorkspaceId(name) {
  const token = await getSessionData('token');
  if (!token) {
    console.log(chalk.yellow('⚠ Not authenticated: No token found. Run `aloma auth` to login.'));
    return;
  }

  const data = await graphQuery(LIST_ENVIRONMENTS_QUERY);
  const environments = data.listAutomationEnvironmentWithStats;

  const workspace = environments.find(
    (env) => env.name.toLowerCase() === name.toLowerCase() || env.id === name
  );

  return workspace ? workspace.id : null;
}