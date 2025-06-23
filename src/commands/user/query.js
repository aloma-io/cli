export const FIND_COMPANY_MEMBERS_QUERY = `
  {
    findCompanyMembers {
      id
      firstName
      lastName
      email
      groups
    }

    getCompanyInvitations {
      id
      email
      createdAt
    }
  }
`;

export const UPDATE_COMPANY_MEMBER_MUTATION = `
  mutation ($id: ID!, $groups: [String!], $removed: Boolean) {
    updateCompanyMember(id: $id, groups: $groups, removed: $removed)
  }
`;

export const INVITE_TO_COMPANY_MUTATION = `
  mutation ($emails: [EmailAddress!]!, $groups: [String!]) {
    inviteToCompany(emails: $emails, groups: $groups)
  }
`;
