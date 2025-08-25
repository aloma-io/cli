export const LIST_AUTOMATION_LIBS_QUERY = `
  query ($id: ID!, $name: String) {
    listAutomationLibs(id: $id, name: $name) {
      id
      createdAt
      updatedAt
      name
      namespace
      enabled
      tags
      version
    }
  }
`;

export const ADD_AUTOMATION_LIB_MUTATION = `
  mutation ($name: NonEmptyString!, $environment_id: NonEmptyString!) {
    createAutomationLib(name: $name, environment_id: $environment_id)
  }
`;

export const REMOVE_AUTOMATION_LIB_MUTATION = `
  mutation ($id: ID!, $environment_id: NonEmptyString!) {
    deleteAutomationLib(id: $id, environment_id: $environment_id)
  }
`;

export const UPDATE_AUTOMATION_LIB_MUTATION = `
  mutation ($id: ID!
    $name: NonEmptyString!
    $namespace: NonEmptyString!
    $content: String!
    $types: String
    $version: Int!
    $tags: [String!]!
    $enabled: Boolean!) {
    saveAutomationLib(
      id: $id
      name: $name
      namespace: $namespace
      content: $content
      types: $types
      version: $version
      tags: $tags
      enabled: $enabled
    )
  }
`;

export const GET_AUTOMATION_LIB_QUERY = `
  query ($id: ID!) {
    getAutomationLib(id: $id) {
      id
      name
      namespace
      enabled
      content
      tags
      version
      types
    }
  }
    `;
