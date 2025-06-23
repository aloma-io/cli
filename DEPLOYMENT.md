# Deployment Guide for Maintainers

This guide is for Aloma team members who need to update the configuration templates with real credentials.

## Important Security Note

**NEVER commit real credentials to git!** This process updates separate files that are used for deployment but not stored in the repository.

## Setup

1. **Create local credential files** (these should NOT be in git):

```bash
# Create secure credential files (not in git)
mkdir -p secrets/
cat > secrets/production.json << 'EOF'
{
  "environment": "production",
  "keycloakRealmUrl": "https://accounts.aloma.io/realms/master",
  "clientId": "graph",
  "clientSecret": "YOUR_ACTUAL_PRODUCTION_CLIENT_SECRET",
  "redirectUri": "http://localhost:8989",
  "scope": "openid profile email groups",
  "graphqlUrl": "https://graph.aloma.io/graphql",
  "graphqlHost": "graph.aloma.io",
  "authPublicKey": "YOUR_ACTUAL_PRODUCTION_AUTH_PUBLIC_KEY"
}
EOF

cat > secrets/development.json << 'EOF'
{
  "environment": "development",
  "keycloakRealmUrl": "https://accounts-dev.aloma.io/realms/master",
  "clientId": "graph",
  "clientSecret": "YOUR_ACTUAL_DEVELOPMENT_CLIENT_SECRET",
  "redirectUri": "http://localhost:8989",
  "scope": "openid profile email groups",
  "graphqlUrl": "https://test.graph.aloma.io/graphql",
  "graphqlHost": "test.graph.aloma.io",
  "authPublicKey": "YOUR_ACTUAL_DEVELOPMENT_AUTH_PUBLIC_KEY"
}
EOF

# Make sure secrets directory is secured
chmod 700 secrets/
chmod 600 secrets/*.json

# Add to gitignore if not already there
echo "secrets/" >> .gitignore
```

2. **Replace placeholder values** in `secrets/production.json` and `secrets/development.json` with actual credentials.

## Deployment Options

### Option 1: Deploy to Configuration Endpoint (Recommended)

If you have a configuration endpoint where users can fetch configuration:

```bash
# Set up deployment environment
export CONFIG_DEPLOYMENT_ENDPOINT="https://api.aloma.io"
export DEPLOYMENT_TOKEN="your-deployment-token"

# Deploy production configuration
node scripts/deploy-config.js --env production --source secrets/production.json

# Deploy development configuration  
node scripts/deploy-config.js --env development --source secrets/development.json
```

### Option 2: Environment Variables for CI/CD

For CI/CD systems, use environment variables:

```bash
# In your CI/CD system, set these as secrets:
ALOMA_CLIENT_SECRET="actual-production-secret"
ALOMA_AUTH_PUBLIC_KEY="actual-production-key"
ALOMA_ENV="production"

# For development/staging:
ALOMA_CLIENT_SECRET="actual-development-secret"
ALOMA_AUTH_PUBLIC_KEY="actual-development-key"
ALOMA_ENV="development"
```

### Option 3: Manual Distribution

For manual distribution to team members:

```bash
# Create encrypted archive of credentials
tar -czf aloma-credentials.tar.gz secrets/
gpg --encrypt --armor --recipient team@aloma.io aloma-credentials.tar.gz

# Distribute aloma-credentials.tar.gz.asc securely
# Recipients can decrypt with:
# gpg --decrypt aloma-credentials.tar.gz.asc | tar -xzf -
```

## Publishing Process

1. **Ensure templates have placeholder values:**
   ```bash
   # Verify that config/production.json and config/development.json 
   # contain only placeholder values like "YOUR_PRODUCTION_CLIENT_SECRET"
   grep -r "YOUR_.*_SECRET" config/
   ```

2. **Run tests:**
   ```bash
   npm test
   npm run format:check
   ```

3. **Publish package:**
   ```bash
   npm publish
   ```

4. **Deploy configuration** (if using configuration endpoint):
   ```bash
   node scripts/deploy-config.js --env production
   node scripts/deploy-config.js --env development
   ```

## File Structure

```
aloma-cli/
├── config/                    # Published templates (placeholders only)
│   ├── production.json        # Template with "YOUR_*_SECRET" values
│   └── development.json       # Template with "YOUR_*_SECRET" values
├── secrets/                   # Local only (in .gitignore)
│   ├── production.json        # Real credentials (NEVER commit)
│   └── development.json       # Real credentials (NEVER commit)
├── scripts/
│   └── deploy-config.js       # Deployment script
└── src/
    └── config.js              # Dynamic configuration loader
```

## Security Checklist

Before deploying:

- [ ] Verify `config/` templates contain only placeholder values
- [ ] Verify `secrets/` directory is in `.gitignore`
- [ ] Verify no real credentials are in git history
- [ ] Test that CLI works with environment variables
- [ ] Test that CLI works with local configuration files
- [ ] Verify deployment endpoint is secured (HTTPS, authentication)

## Emergency Procedures

### If Credentials Are Accidentally Committed

1. **Immediately rotate all exposed credentials**
2. **Remove from git history:**
   ```bash
   git filter-branch --force --index-filter \
     'git rm --cached --ignore-unmatch config/production.json' \
     --prune-empty --tag-name-filter cat -- --all
   ```
3. **Force push to all remotes**
4. **Notify team to re-clone repository**

### If Configuration Endpoint Is Compromised

1. **Immediately rotate all credentials**
2. **Take endpoint offline** 
3. **Audit access logs**
4. **Update endpoint security**
5. **Redeploy with new credentials**

## Support

For deployment issues, contact the DevOps team with:
- Error messages
- Environment details
- Steps attempted
- **DO NOT include actual credentials in support requests**
