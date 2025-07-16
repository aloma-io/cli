# Aloma CLI

A command-line interface for interacting with Aloma services and utilities.

## Installation

```bash
npm install -g @aloma.io/aloma
```

### Quick Setup

The Aloma CLI uses secure OAuth2 with PKCE (Proof Key for Code Exchange) - no client secrets needed!

#### Manual Setup
If you need to reconfigure or troubleshoot:
```bash
aloma setup
```

#### Security Features
- 🔒 **OAuth2 + PKCE**: Industry-standard secure authentication
- 🛡️ **No Client Secrets**: No credentials embedded in the package
- 🔍 **JWKS Verification**: Tokens verified using public keys
- 🌐 **Browser-based Auth**: Secure browser-based login flow

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
- **Source Control**: Configure and sync source repositories
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
- **Data Integration**: Pass JSON data to tasks

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
- **Connector Configuration**: Add and configure data connectors
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

### 🛠️ Development Tools
- **Local Development**: Link package for development testing
- **Configuration Management**: Environment-specific configurations
- **Error Handling**: Comprehensive error reporting and debugging

## Documentation

For detailed command reference, examples, and advanced usage, see [docs/README.md](docs/README.md).

## License

ISC 