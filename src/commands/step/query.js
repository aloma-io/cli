export const LIST_STEPS_QUERY = `
  query ($id: ID!, $name: String, $includeDisabled: Boolean) {
    listAutomationSteps(id: $id, name: $name, includeDisabled: $includeDisabled) {
      id
      createdAt
      updatedAt
      name
      enabled
      valid
      realm
      last_used_at
    }
  }
`;

export const CREATE_STEP_MUTATION = `
  mutation ($name: NonEmptyString!, $environment_id: NonEmptyString!, $nocode_type: String, $cloneFrom: String) {
    createAutomationStep(name: $name, environment_id: $environment_id, cloneFrom: $cloneFrom, nocode_type: $nocode_type)
  }
`;

export const GET_STEP_QUERY = `
  query ($id: ID!) {
    getAutomationStep(id: $id) {
      id
      name
      valid
      enabled
      content
      version
      nocode_type
      nocode_content
    }
  }
`;

export const SAVE_STEP_MUTATION = `
  mutation (
    $id: ID!
    $name: NonEmptyString!
    $if: String!
    $do: String
    $nocode_content: JSON
    $config_content: JSON
    $enabled: Boolean!
    $version: Int!
  ) {
    saveAutomationStep(
      id: $id
      name: $name
      if: $if
      do: $do
      nocode_content: $nocode_content
      config_content: $config_content
      enabled: $enabled
      version: $version
    )
  }
`;

export const DELETE_STEP_MUTATION = `
  mutation ($id: ID!, $environment_id: NonEmptyString!) {
    deleteAutomationStep(id: $id, environment_id: $environment_id)
  }
`;

export const VALIDATE_IF_QUERY = `
  query ($content: String) {
    validateAutomationIf(content: $content)
  }
`;

export const GENERATE_STEP_MUTATION = `
  mutation (
    $userInput: NonEmptyString!
    $environmentId: ID!
    $chatHistory: [ChatMessageInput!]
  ) {
    generateAutomationStep(
      userInput: $userInput
      environmentId: $environmentId
      chatHistory: $chatHistory
    ) {
      success
      step {
        id
        name
        description
        condition
        content
        chatMessage
      }
      explanation
      chatMessage
    }
  }
`;
