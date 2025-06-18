export const CREATE_TASK_MUTATION = `
  mutation ($name: NonEmptyString!, $content: JSON!, $environment_id: NonEmptyString!) {
    createAutomationTask(name: $name, environment_id: $environment_id, content: $content)
  }
`;

export const LIST_TASKS_QUERY = `
  query ($id: ID!, $state: String, $name: String, $offset: Int, $limit: Int, $qualityBelow: Float) {
    listAutomationEnvironmentTasks(
      id: $id
      state: $state
      name: $name
      offset: $offset
      limit: $limit
      qualityBelow: $qualityBelow
    ) {
      id
      environment_id
      createdAt
      updatedAt
      name
      duration
      state
      steps
      created
      scheduled
      tags
      test_success
      test_fail
      test_percentage
      test_count
      realm
      subtasks {
        name
        id
        updatedAt
        createdAt
        created
        state
        duration
        tags
        steps
      }
    }
  }
`;

export const GET_TASK_QUERY = `
  query ($id: ID!) {
    getAutomationEnvironmentTask(id: $id) {
      id
      environment_id
      createdAt
      updatedAt
      steps
      name
      state
      duration
      tags
      content
      test_success
      test_fail
      test_percentage
      test_count
      realm
      source {
        id
        name
        type
        state
      }
    }

    getAutomationEnvironmentTaskHistory(id: $id) {
      id
      createdAt
      updatedAt
      name
      state
      task_id
      event
      error
      v
      context
      rule
      num
    }
  }
`;

export const CLONE_TASK_MUTATION = `
  mutation ($id: ID!) {
    createAutomationTaskFromTask(id: $id)
  }
`;

export const RESUME_TASK_MUTATION = `
  mutation ($id: ID!) {
    resumeAutomationTaskFromHistory(id: $id)
  }
`;

export const STOP_TASK_MUTATION = `
  mutation ($id: ID!) {
    stopAutomationTask(id: $id)
  }
`;