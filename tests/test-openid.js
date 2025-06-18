console.log('Starting test-openid.js...');

try {
  console.log('Trying to load openid-client...');
  const { Issuer } = require('openid-client');
  console.log('Issuer loaded:', typeof Issuer);

  // Test if Issuer has discover method
  console.log('Issuer.discover exists:', typeof Issuer.discover === 'function');

  // Test all available export properties
  const openidClient = require('openid-client');
  console.log('openid-client exports:', Object.keys(openidClient));
} catch (error) {
  console.error('Error loading openid-client:', error);
}