export const LIST_ENVIRONMENTS_QUERY = `
  query {
    listAutomationEnvironmentWithStats {
      id
      name
      tags
      type
      connectors
      engines
      webhooks
      tasks
      tasks7
      tasks30
      rate7
      rate30
      steps
      steps7
      steps30
      health
      testPercentage7
      metrics7
      metrics30
      lastHourCreated
      lastHourError
      lastHourIncomplete
      connectorIssues
    }
  }
`;

export const LIST_WORKSPACES_QUERY = `
  query {
    listAutomationEnvironmentWithStats {
      id
      name
      type
      health
    }
  }
`;

export const CREATE_WORKSPACE_MUTATION = `
  mutation ($name: String!, $tags: [String!], $type: String) {
    createAutomationEnvironment(name: $name, tags: $tags, type: $type) {
      id
    }
  }
`;

export const GET_WORKSPACE_QUERY = `
  query ($id: ID!) {
    getAutomationEnvironment(id: $id) {
      id
      name
      tags
      type
      autoclean
      clean_interval
      archived
      deleting
      deleting_at
      health_enabled
    }
  }
`;

export const GET_WORKSPACE_STATS_QUERY = `
  query ($id: ID!) {
    getAutomationEnvironmentWithStats(id: $id) {
      id
      name
      tags
      type
      connectors
      engines
      webhooks
      tasks
      tasks7
      tasks30
      rate7
      rate30
      steps
      steps7
      steps30
      testPercentage7
      health
      connectorIssues
    }
  }
`;
