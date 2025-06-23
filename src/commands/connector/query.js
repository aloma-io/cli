export const LIST_AVAILABLE_CONNECTOR_QUERY = `
  query ($id: ID!, $mine: Boolean, $name: String) {
    listAutomationAvailableConnectors(id: $id, mine: $mine, name: $name) {
      id
      name
      added
      on_premise
      in_cloud
      needs_storage
      expose_service
      icon
    }
  }
`;

export const LIST_CONNECTORS_QUERY = `
  query ($id: ID!) {
    listAutomationConnectors(id: $id) {
      marketId
      id
      name
      version
      instances
      shared_in_realm
      environment_id
      namespace
      last_used_at
      icon
      health
    }
  }
`;

export const ADD_CONNECTOR_MUTATION = `
  mutation ($id: ID!, $environmentId: ID!, $name: String!, $namespace: String) {
    addAutomationMarketConnectorToEnvironment(
      id: $id
      environmentId: $environmentId
      name: $name
      namespace: $namespace
    )
  }
`;

export const REMOVE_CONNECTOR_MUTATION = `
  mutation ($id: ID!, $environmentId: ID!) {
    removeAutomationMarketConnectorFromEnvironment(id: $id, environmentId: $environmentId)
  }
`;

export const GET_CONNECTOR_QUERY = `
  query ($id: ID!, $connectorId: ID!) {
    getAutomationConnector(environmentId: $id, connectorId: $connectorId) {
      id
      name
      namespace
      tags
      managed
      image
      onPremiseImage
      shared_in_realm
      available_on_premise
      available_in_cloud
      icon
      expose_service
      health
      instances
    }
    getAutomationConnectorConfigSchema(environmentId: $id, connectorId: $connectorId)
  }
`;

export const UPDATE_CONNECTOR_CONFIG_SCHEMA_MUTATION = `
  mutation ($environmentId: ID!, $connectorId: ID!, $content: JSON!) {
    updateAutomationConnectorConfigSchema(environmentId: $environmentId, connectorId: $connectorId, content: $content)
  }
`;

export const UPDATE_CONNECTOR_DEPLOYMENT_MUTATION = `
  mutation ($environmentId: ID!, $connectorId: ID!, $type: String!) {
    updateAutomationConnectorDeployment(environmentId: $environmentId, connectorId: $connectorId, type: $type)
  }
`;

export const GET_CONNECTOR_KEY_MUTATION = `
  mutation ($environmentId: ID!, $connectorId: ID!) {
    getAutomationConnectorKey(environmentId: $environmentId, connectorId: $connectorId)
  }
`;

export const UPDATE_CONNECTOR_MUTATION = `
  mutation ($name: String!, $connectorId: ID!, $namespace: String!, $tags: [String!], $shared_in_realm: Boolean) {
    updateAutomationConnector(
      connectorId: $connectorId
      name: $name
      namespace: $namespace
      tags: $tags
      shared_in_realm: $shared_in_realm
    )
  }
`;

export const START_CONNECTOR_OAUTH_MUTATION = `
  mutation ($environmentConnectorId: String!, $environmentId: String!, $isDevelopment: Boolean) {
    startAutomationConnectorOAuth(
      environmentConnectorId: $environmentConnectorId
      environmentId: $environmentId
      isDevelopment: $isDevelopment
    )
  }
`;

export const GET_CONNECTOR_LOGS_QUERY = `
  query ($environmentId: ID!, $connectorId: ID!) {
    getAutomationConnectorLogs(connectorId: $connectorId, environmentId: $environmentId)
  }
`;

export const FINISH_CONNECTOR_OAUTH_MUTATION = `
  mutation (
    $environmentId: String!
    $environmentConnectorId: String!
    $code: String
    $isDevelopment: Boolean
    $params: JSON
  ) {
    finishAutomationConnectorOAuth(
      environmentId: $environmentId
      environmentConnectorId: $environmentConnectorId
      code: $code
      params: $params
      isDevelopment: $isDevelopment
    )
  }
`;
