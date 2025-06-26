export const GET_SECRET_QUERY = `
  query ($id: ID!) {
    getAutomationEnvironmentConfig(id: $id)
  }
`;

export const SAVE_SECRET_MUTATION = `
  mutation ($environmentId: ID!, $values: JSON!) {
    saveAutomationEnvironmentConfig(id: $environmentId, values: $values)
  }
`;
