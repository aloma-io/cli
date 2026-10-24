import http from "http";
import path from "path";
import fetch from "node-fetch";
import { Issuer, generators } from "openid-client";
import open from "open";
import { promises as fs } from "fs";
import chalk from "chalk";
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
  SESSION_URL,
} from "../../config.js";
import { exchangeIdTokenForSession } from "./session.js";
import { assertSecureUrl, isLoopbackHost } from "../../net-security.js";
import { switchDefaultWorkspace } from "../workspace/index.js";

let server;
let servers = []; // the callback server listens on 127.0.0.1 and, if available, ::1
let codeVerifier; // For PKCE
let authTimeout; // Store the timeout ID
let authCompleted = false; // Flag to prevent duplicate processing
let stateGeneratedAt; // Track when state was generated

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// The sign-in callback must come back to this machine only: http on a loopback host with a port.
function callbackAddress() {
  let u;
  try {
    u = new URL(REDIRECT_URI);
  } catch {
    u = null;
  }
  if (!u || u.protocol !== "http:" || !isLoopbackHost(u.hostname) || !u.port) {
    throw new Error(
      "The redirect URI must be http://localhost:<port> (a loopback address)",
    );
  }
  return { port: Number(u.port) };
}

async function getClient() {
  if (!KEYCLOAK_REALM_URL || KEYCLOAK_REALM_URL === "YOUR_KEYCLOAK_REALM_URL") {
    throw new Error("Keycloak Realm URL not configured. Run 'aloma setup'.");
  }
  assertSecureUrl(KEYCLOAK_REALM_URL, "login service URL");
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
      const { port: callbackPort } = callbackAddress();
      const client = await getClient();

      // Generate PKCE parameters
      codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      const state = generators.state();
      const nonce = generators.nonce();
      stateGeneratedAt = Date.now(); // Track when state was generated
      const authUrl = client.authorizationUrl({
        scope: SCOPE,
        response_mode: "query",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state: state,
        nonce: nonce,
      });

      const handleCallback = async (req, res) => {
        try {
          // Check if authentication has already completed
          if (authCompleted) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authentication Already Complete</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        h1 { color: #28a745; }
                    </style>
                </head>
                <body>
                    <h1>Authentication already completed!</h1>
                    <p>You can close this browser tab and return to the CLI.</p>
                </body>
                </html>
              `);
            return;
          }

          const params = client.callbackParams(req);

          // Verify state parameter
          if (params.state !== state) {
            // If authentication already completed, this might be a duplicate request
            if (authCompleted) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end(`
                  <!DOCTYPE html>
                  <html>
                  <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #28a745;">Authentication already completed!</h1>
                    <p>You can close this browser tab and return to the CLI.</p>
                  </body>
                  </html>
                `);
              return;
            }

            // Check if state has expired (5 minutes)
            const stateAge = Date.now() - stateGeneratedAt;
            if (stateAge > 5 * 60 * 1000) {
              console.log(
                chalk.yellow(
                  "⚠️  State parameter expired, this might be a duplicate or delayed request",
                ),
              );
              res.writeHead(400, { "Content-Type": "text/html" });
              res.end(`
                  <!DOCTYPE html>
                  <html>
                  <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #dc3545;">Authentication expired</h1>
                    <p>Please try the authentication process again.</p>
                  </body>
                  </html>
                `);
              return;
            }

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

          // The API checks the login service's ID token and issues the session
          const sessionToken = await exchangeIdTokenForSession({
            idToken: tokenSet.id_token,
            url: SESSION_URL,
          });

          // Mark authentication as completed to prevent duplicate processing
          authCompleted = true;

          // Store the session data with the encrypted token
          await updateSessionData("selectedWorkspace", null);
          await updateSessionData("token", sessionToken);
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
          console.error(chalk.red("❌ Callback handling failed:"), err.message);
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
                      <pre>${escapeHtml(err.message)}</pre>
                      <p>You can close this window and try again.</p>
                  </div>
              </body>
              </html>
            `);
          shutdownServer();
          reject(err);
        }
      };

      // Loopback only: never reachable from the network during sign-in.
      const listenOn = (host) => {
        const srv = http.createServer(handleCallback);
        srv.sockets = new Set(); // per server: closing one must not cut the other's answer
        srv.on("connection", (socket) => {
          srv.sockets.add(socket);
          socket.on("close", () => srv.sockets.delete(socket));
        });
        srv.listen(callbackPort, host);
        servers.push(srv);
        return srv;
      };
      server = listenOn("127.0.0.1");
      // IPv6 loopback too, since "localhost" can resolve to ::1 first; ignored where unavailable.
      const server6 = listenOn("::1");
      server6.on("error", () => {});
      // Open the browser only once the callback can be received.
      await Promise.all([
        new Promise((ok, fail) => {
          server.once("listening", ok);
          server.once("error", fail);
        }),
        new Promise((ok) => {
          server6.once("listening", ok);
          server6.once("error", ok);
        }),
      ]);

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
  const open = servers.filter((s) => s.listening);
  servers = [];
  for (const s of open) {
    s.close(() => {
      for (const socket of s.sockets) {
        socket.destroy();
      }
      s.sockets.clear();
      if (s === server) server = null;
    });
  }
  // Reset auth completed flag and state tracking for next authentication attempt
  authCompleted = false;
  stateGeneratedAt = null;
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
