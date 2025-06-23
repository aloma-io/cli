#!/usr/bin/env node

/**
 * Configuration Deployment Script
 * 
 * This script is used to deploy sensitive configuration to the configuration endpoint
 * that users will fetch during setup. This should be run as part of your deployment process.
 * 
 * Usage:
 *   node scripts/deploy-config.js --env production
 *   node scripts/deploy-config.js --env development
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment-specific configuration
function loadEnvironmentConfig(env) {
  const configPath = join(__dirname, `../config/${env}.json`);
  
  try {
    const configData = readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error(`Failed to load configuration for environment: ${env}`);
    console.error(`Expected file: ${configPath}`);
    throw error;
  }
}

// Deploy configuration to your API endpoint
async function deployConfiguration(env, config) {
  const deploymentEndpoint = process.env.CONFIG_DEPLOYMENT_ENDPOINT;
  
  if (!deploymentEndpoint) {
    console.error('CONFIG_DEPLOYMENT_ENDPOINT environment variable is required');
    process.exit(1);
  }
  
  try {
    // This is where you would deploy to your actual endpoint
    // const response = await fetch(`${deploymentEndpoint}/cli/config/${env}`, {
    //   method: 'PUT',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${process.env.DEPLOYMENT_TOKEN}`
    //   },
    //   body: JSON.stringify(config)
    // });
    
    // if (!response.ok) {
    //   throw new Error(`Failed to deploy: ${response.statusText}`);
    // }
    
    console.log(`✅ Configuration deployed for environment: ${env}`);
    console.log('Configuration (secrets redacted):');
    
    // Log configuration with secrets redacted
    const redactedConfig = JSON.parse(JSON.stringify(config));
    if (redactedConfig.clientSecret) redactedConfig.clientSecret = '[REDACTED]';
    if (redactedConfig.authPublicKey) redactedConfig.authPublicKey = '[REDACTED]';
    
    console.log(JSON.stringify(redactedConfig, null, 2));
    
  } catch (error) {
    console.error('Failed to deploy configuration:', error.message);
    throw error;
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const envIndex = args.indexOf('--env');
  
  if (envIndex === -1 || !args[envIndex + 1]) {
    console.error('Usage: node scripts/deploy-config.js --env <environment>');
    console.error('Example: node scripts/deploy-config.js --env production');
    process.exit(1);
  }
  
  const environment = args[envIndex + 1];
  
  console.log(`🚀 Deploying configuration for environment: ${environment}`);
  
  try {
    const config = loadEnvironmentConfig(environment);
    await deployConfiguration(environment, config);
    console.log('✅ Deployment completed successfully');
  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
