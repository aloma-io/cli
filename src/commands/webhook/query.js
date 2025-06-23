export const CREATE_WEBHOOK_MUTATION = `
  mutation ($name: String!, $environmentId: ID!) {
    createAutomationWebhook(name: $name, environmentId: $environmentId) {
      id
    }
  }
`;

export const LIST_WEBHOOKS_QUERY = `
  query ($id: ID!) {
    listAutomationWebhooks(id: $id) {
      id
      name
      key
      last_used_at
    }
  }
`;

export const REMOVE_WEBHOOK_MUTATION = `
  mutation ($id: ID!, $environmentId: ID!) {
    deleteAutomationWebhook(id: $id, environmentId: $environmentId)
  }
`;
