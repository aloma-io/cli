import http from 'http';
import { Issuer, generators } from 'openid-client';
import open from 'open';
import { promises as fs } from 'fs';
import { EncryptJWT } from 'jose/jwt/encrypt';
import * as jose from 'jose';
import { getStoragePath, updateSessionData } from '../../utils.js';
import {
  KEYCLOAK_REALM_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  SCOPE,
  AUTH_PUBLIC_KEY,
} from '../../config.js';
import { graphQuery } from '../../utils.js';
import { ME_QUERY } from './query.js';

let server;
let codeVerifier; // For PKCE

async function getClient() {
  if (!KEYCLOAK_REALM_URL || KEYCLOAK_REALM_URL === 'YOUR_KEYCLOAK_REALM_URL') {
    throw new Error('Keycloak Realm URL not configured in auth.js');
  }
  if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID') {
    throw new Error('Keycloak Client ID not configured in auth.js');
  }

  const issuer = await Issuer.discover(KEYCLOAK_REALM_URL);
  // console.log('Discovered issuer %s %O', issuer.issuer, issuer.metadata);

  const clientOptions = {
    client_id: CLIENT_ID,
    redirect_uris: [REDIRECT_URI],
    response_types: ['code'],
    token_endpoint_auth_method: CLIENT_SECRET ? 'client_secret_basic' : 'none', // Use 'none' for public clients
  };

  // Add client secret only if it's defined (for confidential clients)
  if (CLIENT_SECRET) {
    clientOptions.client_secret = CLIENT_SECRET;
  }

  const client = new issuer.Client(clientOptions);
  return client;
}

async function initiateAuth() {
  return new Promise(async (resolve, reject) => {
    try {
      const client = await getClient();
      codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);

      const authUrl = client.authorizationUrl({
        scope: SCOPE,
        response_mode: 'query',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      console.log('Starting local server on', REDIRECT_URI);
      server = http
        .createServer(async (req, res) => {
          console.log('Received request:', req.url);
          try {
            const params = client.callbackParams(req);
            const tokenSet = await client.callback(REDIRECT_URI, params, {
              code_verifier: codeVerifier,
            });

            // Log the token set for debugging
            console.log('Token set received:', {
              access_token: tokenSet.access_token ? 'present' : 'missing',
              id_token: tokenSet.id_token ? 'present' : 'missing',
              token_type: tokenSet.token_type,
              expires_in: tokenSet.expires_in,
            });

            if (!tokenSet.access_token) {
              throw new Error('Could not find access_token in the Keycloak response.');
            }

            // Import the fixed public key for encryption
            const publicKey = await jose.importSPKI(AUTH_PUBLIC_KEY, 'RSA-OAEP-256');

            // Parse the ID token claims
            const idTokenClaims = JSON.parse(
              Buffer.from(tokenSet.id_token.split('.')[1], 'base64').toString()
            );

            // Create JWE token matching backend's implementation
            const jweToken = await new EncryptJWT({
              _data: {
                id: idTokenClaims.sub,
                firstName: idTokenClaims.given_name,
                lastName: idTokenClaims.family_name,
                email: idTokenClaims.email,
                authRealm: idTokenClaims.iss.split('/').pop(),
                groups: idTokenClaims.groups || [],
                access_token: tokenSet.access_token,
                selectedRealm: idTokenClaims.sid,
              },
            })
              .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })
              .setIssuedAt()
              .setIssuer('home.aloma.io')
              .setAudience('local')
              .setExpirationTime('7d')
              .encrypt(publicKey);

            // Store the encrypted token with the 'id-' prefix
            await updateSessionData('token', `id-${jweToken}`);
            const user = await graphQuery(ME_QUERY);
            await updateSessionData('user', user.me);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Authentication Complete</title>
                            <style>
                                body {
                                    font-family: Arial, sans-serif;
                                    text-align: center;
                                    margin-top: 50px;
                                }
                                .success {
                                    color: green;
                                }
                            </style>
                        </head>
                        <body>
                            <h1 class="success">Authentication successful!</h1>
                            <p>You can close this browser tab and return to the CLI.</p>
                        </body>
                        </html>
                    `);
            shutdownServer();
            resolve(true);
          } catch (err) {
            console.error('Callback handling failed:', err);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Authentication Failed</title>
                            <style>
                                body {
                                    font-family: Arial, sans-serif;
                                    text-align: center;
                                    margin-top: 50px;
                                }
                                .error {
                                    color: red;
                                }
                            </style>
                        </head>
                        <body>
                            <h1 class="error">Authentication failed</h1>
                            <p>Check the CLI console for details.</p>
                            <pre>${err.message}</pre>
                        </body>
                        </html>
                    `);
            shutdownServer();
            reject(err);
          }
        })
        .listen(new URL(REDIRECT_URI).port);

      console.log(`\nPlease open this URL in your browser to authenticate:`);
      console.log(`\n${authUrl}\n`);

      try {
        // Try to open the browser automatically, but don't fail if it doesn't work
        console.log('Attempting to open browser automatically...');
        await open(authUrl).catch(() => {
          console.log('Automatic browser opening failed. Please use the URL above.');
        });
      } catch (openError) {
        // Just log, don't terminate the auth flow
        console.log('Automatic browser opening failed. Please use the URL above.');
      }

      // Timeout for the auth flow
      setTimeout(
        () => {
          if (server && server.listening) {
            console.error('Authentication timed out.');
            shutdownServer();
            reject(new Error('Authentication timed out'));
          }
        },
        5 * 60 * 1000
      ); // 5 minutes timeout
    } catch (err) {
      console.error('Initiate auth failed:', err);
      shutdownServer(); // Ensure server is closed on initial error
      reject(err);
    }
  });
}

function shutdownServer() {
  if (server && server.listening) {
    console.log('Shutting down local server...');
    server.close(() => {
      console.log('Local server shut down.');
      server = null; // Clear the reference
    });
  }
}

async function clearSessionData() {
  try {
    const sessionPath = await getStoragePath('session');
    await fs.unlink(sessionPath);
    console.log('Session data cleared successfully');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No session data found to clear');
      return false;
    } else {
      console.error(`Failed to clear session data: ${error.message}`);
      return false;
    }
  }
}

export { initiateAuth, clearSessionData };
