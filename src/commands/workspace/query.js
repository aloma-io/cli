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
