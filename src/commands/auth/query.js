export const ME_QUERY = `
  query {
    me {
      id
      email
      groups
      firstName
      lastName
      termsAccepted
      realm {
        id
        name
        region
        groups
        deleting
        deleting_at
        domain
        billingPlan {
          key
          name
          description
          status
          blockedReason
          trial
        }
      }
      features
      realms {
        id
        name
        region
        groups
        domain
      }
    }
  }
`;
