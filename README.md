# Aloma CLI

A command-line interface for interacting with Aloma services and utilities.

## Installation

```bash
npm install -g @aloma.io/aloma
```

### Quick Setup

The Aloma CLI uses secure OAuth2 with PKCE (Proof Key for Code Exchange) - no client secrets needed!

Nothing runs at install time and no setup is needed: the CLI uses the configuration bundled
for the environment. Your own configuration (optional) and your session live in one folder that
only you can read:

- `$XDG_CONFIG_HOME/aloma/` if `XDG_CONFIG_HOME` is set, `%APPDATA%\aloma\` on Windows,
  otherwise `~/.config/aloma/` (`config.json`, `session.json`; folder `0700`, files `0600`).

The CLI never reads configuration or a session from the current directory. A session kept by an
older version inside the installed package is moved there on first use.

#### Manual Setup
To write an editable copy of the bundled configuration into that folder:
```bash
aloma setup
```

#### Security Features
- 🔒 **OAuth2 + PKCE**: Industry-standard secure authentication
- 🛡️ **No Client Secrets**: No credentials embedded in the package
- 🔍 **JWKS Verification**: Tokens verified using public keys
- 🌐 **Browser-based Auth**: Secure browser-based login flow; the local callback listens on loopback only
- 🔐 **https only**: API and login URLs must be https; redirects are never followed with your session
  (for a local development API on loopback only, set `ALOMA_ALLOW_HTTP_LOOPBACK=1`)
- 🙈 **Secrets masked**: `aloma secret list` hides values unless you pass `--reveal`

#### Environment Selection
By default, the CLI uses the production environment. For development:
```bash
export ALOMA_ENV="development"
aloma setup
```

## Quick Start

```bash
# Authenticate with Aloma
aloma auth

# List your workspaces
aloma workspace list

# List your tasks
aloma task list
```

## Features

### 🔐 Authentication & Security
- **OAuth 2.0 Authentication**: Secure browser-based login with Keycloak
- **PKCE Flow**: No client secrets required for enhanced security
- **Token Management**: Automatic token storage and refresh
- **Session Management**: Secure logout and session clearing

### 🏢 Workspace Management
- **Workspace Operations**: Create, list, switch, and manage workspaces
- **Workspace Configuration**: Update settings, tags, and health checks
- **Source Control**: Configure and sync source repositories with JSON or YAML files
- **Archive Management**: Archive and unarchive workspaces
- **Workspace Deletion**: Safe deletion with recovery options

### 🏭 Company Management
- **Multi-Company Support**: Switch between different companies
- **Company Creation**: Create new companies (admin only)
- **User Invitations**: Invite users to companies with specific roles

### ⚙️ Step Management
- **Step Operations**: Create, edit, clone, and delete automation steps
- **Step Types**: Support for various step types and configurations
- **File Integration**: Import step definitions from files
- **Step Filtering**: Filter steps by name and status

### 📋 Task Management
- **Task Lifecycle**: Create, monitor, stop, and resume tasks
- **Task Logging**: Detailed task logs and execution history
- **Task Cloning**: Duplicate existing tasks for reuse
- **State Filtering**: Filter tasks by execution state
- **Data Integration**: Pass JSON or YAML data to tasks

### 🔗 Webhook Management
- **Webhook Operations**: Create, list, and manage webhooks
- **Webhook Configuration**: Configure webhook endpoints and settings
- **Webhook Monitoring**: View webhook details and status

### 🔐 Secret Management
- **Secure Storage**: Store and manage sensitive configuration data
- **Encryption Support**: Optional encryption for secret values
- **Secret Organization**: Organize secrets with descriptions and options
- **Workspace Isolation**: Secrets scoped to specific workspaces

### 🔌 Connector Management
- **Connector Library**: Browse available connector types
- **Connector Configuration**: Add and configure data connectors with JSON or YAML files
- **OAuth Integration**: OAuth setup for third-party services
- **Connector Logs**: Monitor connector performance and errors
- **Shared Connectors**: Share connectors across the realm

### 👥 User Management
- **User Operations**: List, invite, update, and remove users
- **Role Management**: Assign and update user roles
- **Team Collaboration**: Manage team members and permissions

### 🚀 Deployment
- **Infrastructure as Code**: Deploy resources from YAML configuration
- **Multi-Resource Deployment**: Deploy workspaces, steps, tasks, and webhooks
- **Environment Management**: Deploy to different environments

### 📄 Configuration File Support
- **Multi-Format Support**: Use JSON or YAML for configuration files
- **Automatic Detection**: File format automatically detected by extension
- **Backward Compatibility**: Existing JSON files continue to work
- **Supported Formats**:
  - **Connector Configs**: `.json`, `.yaml`, `.yml`
  - **Task Configs**: `.json`, `.yaml`, `.yml`
  - **Source Configs**: `.json`, `.yaml`, `.yml`

### 🛠️ Development Tools
- **Local Development**: Link package for development testing
- **Configuration Management**: Environment-specific configurations
- **Error Handling**: Comprehensive error reporting and debugging

## Configuration Examples

### Connector Configuration (YAML)
```yaml
config:
  apiToken: "your-api-token-here"
  baseUrl: "https://api.example.com"
```

### Task Configuration (YAML)
```yaml
firstName: "John"
lastName: "Doe"
email: "john@example.com"
company: "Example Corp"
$via:
  name: "Webform"
```

### Source Configuration (YAML)
```yaml
apikey: "your-github-token"
branch: "main"
enabled: true
source_automatic: false
url: "https://github.com/user/repo.git"
username: "username"
```

## Exit Codes

Every `aloma` command exits with:

- `0` when the operation succeeded
- `1` when the operation failed (API error, not found, refused, or any item of a `deploy` failed)
- `2` for a usage error (missing argument, unknown option or command, invalid option value)

Errors are printed once, on stderr. Set `DEBUG=1` to add the stack trace.

## Documentation

For detailed command reference, examples, and advanced usage, see [docs/README.md](docs/README.md).

## License

ISC 