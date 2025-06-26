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
      task_notification_groups
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

export const SAVE_WORKSPACE_MUTATION = `
  mutation (
    $id: ID!
    $name: NonEmptyString!
    $tags: [String!]!
    $health_enabled: Boolean!
    $task_notification_groups: [String]
  ) {
    saveAutomationEnvironment(
      id: $id
      name: $name
      tags: $tags
      health_enabled: $health_enabled
      task_notification_groups: $task_notification_groups
    )
  }
`;

export const ARCHIVE_WORKSPACE_MUTATION = `
  mutation ($id: ID!, $archive: Boolean!) {
    archiveAutomationEnvironment(id: $id, archive: $archive)
  }
`;

export const DELETE_WORKSPACE_MUTATION = `
  mutation ($id: ID!, $delete: Boolean!, $deletionDays: Int) {
    deleteAutomationEnvironment(id: $id, delete: $delete, deletionDays: $deletionDays)
  }
`;

export const GET_SOURCE_QUERY = `
  query ($id: ID!) {
    getAutomationEnvironment(id: $id) {
      id
      name
      archived
      deleting
      deleting_at
      source {
        username
        has_apikey
        url
        branch
        enabled
        last_source_sync
        last_source_sync_errors
        source_automatic
        source_do_sync
      }
    }
  }
`;

export const SAVE_SOURCE_MUTATION = `
  mutation (
    $id: ID!
    $url: String
    $username: String
    $apikey: String
    $branch: String
    $enabled: Boolean
    $source_automatic: Boolean
    $source_do_sync: Boolean
  ) {
    saveAutomationEnvironmentSource(
      id: $id
      url: $url
      username: $username
      apikey: $apikey
      branch: $branch
      enabled: $enabled
      source_automatic: $source_automatic
      source_do_sync: $source_do_sync
    )
  }
`;
