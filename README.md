# Aloma CLI

A command-line interface for interacting with Aloma services and utilities.

## Installation

```bash
npm install -g aloma
```

### Security Configuration

The Aloma CLI requires sensitive configuration (API keys, secrets) to function. For security reasons, these are **not included** in the published package. Instead, they are configured locally on your machine during setup.

#### Automatic Setup
When you install the package, it will attempt to set up configuration automatically:
```bash
npm install -g aloma  # Runs setup automatically
```

#### Manual Setup
If automatic setup fails or you need to reconfigure:
```bash
aloma setup
```

#### Configuration Files
Configuration is stored securely in your home directory:
- `~/.aloma/config.json` - General configuration
- `~/.aloma/keys.json` - Security keys

#### Environment Variables
For advanced users or CI/CD environments, you can use environment variables:
```bash
export ALOMA_CLIENT_SECRET="your-client-secret"
export ALOMA_AUTH_PUBLIC_KEY="your-auth-public-key"
export ALOMA_ENV="production"  # or "development"
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

- **Authentication**: Secure OAuth 2.0 authentication with Keycloak
- **Workspace Management**: Create, list, and switch between workspaces
- **Task Management**: Create, monitor, and control automation tasks
- **Step Management**: Manage automation steps and workflows
- **Connector Management**: Configure and manage data connectors
- **Webhook Management**: Set up and manage webhooks
- **User Management**: Invite and manage team members
- **Deployment**: Deploy resources from YAML configuration files

## Documentation

For detailed documentation, see [docs/README.md](docs/README.md).

## License

ISC 