# Security Configuration

## Overview

The Aloma CLI handles sensitive configuration securely by storing credentials outside the published package. This document explains how the security model works and how to configure it properly.

## Security Model

### What's Public vs Private

**Public (included in npm package):**
- Configuration templates with placeholder values
- CLI source code
- Documentation
- Default URLs and non-sensitive settings

**Private (NOT included in npm package):**
- Actual client secrets (placeholders in templates)
- Actual authentication keys (placeholders in templates)
- Any real credentials

### Configuration Storage

Sensitive configuration is stored locally on each user's machine in:
- `~/.aloma/config.json` - General configuration including secrets
- `~/.aloma/keys.json` - Authentication keys

These files are created during the setup process and are never included in the published package.

## Setup Process

### For End Users

1. **Install the package:**
   ```bash
   npm install -g aloma
   ```

2. **Automatic setup** (runs during install):
   - Creates `~/.aloma/` directory
   - Attempts to fetch configuration from remote endpoint
   - Falls back to empty configuration if fetch fails

3. **Manual setup** (if needed):
   ```bash
   aloma setup --force
   ```

### For Developers/CI

Use environment variables for automated environments:

```bash
export ALOMA_CLIENT_SECRET="your-client-secret"
export ALOMA_AUTH_PUBLIC_KEY="your-auth-public-key"
export ALOMA_ENV="production"  # or "development"
```

## Configuration Hierarchy

The CLI loads configuration in this order (later values override earlier ones):

1. Configuration templates (`config/production.json`, `config/development.json`)
2. Local configuration files (`~/.aloma/config.json`, `~/.aloma/keys.json`)
3. Environment variables (`ALOMA_*`)

Environment detection:
- Uses `ALOMA_ENV` or `NODE_ENV` to determine which template to load
- Defaults to `production` if no environment is specified

## Deployment Process

### For Package Maintainers

1. **Never commit sensitive data** to the repository
2. **Use the deployment script** to update the remote configuration endpoint:
   ```bash
   node scripts/deploy-config.js --env production
   ```

3. **Environment variables for deployment:**
   ```bash
   export CONFIG_DEPLOYMENT_ENDPOINT="https://api.aloma.io"
   export DEPLOYMENT_TOKEN="your-deployment-token"
   ```

### Configuration Templates

The `config/` directory contains templates:
- `config/production.json` - Production configuration template
- `config/development.json` - Development configuration template

These **ARE** included in the published package but contain only placeholder values like `"YOUR_PRODUCTION_CLIENT_SECRET"` - never real credentials.

## Security Best Practices

### For End Users

1. **Protect your configuration directory:**
   ```bash
   chmod 700 ~/.aloma/
   chmod 600 ~/.aloma/*.json
   ```

2. **Use environment variables in CI/CD:**
   - Don't store credentials in CI configuration files
   - Use your CI system's secret management

3. **Regularly rotate credentials:**
   - Update configuration when credentials change
   - Run `aloma setup --force` to refresh

### For Developers

1. **Never commit credentials:**
   - The `config/` directory contains only placeholder values
   - Never replace placeholders with real values in the repository
   - Always use placeholder values in templates

2. **Secure the configuration endpoint:**
   - Use HTTPS for the configuration endpoint
   - Authenticate configuration deployments
   - Log configuration access

3. **Environment separation:**
   - Use different credentials for development/production
   - Separate configuration endpoints per environment

## Troubleshooting

### Configuration Not Found

If you see "Aloma configuration not found":

1. Run `aloma setup` to initialize configuration
2. Check that `~/.aloma/` directory exists and is readable
3. Verify network connectivity if fetching remote config

### Authentication Failures

If authentication fails:

1. Verify `CLIENT_SECRET` and `AUTH_PUBLIC_KEY` are set
2. Check environment variables: `env | grep ALOMA`
3. Ensure configuration files have correct permissions
4. Try refreshing configuration: `aloma setup --force`

### Environment Issues

To check your current configuration:

```bash
# Check environment variables
env | grep ALOMA

# Check local configuration files
cat ~/.aloma/config.json
cat ~/.aloma/keys.json

# Test configuration loading
node -e "import('./src/config.js').then(c => console.log('Config loaded:', Object.keys(c)))"
```

## Migration Guide

### From Hardcoded Secrets

If you currently have hardcoded secrets in your configuration:

1. **Extract secrets to templates:**
   ```bash
   # Move current config.js content to config/production.json
   # Replace sensitive values with placeholders
   ```

2. **Update configuration loading:**
   ```javascript
   // Old: hardcoded values
   export const CLIENT_SECRET = "actual-secret";
   
   // New: dynamic loading
   export const CLIENT_SECRET = process.env.ALOMA_CLIENT_SECRET || config.clientSecret || '';
   ```

3. **Deploy new configuration:**
   ```bash
   node scripts/deploy-config.js --env production
   ```

4. **Update CI/CD:**
   - Add environment variables to CI configuration
   - Remove hardcoded secrets from deployment scripts

## Support

For security-related questions or issues:
- Check this documentation first
- Review the troubleshooting section
- Contact the Aloma team for sensitive issues

**Do not include sensitive information in public issue reports.**
