# Aloma CLI

A command-line interface for interacting with Aloma services and utilities.

## Installation

```bash
npm install -g aloma
```

### Quick Setup

The Aloma CLI uses secure OAuth2 with PKCE (Proof Key for Code Exchange) - no client secrets needed!

#### Automatic Setup
Installation automatically configures the CLI:
```bash
npm install -g aloma  # OAuth2 PKCE configured automatically
```

#### Manual Setup
If you need to reconfigure or troubleshoot:
```bash
aloma setup
```

#### Configuration
Configuration is stored securely in your home directory:
- `~/.aloma/config.json` - OAuth2 configuration
- `~/.aloma/keys.json` - Session keys

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