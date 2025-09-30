import { graphQuery } from "../../utils.js";
import {
  LIST_AVAILABLE_CONNECTOR_QUERY,
  LIST_CONNECTORS_QUERY,
  GET_CONNECTOR_QUERY,
  ADD_CONNECTOR_MUTATION,
  REMOVE_CONNECTOR_MUTATION,
  UPDATE_CONNECTOR_CONFIG_SCHEMA_MUTATION,
  UPDATE_CONNECTOR_MUTATION,
  GET_CONNECTOR_LOGS_QUERY,
  START_CONNECTOR_OAUTH_MUTATION,
} from "./query.js";
import { doEncrypt } from "../../utils.js";
import chalk from "chalk";
import { resolveWorkspaceId } from "../workspace/index.js";
import fs from "fs/promises";
import open from "open";
import yaml from "js-yaml";
import path from "path";

export async function listAvailableConnectors(workspaceIdentifier, filterName) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;
    
    const data = await graphQuery(LIST_AVAILABLE_CONNECTOR_QUERY, {
      id: workspaceId,
      mine: false,
      name: filterName || "",
    });

    if (
      !data.listAutomationAvailableConnectors ||
      data.listAutomationAvailableConnectors.length === 0
    ) {
      console.log(chalk.yellow("No connectors found."));
      return;
    }

    console.log(chalk.blue("\nAvailable Connectors:"));
    data.listAutomationAvailableConnectors.forEach((connector) => {
      console.log(chalk.green(`\nID: ${connector.id}`));
      console.log(`Name: ${connector.name}`);
      console.log(`Added: ${connector.added}`);
      console.log(`On Premise: ${connector.on_premise}`);
      console.log(`In Cloud: ${connector.in_cloud}`);
      console.log(`Needs Storage: ${connector.needs_storage}`);
      console.log(`Expose Service: ${connector.expose_service}`);
    });
  } catch (error) {
    console.error(chalk.red("Error listing connectors:"), error.message);
    throw error;
  }
}

export async function getConnector(id, workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;
    
    const data = await graphQuery(GET_CONNECTOR_QUERY, {
      id: workspaceId,
      connectorId: id,
    });

    const connector = data.getAutomationConnector;
    console.log(chalk.blue("\nConnector Details:"));
    console.log(chalk.green(`\nID: ${connector.id}`));
    console.log(`Name: ${connector.name}`);
    console.log(`Namespace: ${connector.namespace}`);
    console.log(`Shared in Realm: ${connector.shared_in_realm}`);
    console.log(
      `Health: ${connector.health.healthy ? "Healthy" : "Unhealthy"}`,
    );

    const connector_schema = data.getAutomationConnectorConfigSchema;
    printConnectorSchema(connector_schema);
  } catch (error) {
    console.error(chalk.red("Error showing connector:"), error.message);
    throw error;
  }
}

function printConnectorSchema(schema) {
  // Print summary
  if (schema.summary) {
    console.log(chalk.bold("Summary"));
    console.log(schema.summary);
    console.log();
  }

  // Print description if present
  if (schema.description) {
    console.log(chalk.bold("Description"));
    console.log(schema.description);
    console.log();
  }

  // Print fields
  if (schema.fields && Object.keys(schema.fields).length > 0) {
    console.log(chalk.bold("Fields"));
    Object.entries(schema.fields).forEach(([key, field]) => {
      console.log(`  Key: ${key}`);
      console.log(`  Name: ${field.name}`);
      console.log(`  Value: ${field.placeholder || ""}`);
      console.log(`  Optional: ${field.optional ? "Yes" : "No"}`);
      console.log();
    });
  }
}

export async function addConnector(
  connectorId,
  workspaceIdentifier,
  name,
  namespace,
  tags,
  shared_in_realm,
  config,
  file,
) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    if (!connectorId) {
      console.log(chalk.yellow("⚠ Connector ID is required"));
      return;
    }

    let connectorName = name;
    let connectorNamespace = namespace;

    // If name is not provided, fetch it from the connector details
    if (!connectorName) {
      const connectorData = await graphQuery(GET_CONNECTOR_QUERY, {
        id: workspaceId,
        connectorId: connectorId,
      });

      if (!connectorData.getAutomationConnector) {
        console.log(chalk.red("Error: Connector not found"));
        return;
      }

      connectorName = connectorData.getAutomationConnector.name;
      connectorNamespace = connectorData.getAutomationConnector.namespace;
    }

    const response = await graphQuery(ADD_CONNECTOR_MUTATION, {
      id: connectorId,
      environmentId: workspaceId,
      name: connectorName,
      namespace: connectorNamespace,
    });

    if (response.addAutomationMarketConnectorToEnvironment) {
      console.log(chalk.green("\nConnector added successfully!"));

      // If additional configuration is provided, update the connector
      if (tags || shared_in_realm || config || file) {
        // Get the added connector's ID from the workspace
        const workspaceConnectors = await graphQuery(LIST_CONNECTORS_QUERY, {
          id: workspaceId,
        });
        const addedConnector =
          workspaceConnectors.listAutomationConnectors?.find(
            (c) => c.name === connectorName,
          );

        if (addedConnector) {
          await new Promise((resolve) => setTimeout(resolve, 10000));
          try {
            await updateConnector(
              addedConnector.id,
              workspaceId,
              null,
              null,
              tags,
              shared_in_realm,
              config,
              file,
            );
          } catch (error) {
            console.error(
              chalk.red("Error updating connector:"),
              error.message,
            );
          }
        }
      }
    } else {
      console.log(chalk.red("Error: Failed to add connector"));
    }
  } catch (error) {
    console.error(chalk.red("Error creating connector:"), error.message);
    throw error;
  }
}

export async function removeConnector(id, workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    await graphQuery(REMOVE_CONNECTOR_MUTATION, {
      id,
      environmentId: workspaceId,
    });
    console.log(chalk.green(`\nConnector ${id} deleted successfully!`));
  } catch (error) {
    console.error(chalk.red("Error deleting connector:"), error.message);
    throw error;
  }
}

export async function listConnectors(workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    const data = await graphQuery(LIST_CONNECTORS_QUERY, { id: workspaceId });

    if (
      !data.listAutomationConnectors ||
      data.listAutomationConnectors.length === 0
    ) {
      console.log(chalk.yellow("No available connector types found."));
      return;
    }

    console.log(chalk.blue("\nConnectors:"));
    data.listAutomationConnectors.forEach((connector) => {
      console.log(chalk.green(`\nID: ${connector.id}`));
      console.log(`Name: ${connector.name}`);
      console.log(`Shared in Realm: ${connector.shared_in_realm}`);
      console.log(`Namespace: ${connector.namespace}`);
      console.log(`Last Used At: ${connector.last_used_at}`);
      console.log(
        `Health: ${connector.health[0].healthy ? chalk.green("Healthy") : chalk.red("Unhealthy")}`,
      );
    });
  } catch (error) {
    console.error(
      chalk.red("Error listing available connectors:"),
      error.message,
    );
    throw error;
  }
}

export async function updateConnector(
  connectorId,
  workspaceIdentifier,
  name,
  namespace,
  tags,
  shared_in_realm,
  config,
  file,
) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    let connectorName = name;
    let connectorNamespace = namespace;
    let connectorTags = tags;
    let connectorSharedInRealm = shared_in_realm;
    let connectorConfig = config;

    if (!connectorId) {
      console.log(chalk.yellow("⚠ Connector ID is required"));
      return;
    }

    if (file) {
      const ext = path.extname(file).toLowerCase();
      let fileContent;
      if (ext === ".yaml" || ext === ".yml") {
        fileContent = yaml.load(await fs.readFile(file, "utf8"));
      } else {
        fileContent = JSON.parse(await fs.readFile(file, "utf8"));
      }
      // Set properties from file content
      connectorName = fileContent.name || connectorName;
      connectorNamespace = fileContent.namespace || connectorNamespace;
      connectorTags = fileContent.tags || connectorTags;
      connectorSharedInRealm =
        fileContent.shared_in_realm ?? connectorSharedInRealm;
      connectorConfig = fileContent.config || connectorConfig;
    }

    // Get the added connector's ID from the workspace
    const workspaceConnectors = await graphQuery(LIST_CONNECTORS_QUERY, {
      id: workspaceId,
    });
    const toUpdateConnector =
      workspaceConnectors.listAutomationConnectors?.find(
        (c) => c.id === connectorId,
      );
    let marketId = null;
    if (toUpdateConnector) {
      marketId = toUpdateConnector.marketId;
    }

    // Update connector basic info if any of these parameters are provided
    if (
      connectorName ||
      connectorNamespace ||
      connectorTags ||
      connectorSharedInRealm !== undefined
    ) {
      // If name is not provided, fetch it from the connector details
      if (!connectorName) {
        const connectorData = await graphQuery(GET_CONNECTOR_QUERY, {
          id: workspaceId,
          connectorId: connectorId,
        });

        if (!connectorData.getAutomationConnector) {
          console.log(chalk.red("Error: Connector not found"));
          return;
        }

        connectorName = connectorData.getAutomationConnector.name;
      }
      const response = await graphQuery(UPDATE_CONNECTOR_MUTATION, {
        connectorId,
        name: connectorName,
        namespace: connectorNamespace || "",
        tags: connectorTags || [],
        shared_in_realm: connectorSharedInRealm,
      });

      if (response.updateAutomationConnector) {
        console.log(chalk.green("\nConnector updated successfully!"));
      } else {
        console.log(chalk.red("Error: Failed to update connector"));
        return;
      }
    }

    // Update connector config if provided
    if (connectorConfig) {
      const items = {};
      const keys = Object.keys(connectorConfig);
      const connectorData = await graphQuery(GET_CONNECTOR_QUERY, {
        id: workspaceId,
        connectorId,
      });
      const connectorKey = connectorData.getAutomationConnectorPublicKey;
      const schema = connectorData.getAutomationConnectorConfigSchema;
      for (var i = 0; i < keys.length; ++i) {
        const key = keys[i];

        if (schema.fields[key].plain) {
          // @ts-ignore
          items[key] = connectorConfig[key];
        } else {
          // @ts-ignore
          items[key] = await doEncrypt({
            value: connectorConfig[key],
            audience: marketId,
            pubKey: connectorKey,
          });
        }
      }
      const response = await graphQuery(
        UPDATE_CONNECTOR_CONFIG_SCHEMA_MUTATION,
        {
          environmentId: workspaceId,
          connectorId,
          content: items,
        },
      );

      if (response.updateAutomationConnectorConfigSchema) {
        console.log(
          chalk.green("\nConnector configuration updated successfully!"),
        );
      } else {
        console.log(
          chalk.red("Error: Failed to update connector configuration"),
        );
      }
    }
  } catch (error) {
    console.error(chalk.red("Error updating connector:"), error.message);
    throw error;
  }
}

export async function getConnectorLogs(id, workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    if (!id) {
      console.log(chalk.yellow("⚠ Connector ID is required"));
      return;
    }

    const data = await graphQuery(GET_CONNECTOR_LOGS_QUERY, {
      environmentId: workspaceId,
      connectorId: id,
    });

    if (!data.getAutomationConnectorLogs) {
      console.log(chalk.yellow("No logs found for this connector."));
      return;
    }

    console.log(chalk.blue("\nConnector Logs:"));
    console.log(data.getAutomationConnectorLogs);
  } catch (error) {
    console.error(chalk.red("Error getting connector logs:"), error.message);
    throw error;
  }
}

export async function startConnectorOAuth(
  id,
  workspaceIdentifier,
  isDevelopment = false,
) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    if (!id) {
      console.log(chalk.yellow("⚠ Connector ID is required"));
      return;
    }

    const response = await graphQuery(START_CONNECTOR_OAUTH_MUTATION, {
      environmentConnectorId: id,
      environmentId: workspaceId,
      isDevelopment,
    });

    if (response.startAutomationConnectorOAuth) {
      console.log(chalk.green("\nOAuth process started successfully!"));

      // Parse the OAuth URL
      const oauthUrl = new URL(response.startAutomationConnectorOAuth);

      try {
        await open(oauthUrl.toString());
      } catch (error) {
        console.log(
          chalk.yellow(
            "\nCould not open browser automatically. Please open this URL manually:",
          ),
        );
        console.log(oauthUrl.toString());
      }
    } else {
      console.log(chalk.red("Error: Failed to start OAuth process"));
    }
  } catch (error) {
    console.error(chalk.red("Error starting OAuth process:"), error);
  }
}

export async function getConnectorByName(connectorName, workspaceIdentifier) {
  try {
    const workspaceId = await resolveWorkspaceId(workspaceIdentifier);
    if (!workspaceId) return;

    if (!connectorName) {
      console.log(chalk.yellow("⚠ Connector name is required"));
      return null;
    }

    const data = await graphQuery(LIST_AVAILABLE_CONNECTOR_QUERY, {
      id: workspaceId,
      mine: false,
      name: connectorName,
    });

    if (
      !data.listAutomationAvailableConnectors ||
      data.listAutomationAvailableConnectors.length === 0
    ) {
      return null;
    }

    // Try to find exact match
    const found = data.listAutomationAvailableConnectors.find(
      (c) => c.name === connectorName,
    );
    if (found) {
      return {
        id: found.id,
        name: found.name,
        namespace: found.namespace,
      };
    } else {
      console.log(
        chalk.yellow(
          `Connector with name '${connectorName}' not found in available connectors.`,
        ),
      );
      return null;
    }
  } catch (error) {
    console.error(chalk.red("Error getting connector by name:"), error.message);
    throw error;
  }
}
