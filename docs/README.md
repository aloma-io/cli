# Aloma CLI Documentation

This document provides comprehensive documentation for the `aloma` CLI package, including detailed command reference, examples, and advanced usage.

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
  - `/secret/`: Secret management commands
- `/src/config.js`: Configuration settings for Keycloak, GraphQL, and other services.
- `/src/utils.js`: Shared utility functions.
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

## Commands Overview

### Authentication
- `aloma auth` - Authenticate with Aloma via browser
- `aloma logout` - Clear stored session token

### Workspace Management
- `aloma workspace list` - List all automation workspaces
- `aloma workspace show` - Show current workspace details
- `aloma workspace switch <identifier>` - Switch to a different workspace
- `aloma workspace add <name>` - Create a new workspace
- `aloma workspace delete [workspace]` - Delete a workspace
- `aloma workspace archive [workspace]` - Archive/unarchive a workspace
- `aloma workspace update [workspace]` - Update workspace settings
- `aloma workspace source` - Edit source configuration
- `aloma workspace sync` - Trigger source sync

### Company Management
- `aloma company list` - List all available companies
- `aloma company switch <identifier>` - Switch to a different company
- `aloma company add <name>` - Create a new company (admin only)

### Step Management
- `aloma step list` - List all steps
- `aloma step show <id>` - Show step details
- `aloma step add <name>` - Add a new step
- `aloma step delete <id>` - Delete a step
- `aloma step edit <id>` - Edit a step
- `aloma step clone <id>` - Clone a step
- `aloma step pull` - Pull steps from workspace to local files
- `aloma step sync` - Sync local step files to workspace

### Task Management
- `aloma task list` - List all tasks
- `aloma task log <id>` - Show task details and logs
- `aloma task new <name>` - Create a new task
- `aloma task clone <id>` - Clone a task
- `aloma task stop <id>` - Stop a running task
- `aloma task resume <id>` - Resume a stopped task

### Webhook Management
- `aloma webhook list` - List all webhooks
- `aloma webhook show <id>` - Show webhook details
- `aloma webhook add <name>` - Add a new webhook
- `aloma webhook delete <id>` - Delete a webhook

### Secret Management
- `aloma secret list` - List all secrets
- `aloma secret add <name> <value>` - Add a new secret
- `aloma secret delete <name>` - Delete a secret

### Connector Management
- `aloma connector list` - List all connectors
- `aloma connector list-available` - List available connector types
- `aloma connector show <id>` - Show connector details
- `aloma connector add <connectorId>` - Add a new connector
- `aloma connector delete <id>` - Delete a connector
- `aloma connector update <id>` - Update a connector
- `aloma connector logs <id>` - View connector logs
- `aloma connector oauth <id>` - Start OAuth process for a connector

### User Management
- `aloma user list` - List all users in the current company
- `aloma user invite <emails>` - Invite new users to the company
- `aloma user update <id>` - Update a user
- `aloma user remove <id>` - Remove a user from the company

### Deployment
- `aloma deploy <yamlPath>` - Deploy resources from YAML configuration

### Setup
- `aloma setup` - Setup Aloma CLI configuration

## Detailed Command Reference

### Authentication

#### `aloma auth` or `aloma login`
Initiates the browser-based OAuth 2.0 Authorization Code flow with Keycloak.
1. Starts a local server on `http://localhost:8989`
2. Displays the authentication URL in the console and attempts to open your default browser
3. After successful login, Keycloak redirects back to the local server
4. The server receives the authorization code, exchanges it for tokens
5. The access token is stored securely using the system keychain with fallback to `~/.aloma/token`
6. A success message is printed, and the local server shuts down

#### `aloma logout`
Removes the stored Aloma token from both the system keychain and the fallback file.

### Workspace Management

#### `aloma workspace list`
Lists all automation workspaces available to the authenticated user.

Options:
- `-f, --filter-name <name>` - Filter workspaces by name
- `-t, --tags <tags>` - Comma-separated list of tags for the workspace
- `-a, --archived` - Show archived workspaces

#### `aloma workspace show`
Shows details of the current active workspace.

Options:
- `-s, --stats` - Show workspace stats
- `-sc, --source` - Show source config
- `-w, --workspace <id>` - Workspace ID

#### `aloma workspace switch <identifier>`
Switches to a different workspace by name or ID.

#### `aloma workspace add <name>`
Creates a new workspace with the specified name.

Options:
- `-t, --tags <tags>` - Comma-separated list of tags for the workspace

#### `aloma workspace delete [workspace]`
Deletes a workspace or cancels deletion.

Options:
- `-c, --cancel` - Cancel workspace deletion
- `-d, --days <days>` - Days until permanent deletion (default: 30)

#### `aloma workspace archive [workspace]`
Archives or unarchives a workspace.

Options:
- `-u, --unarchive` - Unarchive workspace

#### `aloma workspace update [workspace]`
Updates workspace settings.

Options:
- `-n, --name <name>` - New workspace name
- `-t, --tags <tags>` - Comma-separated list of tags
- `-h, --health-enabled <boolean>` - Enable/disable health checks (true/false)
- `-g, --notification-groups <groups>` - Comma-separated list of notification groups

#### `aloma workspace source`
Edits the source configuration for the workspace.

Options:
- `-w, --workspace <id>` - Workspace ID
- `-f, --file <path>` - Path to source config JSON file
- `--url <url>` - Source URL
- `--username <username>` - Source username
- `--apikey <apikey>` - Source API key
- `--branch <branch>` - Source branch
- `--enabled <enabled>` - Source enabled (true/false)
- `--source-automatic <source_automatic>` - Source automatic (true/false)

#### `aloma workspace sync`
Triggers source sync for the workspace.

Options:
- `-w, --workspace <id>` - Workspace ID

### Company Management

#### `aloma company list`
Lists all available companies.

#### `aloma company switch <identifier>`
Switches to a different company by name or ID.

#### `aloma company add <name>`
Creates a new company (admin only).

Options:
- `-e, --emails <emails>` - Comma-separated list of emails to invite

### Step Management

#### `aloma step list`
Lists all steps in the current workspace.

Options:
- `-w, --workspace <id>` - Specify workspace ID
- `-n, --name <name>` - Filter steps by name
- `-d, --include-disabled` - Include disabled steps

#### `aloma step show <id>`
Shows detailed information about a specific step.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma step add <name>`
Adds a new step with the specified name.

Options:
- `-w, --workspace <id>` - Specify workspace ID
- `-t, --type <type>` - Step type
- `-f, --file <path>` - Path to file containing step condition and content

#### `aloma step delete <id>`
Deletes a step by ID.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma step edit <id>`
Opens an editor to modify a step.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma step clone <id>`
Creates a copy of an existing step.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma step pull`
Pulls steps from workspace to local files. Creates a folder with the workspace name and generates JavaScript files for each step.

Options:
- `-w, --workspace <id>` - Specify workspace ID
- `-s, --step <id>` - Step ID (if not specified, pulls all steps)
- `-p, --path <path>` - Target path (default: current directory)

**Examples:**
```bash
# Pull all steps from current workspace to current directory
aloma step pull

# Pull all steps from specific workspace to a custom path
aloma step pull -w workspace-123 -p /path/to/steps

# Pull a specific step from current workspace
aloma step pull -s step-456
```

#### `aloma step sync`
Syncs local step files to workspace. Reads step files from the workspace folder and updates the corresponding steps.

Options:
- `-w, --workspace <id>` - Specify workspace ID
- `-s, --step <id>` - Step ID (if not specified, syncs all steps)
- `-p, --path <path>` - Source path (default: current directory)

**Examples:**
```bash
# Sync all steps from current directory
aloma step sync

# Sync all steps from a custom path
aloma step sync -p /path/to/steps

# Sync a specific step
aloma step sync -s step-456
```

**File Format:**
The pull and sync commands work with JavaScript files that follow this format:
```javascript
/**
 * Step: Step Name
 * ID: step-id
 * 
 * Edit the condition and content below.
 * The condition should be a valid JavaScript object (trailing commas are allowed).
 * The content should be JavaScript code that will be executed.
 */

export const condition = {
  "status": "active",
  "type": "example"
};

export const content = async () => {
  console.log('Running step');
  data.processed = true;
};
```

### Task Management

#### `aloma task list`
Lists all tasks in the current workspace.

Options:
- `-w, --workspace <id>` - Specify workspace ID
- `-s, --state <state>` - Filter by state (null, done, attention, error, ignored)
- `-n, --name <name>` - Filter by task name

#### `aloma task log <id>`
Shows detailed logs for a specific task.

#### `aloma task new <name>`
Creates a new task with the specified name.

Options:
- `-w, --workspace <id>` - Specify workspace ID
- `-d, --data <json>` - JSON data to send with the task
- `-f, --file <path>` - Path to JSON file containing task data

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
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma webhook show <id>`
Shows detailed information about a specific webhook.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma webhook add <name>`
Adds a new webhook with the specified name.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma webhook delete <id>`
Deletes a webhook by ID.

Options:
- `-w, --workspace <id>` - Specify workspace ID

### Secret Management

#### `aloma secret list`
Lists all secrets in the current workspace.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma secret add <name> <value>`
Adds a new secret.

Options:
- `-w, --workspace <id>` - Specify workspace ID
- `-d, --description <description>` - Secret description
- `-e, --encrypted` - Mark secret as encrypted
- `-o, --options <json>` - JSON options for the secret

#### `aloma secret delete <name>`
Deletes a secret by name.

Options:
- `-w, --workspace <id>` - Specify workspace ID

### Connector Management

#### `aloma connector list`
Lists all connectors in the current workspace.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma connector list-available`
Lists all available connector types and their configurations.

Options:
- `-f, --filter-name <name>` - Filter connectors by name

#### `aloma connector show <id>`
Shows detailed information about a specific connector.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma connector add <connectorId>`
Adds a new connector.

Options:
- `-n, --name <name>` - Connector name
- `-ns, --namespace <namespace>` - Connector namespace
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma connector delete <id>`
Deletes a connector by ID.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma connector update <id>`
Updates a connector's configuration.

Options:
- `-w, --workspace <id>` - Specify workspace ID
- `-n, --name <name>` - Connector name
- `-ns, --namespace <namespace>` - Connector namespace
- `-t, --tags <tags>` - Comma-separated list of tags
- `-s, --shared` - Share connector in realm
- `-c, --config <json>` - JSON configuration for the connector
- `-f, --file <path>` - Path to JSON file containing connector configuration

#### `aloma connector logs <id>`
Views logs for a specific connector.

Options:
- `-w, --workspace <id>` - Specify workspace ID

#### `aloma connector oauth <id>`
Starts OAuth process for a connector.

Options:
- `-w, --workspace <id>` - Specify workspace ID
- `-d, --development` - Start OAuth in development mode

### User Management

#### `aloma user list`
Lists all users in the current company.

#### `aloma user invite <emails>`
Invites new users to the current company.

Options:
- `-r, --roles <roles>` - Comma-separated list of roles to invite the user with

#### `aloma user update <id>`
Updates a user's information.

Options:
- `-r, --roles <roles>` - Comma-separated list of roles to update the user with

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

### Setup

#### `aloma setup`
Sets up Aloma CLI configuration.

Options:
- `-f, --force` - Force overwrite existing configuration

## Examples

### Step Definition Example

```javascript
// examples/step/step1.js
export const condition = {
  "cliStep": true,
  "Step": 1
};

export const content = async () => {
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