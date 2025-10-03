import http from "http";
import path from "path";
import fetch from "node-fetch";
import { Issuer, generators } from "openid-client";
import open from "open";
import { promises as fs } from "fs";
import chalk from "chalk";
import { EncryptJWT } from "jose";
import * as jose from "jose";
import {
  getStoragePath,
  updateSessionData,
  getSessionData,
} from "../../utils.js";
import {
  KEYCLOAK_REALM_URL,
  CLIENT_ID,
  REDIRECT_URI,
  SCOPE,
  JWKS_URL,
} from "../../config.js";
import { switchDefaultWorkspace } from "../workspace/index.js";

let server;
let codeVerifier; // For PKCE
let sockets = new Set();
let authTimeout; // Store the timeout ID

async function getClient() {
  if (!KEYCLOAK_REALM_URL || KEYCLOAK_REALM_URL === "YOUR_KEYCLOAK_REALM_URL") {
    throw new Error("Keycloak Realm URL not configured. Run 'aloma setup'.");
  }
  if (!CLIENT_ID || CLIENT_ID === "YOUR_CLIENT_ID") {
    throw new Error("Keycloak Client ID not configured. Run 'aloma setup'.");
  }

  // Try discovery first, if it fails, fallback to manual configuration
  let issuer;
  try {
    issuer = await Issuer.discover(KEYCLOAK_REALM_URL);
  } catch (discoveryError) {
    console.log(
      chalk.yellow(`⚠️  Discovery failed: ${discoveryError.message}`),
    );
    console.log(chalk.blue("🔧 Using manual endpoint configuration..."));

    // Manual issuer configuration based on Keycloak standard endpoints
    issuer = new Issuer({
      issuer: KEYCLOAK_REALM_URL,
      authorization_endpoint: `${KEYCLOAK_REALM_URL}/protocol/openid-connect/auth`,
      token_endpoint: `${KEYCLOAK_REALM_URL}/protocol/openid-connect/token`,
      userinfo_endpoint: `${KEYCLOAK_REALM_URL}/protocol/openid-connect/userinfo`,
      jwks_uri: JWKS_URL,
      end_session_endpoint: `${KEYCLOAK_REALM_URL}/protocol/openid-connect/logout`,
      scopes_supported: ["openid", "profile", "email", "groups"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    });
  }

  // Public client configuration (no client secret)
  const clientOptions = {
    client_id: CLIENT_ID,
    redirect_uris: [REDIRECT_URI],
    response_types: ["code"],
    token_endpoint_auth_method: "none", // Public client - no authentication needed
  };

  const client = new issuer.Client(clientOptions);
  return client;
}

async function initiateAuth() {
  return new Promise(async (resolve, reject) => {
    try {
      const client = await getClient();

      // Generate PKCE parameters
      codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      const state = generators.state();
      const nonce = generators.nonce();
      const authUrl = client.authorizationUrl({
        scope: SCOPE,
        response_mode: "query",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state: state,
        nonce: nonce,
      });

      server = http
        .createServer(async (req, res) => {
          try {
            const params = client.callbackParams(req);

            // Verify state parameter
            if (params.state !== state) {
              throw new Error("Invalid state parameter");
            }

            if (params.error) {
              throw new Error(
                `OAuth2 error: ${params.error_description || params.error}`,
              );
            }

            const tokenSet = await client.callback(REDIRECT_URI, params, {
              code_verifier: codeVerifier,
              state: state,
              nonce: nonce,
            });

            if (!tokenSet.access_token) {
              throw new Error(
                "No access token received from authorization server",
              );
            }

            // Parse the ID token claims
            const idTokenClaims = tokenSet.claims();

            // Import the fixed public key for encryption
            const { AUTH_PUBLIC_KEY } = await import("../../config.js");
            const publicKey = await jose.importSPKI(
              AUTH_PUBLIC_KEY,
              "RSA-OAEP-256",
            );

            // Create JWE token matching backend's implementation
            const jweToken = await new EncryptJWT({
              _data: {
                id: idTokenClaims.sub,
                firstName: idTokenClaims.given_name,
                lastName: idTokenClaims.family_name,
                email: idTokenClaims.email,
                authRealm: idTokenClaims.iss.split("/").pop(),
                groups: idTokenClaims.groups || [],
                access_token: tokenSet.access_token,
                selectedRealm: idTokenClaims.sid,
              },
            })
              .setProtectedHeader({ alg: "RSA-OAEP-256", enc: "A256GCM" })
              .setIssuedAt()
              .setIssuer("home.aloma.io")
              .setAudience("local")
              .setExpirationTime("7d")
              .encrypt(publicKey);

            // Store the encrypted token with the 'id-' prefix
            const encryptedToken = `id-${jweToken}`;

            // Store the session data with the encrypted token
            await updateSessionData("selectedWorkspace", null);
            await updateSessionData("token", encryptedToken);
            await switchDefaultWorkspace();

            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                  <title>Authentication Complete</title>
                  <style>
                      body {
                          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                          text-align: center;
                          padding: 100px 50px;
                          background: #f8f9fa;
                          margin: 0;
                          color: #333;
                      }
                      h1 { 
                          color: #28a745; 
                          margin-bottom: 20px; 
                          font-size: 2.5em;
                          font-weight: 300;
                      }
                      p { 
                          font-size: 18px; 
                          color: #6c757d;
                          margin: 0;
                      }
                  </style>
              </head>
              <body>
                  <h1>Authentication successful!</h1>
                  <p>You can close this browser tab and return to the CLI.</p>
                  <script>
                      // Auto-close window after 3 seconds
                      setTimeout(() => {
                          window.close();
                      }, 3000);
                  </script>
              </body>
              </html>
            `);

            shutdownServer();
            console.log(
              chalk.green("\n🎉 Authentication completed successfully!"),
            );
            console.log(chalk.white("You can now use the Aloma CLI:"));
            console.log(chalk.gray("  ▶ aloma workspace list"));
            console.log();
            resolve(true);
          } catch (err) {
            console.error(
              chalk.red("❌ Callback handling failed:"),
              err.message,
            );
            res.writeHead(500, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                  <title>Authentication Failed</title>
                  <style>
                      body {
                          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                          text-align: center;
                          padding: 50px;
                          background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
                          color: white;
                          margin: 0;
                      }
                      .container {
                          background: rgba(255,255,255,0.1);
                          padding: 40px;
                          border-radius: 15px;
                          backdrop-filter: blur(10px);
                          max-width: 500px;
                          margin: 0 auto;
                      }
                      h1 { color: #ffcccc; margin-bottom: 20px; }
                      pre { background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; text-align: left; }
                  </style>
              </head>
              <body>
                  <div class="container">
                      <h1>❌ Authentication Failed</h1>
                      <p>The OAuth2 PKCE authentication process failed.</p>
                      <p>Check the CLI console for details.</p>
                      <pre>${err.message}</pre>
                      <p>You can close this window and try again.</p>
                  </div>
              </body>
              </html>
            `);
            shutdownServer();
            reject(err);
          }
        })
        .listen(new URL(REDIRECT_URI).port);

      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });

      try {
        await open(authUrl);
      } catch (openError) {
        console.log(chalk.yellow("⚠️  Could not open browser automatically."));
      }

      // Timeout for the auth flow
      authTimeout = setTimeout(
        () => {
          if (server && server.listening) {
            console.error(
              chalk.red("❌ Authentication timed out after 5 minutes."),
            );
            shutdownServer();
            reject(new Error("Authentication timed out"));
          }
        },
        5 * 60 * 1000,
      ); // 5 minutes timeout
    } catch (err) {
      console.error(
        chalk.red("❌ Authentication initialization failed:"),
        err.message,
      );
      shutdownServer(); // Ensure server is closed on initial error
      reject(err);
    }
  });
}

function shutdownServer() {
  if (authTimeout) {
    clearTimeout(authTimeout);
    authTimeout = null;
  }
  if (server && server.listening) {
    server.close(() => {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      server = null;
    });
  }
}

async function endKeycloakSession() {
  try {
    // Get current session data to extract token information
    const sessionData = await getSessionData();
    if (!sessionData || !sessionData.token) {
      console.log(
        chalk.yellow("⚠️  No active session found to terminate on Keycloak"),
      );
      return;
    }

    // Get the Keycloak client to access logout endpoint
    const client = await getClient();

    // Extract the ID token from the stored token (if available)
    // The token is encrypted, so we'll attempt to call the logout endpoint anyway
    const logoutUrl = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/logout`;

    // console.log(chalk.blue("🔄 Terminating Keycloak session..."));

    // Make a request to the logout endpoint
    const response = await fetch(logoutUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Aloma CLI",
      },
    });

    // if (response.ok || response.status === 404) {
    //   // console.log(chalk.green("✅ Keycloak session terminated successfully"));
    // } else {
    //   console.log(chalk.yellow("⚠️  Could not verify Keycloak session termination (this is usually fine)"));
    // }
  } catch (error) {
    console.log(
      chalk.yellow(
        `⚠️  Could not terminate Keycloak session: ${error.message}`,
      ),
    );
    console.log(
      chalk.gray(
        "   This is usually fine - the local session will still be cleared.",
      ),
    );
  }
}

async function clearSessionData() {
  try {
    // First, terminate the Keycloak session
    await endKeycloakSession();

    // Then clear local session data
    const cachePath = await getStoragePath("session");
    const sessionPath = path.join(cachePath, "session.json");
    await fs.unlink(sessionPath);
    // console.log(chalk.green("✅ Local session data cleared successfully"));
    console.log(
      chalk.green("✓ Logout completed - you have been signed out of Aloma"),
    );
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(chalk.yellow("ℹ️  No local session data found to clear"));
      return false;
    } else {
      console.error(
        chalk.red(`❌ Failed to clear session data: ${error.message}`),
      );
      return false;
    }
  }
}

export { initiateAuth, clearSessionData };
