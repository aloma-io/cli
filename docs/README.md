# aloma Package Documentation

This document outlines the structure and decisions for the `aloma` package. This package provides utilities and a CLI for interacting with Aloma services.

## Project Structure

- `/src/cli.js`: The entry point for the `aloma` command-line interface.
- `/src/commands/`: Directory containing all command implementations organized by feature:
  - `/auth/`: Authentication commands (login, logout)
  - `/workspace/`: Workspace management commands
  - `/company/`: Company management commands
  - `/step/`: Step management commands
  - `/task/`: Task management commands
  - `/webhook/`: Webhook management commands
  - `/connector/`: Connector management commands
  - `/user/`: User management commands
  - `/deploy/`: Deployment commands
- `/src/config.js`: Configuration settings for Keycloak, GraphQL, and other services.
- `/src/utils.js`: Shared utility functions.
- `/src/metrics.js`: Contains mock task data and functions to display formatted metrics tables in the console.
- `/src/logs.js`: Implements a log tailing system with random log generation for simulating real-time task logs.
- `/src/setup.js`: Implements project creation functionality for generating new Aloma automation projects.
- `/index.js`: The main entry point for using the package as a Node.js module.
- `/package.json`: NPM package configuration, including dependencies and CLI definition.
- `/examples/`: Directory containing example configurations and files:
  - `/deploy.yaml`: Example deployment configuration
  - `/step/`: Example step definitions
  - `/task/`: Example task configurations
  - `/connector/`: Example connector configurations
- `/docs/README.md`: This documentation file.
- `/tests/`: Directory containing test files.

## Files

- **src/cli.js**: Implements the command-line interface using `commander`. Defines all available commands organized by feature areas.
- **src/commands/**: Modular command implementations:
  - **auth/index.js**: Handles the OAuth 2.0 Authorization Code flow with PKCE using Keycloak.
  - **workspace/index.js**: Manages workspace operations (list, show, switch, add).
  - **company/index.js**: Manages company operations (list, switch, add).
  - **step/index.js**: Manages step operations (list, show, add, delete, edit, clone).
  - **task/index.js**: Manages task operations (list, log, new, clone, stop, resume).
  - **webhook/index.js**: Manages webhook operations (list, show, add, delete).
  - **connector/index.js**: Manages connector operations (list, show, add, delete, update, logs, oauth).
  - **user/index.js**: Manages user operations (list, invite, update, remove).
  - **deploy/index.js**: Handles deployment from YAML configuration files.
- **src/config.js**: Contains configuration for Keycloak authentication, GraphQL endpoints, and encryption keys.
- **src/metrics.js**: Contains mock task data and functions to display formatted metrics tables in the console.
- **src/logs.js**: Implements a log tailing system with random log generation for simulating real-time task logs.
- **src/setup.js**: Handles the creation of new Aloma automation projects with predefined structure and templates.
- **index.js**: Contains exported functions for programmatic use.
- **package.json**: Defines metadata, dependencies, the `bin` entry (`aloma`), and scripts.
- **examples/**: Contains example configurations and files for various Aloma features.

## CLI Usage

Running `aloma` with no arguments (or with `-h` or `--help`) displays the main help message.

### Authentication

#### `aloma auth` or `aloma login`

Initiates the browser-based OAuth 2.0 Authorization Code flow with Keycloak.
1. Starts a local server on `http://localhost:8989`.
2. Displays the authentication URL in the console and attempts to open your default browser automatically.
3. After successful login, Keycloak redirects back to the local server.
4. The server receives the authorization code, exchanges it for tokens.
5. The access token is stored securely using the system keychain with fallback to `~/.aloma/token`.
6. A success message is printed, and the local server shuts down.

#### `aloma logout`

Removes the stored Aloma token from both the system keychain and the fallback file.

### Workspace Management

#### `aloma workspace list`

Lists all automation workspaces available to the authenticated user.

#### `aloma workspace show`

Shows details of the current active workspace.

#### `aloma workspace switch <identifier>`

Switches to a different workspace by name or ID.

#### `aloma workspace add <name>`

Creates a new workspace with the specified name.

Options:
- `-t, --tags <tags>`: Comma-separated list of tags for the workspace

### Company Management

#### `aloma company list`

Lists all available companies.

#### `aloma company switch <identifier>`

Switches to a different company by name or ID.

#### `aloma company add <name>`

Creates a new company (admin only).

Options:
- `-e, --emails <emails>`: Comma-separated list of emails to invite

### Step Management

#### `aloma step list`

Lists all steps in the current workspace.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma step show <id>`

Shows detailed information about a specific step.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma step add <name>`

Adds a new step with the specified name.

Options:
- `-w, --workspace <id>`: Specify workspace ID
- `-t, --type <type>`: Step type
- `-f, --file <path>`: Path to file containing step condition and content

#### `aloma step delete <id>`

Deletes a step by ID.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma step edit <id>`

Opens an editor to modify a step.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma step clone <id>`

Creates a copy of an existing step.

Options:
- `-w, --workspace <id>`: Specify workspace ID

### Task Management

#### `aloma task list`

Lists all tasks in the current workspace.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma task log <id>`

Shows detailed logs for a specific task.

#### `aloma task new <name>`

Creates a new task with the specified name.

Options:
- `-w, --workspace <id>`: Specify workspace ID
- `-d, --data <json>`: JSON data to send with the task
- `-f, --file <path>`: Path to JSON file containing task data

#### `aloma task clone <id>`

Creates a copy of an existing task.

#### `aloma task stop <id>`

Stops a running task.

#### `aloma task resume <id>`

Resumes a stopped task.

### Webhook Management

#### `aloma webhook list`

Lists all webhooks in the current workspace.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma webhook show <id>`

Shows detailed information about a specific webhook.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma webhook add <name>`

Adds a new webhook with the specified name.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma webhook delete <id>`

Deletes a webhook by ID.

Options:
- `-w, --workspace <id>`: Specify workspace ID

### Connector Management

#### `aloma connector list`

Lists all connectors in the current workspace.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma connector list-available`

Lists all available connector types and their configurations.

Options:
- `-f, --filter-name <name>`: Filter connectors by name

#### `aloma connector show <id>`

Shows detailed information about a specific connector.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma connector add <connectorId>`

Adds a new connector.

Options:
- `-n, --name <name>`: Connector name
- `-ns, --namespace <namespace>`: Connector namespace
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma connector delete <id>`

Deletes a connector by ID.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma connector update <id>`

Updates a connector's configuration.

Options:
- `-w, --workspace <id>`: Specify workspace ID
- `-n, --name <name>`: Connector name
- `-ns, --namespace <namespace>`: Connector namespace
- `-t, --tags <tags>`: Comma-separated list of tags
- `-s, --shared`: Share connector in realm
- `-c, --config <json>`: JSON configuration for the connector
- `-f, --file <path>`: Path to JSON file containing connector configuration

#### `aloma connector logs <id>`

Views logs for a specific connector.

Options:
- `-w, --workspace <id>`: Specify workspace ID

#### `aloma connector oauth <id>`

Starts OAuth process for a connector.

Options:
- `-w, --workspace <id>`: Specify workspace ID
- `-d, --development`: Start OAuth in development mode

### User Management

#### `aloma user list`

Lists all users in the current company.

#### `aloma user invite <emails>`

Invites new users to the current company.

Options:
- `-r, --roles <roles>`: Comma-separated list of roles to invite the user with

#### `aloma user update <id>`

Updates a user's information.

Options:
- `-r, --roles <roles>`: Comma-separated list of roles to update the user with

#### `aloma user remove <id>`

Removes a user from the current company.

### Deployment

#### `aloma deploy <yamlPath>`

Deploys resources from a YAML configuration file.

The YAML file can define:
- Company to switch to
- Workspaces to create and configure
- Steps to create
- Tasks to create
- Webhooks to create

Example YAML structure:
```yaml
# Company to switch to (optional)
company: "testing"

# List of workspaces to create and configure
workspaces:
  - name: "production"
    tags: ["prod", "main"]
    
    # Steps configuration
    steps:
      - name: "template2"
        file: "examples/step/step1.js"
    
    # Tasks configuration
    tasks:
      - name: "template-task"
        data: {"cliStep": true, "Step": 1}
      - name: "template-task2"
        file: "examples/task/task1.json"

    # Webhooks configuration
    webhooks:
      - name: "data-update"
```

### Legacy Commands

The following commands from the original implementation are still available but may be deprecated:

#### `aloma status` or `aloma whoami`

Checks authentication status and displays task metrics.

Options:
- `-m, --metrics-only`: Display only metrics without checking authentication
- `-a, --auth-only`: Display only authentication status without metrics

#### `aloma metrics`

Displays task metrics and system overview.

#### `aloma logs [taskId]`

Displays and tails logs for tasks.

Options:
- `-i, --interval <ms>`: Set the interval between log entries in milliseconds (default: 1000ms)
- `-l, --limit <number>`: Limit the number of log entries to display (default: unlimited)
- `-f, --filter <level>`: Filter logs by level (INFO, DEBUG, WARN, ERROR, SUCCESS)

#### `aloma create <name>`

Creates a new Aloma automation project.

Options:
- `-d, --directory <path>`: Set a custom directory path for the project
- `-f, --force`: Overwrite existing directory if it already exists

## Configuration

The CLI uses the following configuration in `src/config.js`:

- **Keycloak Configuration**: OAuth 2.0 authentication settings
- **GraphQL Configuration**: API endpoint settings
- **Encryption Configuration**: Public key for token verification

## Dependencies

- **commander**: CLI framework
- **axios**: HTTP client for API requests
- **chalk**: Terminal colorization
- **cli-table3**: Formatted table display
- **jose**: JWT handling
- **js-yaml**: YAML file parsing
- **keytar**: Secure credential storage
- **open**: Browser opening
- **openid-client**: OAuth 2.0 client
- **ora**: Terminal spinners

## Examples

### Step Definition Example

```javascript
// examples/step/step1.js
export const condition = {
  "cliStep": true,
  "Step": 1
};

export const content = () => {
  console.log("running a cli updated step");
  const message = "This is a test message ";
  console.log(message);
  task.complete();
};
```

### Task Configuration Example

```json
// examples/task/task1.json
{
  "test": true
}
```

### Connector Configuration Example

```json
// examples/connector/connector-config.json
{
  "name": "My Custom Connector",
  "namespace": "custom",
  "tags": ["production", "api", "custom"],
  "shared_in_realm": false,
  "config": {
    "username": "userJJ",
    "password": "passwordJJ",
    "domain": "https://api.example.com"
  }
}
```

## Local Development Testing

1. Navigate to the `aloma-io` directory.
2. Run `npm run setup` to link the package globally.
3. Run commands like `aloma auth`, `aloma workspace list`, `aloma step list`.
4. To remove the link: `npm unlink aloma`.

## Decisions

- **Package Name**: `aloma`.
- **CLI Implementation**: Using `commander` with modular command structure.
- **Authentication Strategy**: OAuth 2.0 Authorization Code flow with PKCE via Keycloak.
- **Token Storage**: Using `keytar` with fallback to file storage.
- **Modularity**: Commands organized by feature in separate modules.
- **Configuration**: Centralized configuration in `config.js`.
- **Examples**: Comprehensive examples for all major features.
- **Deployment**: YAML-based deployment configuration for infrastructure as code. 