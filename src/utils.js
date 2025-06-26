import os from "os";
import path from "path";
import { promises as fs } from "fs";
import fetch from "node-fetch";
import { GRAPHQL_URL } from "./config.js";
import chalk from "chalk";
import { execSync } from "child_process";
import { EncryptJWT } from "jose";
import { importJWK } from "jose";

// Get the package root directory
export const getPackageRoot = async () => {
  // First check local node_modules
  const localPath = path.join(process.cwd(), "node_modules", "aloma");
  try {
    const stats = await fs.stat(localPath);
    if (stats.isDirectory()) {
      //   console.log('Using local aloma directory:', localPath);
      return localPath;
    }
  } catch (e) {
    // Local path doesn't exist, try global
  }

  // Try global installation using npm root -g
  try {
    const globalRoot = execSync("npm root -g").toString().trim();
    const globalPath = path.join(globalRoot, "aloma");
    const stats = await fs.stat(globalPath);
    if (stats.isDirectory()) {
      //   console.log('Using global aloma directory:', globalPath);
      return globalPath;
    }
  } catch (e) {
    // Global path doesn't exist
  }

  throw new Error(
    "Could not find aloma package in local or global node_modules",
  );
};

// Get the storage path
export const getStoragePath = async (folder) => {
  const packageRoot = await getPackageRoot();
  const cachePath = path.join(packageRoot, ".cache");

  // Create .cache directory if it doesn't exist
  try {
    await fs.mkdir(cachePath, { recursive: true });
  } catch (e) {
    if (e.code !== "EEXIST") {
      throw e;
    }
  }

  return cachePath;
};

// Execute a GraphQL query
export const graphQuery = async (query, variables = {}) => {
  const tokenData = await getSessionData("token");
  if (!tokenData) {
    throw new Error(
      "Not authenticated: No token found. Run `aloma auth` to login.",
    );
  }

  let accessToken;
  try {
    // Check if this is an encrypted token (starts with 'id-')
    if (typeof tokenData === "string" && tokenData.startsWith("id-")) {
      // This is already an encrypted JWE token, use it directly
      accessToken = tokenData;
    } else {
      // Parse the stored token data for raw JWT tokens
      let parsedToken;
      if (typeof tokenData === "string") {
        parsedToken = JSON.parse(tokenData);
      } else {
        parsedToken = tokenData; // Already parsed
      }

      accessToken = parsedToken.access_token;

      if (!accessToken) {
        throw new Error("No access token found in session data.");
      }

      // Check if token is expired
      if (parsedToken.expires_at && parsedToken.expires_at < Date.now()) {
        throw new Error(
          "Access token has expired. Please run `aloma auth` to re-authenticate.",
        );
      }
    }
  } catch (parseError) {
    console.error(chalk.red("Token parse error:"), parseError.message);
    throw new Error(
      `Invalid token data stored: ${parseError.message}. Please run 'aloma auth' to re-authenticate.`,
    );
  }

  try {
    // Set up headers based on token type
    const headers = {
      "Content-Type": "application/json",
    };

    if (accessToken.startsWith("id-")) {
      // For encrypted JWE tokens, send with Bearer prefix (backend strips it)
      headers.Authorization = `Bearer ${accessToken}`;
      headers.Cookie = `Authorization=Bearer%20${encodeURIComponent(accessToken)}`;
    } else {
      // For raw JWT tokens, use Bearer prefix
      headers.Authorization = `Bearer ${accessToken}`;
      headers.Cookie = `Authorization=Bearer%20${encodeURIComponent(accessToken)}`;
    }

    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error(chalk.red("GraphQL Errors:"), data.errors);
      throw new Error(data.errors[0].message);
    }

    return data.data;
  } catch (error) {
    console.error(chalk.red("GraphQL Error:"), error.message);
    throw error;
  }
};

// Manage session data
export const updateSessionData = async (prop, value) => {
  try {
    const cachePath = await getStoragePath("session");
    const sessionPath = path.join(cachePath, "session.json");
    let sessionData = {};

    // Try to read existing session data
    try {
      const existingData = await fs.readFile(sessionPath, "utf-8");
      sessionData = JSON.parse(existingData);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      // If file doesn't exist, we'll create it with the new data
    }

    // Update the specified property
    sessionData[prop] = value;

    // Write back to file
    await fs.writeFile(
      sessionPath,
      JSON.stringify(sessionData, null, 2),
      "utf-8",
    );
    return true;
  } catch (error) {
    console.error(chalk.red("Failed to update session data:"), error.message);
    throw error;
  }
};

// Get session data
export const getSessionData = async (prop = null) => {
  try {
    const cachePath = await getStoragePath("session");
    const sessionPath = path.join(cachePath, "session.json");
    const sessionData = await fs.readFile(sessionPath, "utf-8");
    const parsedData = JSON.parse(sessionData);

    // If prop is specified, return only that property
    if (prop) {
      return parsedData[prop] || null;
    }

    // Otherwise return all session data
    return parsedData;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    console.error(chalk.red("Failed to read session data:"), error.message);
    throw error;
  }
};

export const urlForRegion = async (url) => {
  const user = await getSessionData("user");
  const region = user.realm.region;
  if (region && !url.startsWith(`https://${region}.`)) {
    url = url.replace(/https:\/\//, `https://${region}.`);
  }

  return url;
};

// Get the JWE encryption key from configuration
const getJWEKey = async () => {
  // This is a simplified JWK for demonstration - in production, this should be fetched from configuration
  // The backend uses RSA-OAEP-256 with A256GCM encryption
  const jwk = {
    kty: "RSA",
    use: "enc",
    n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
    e: "AQAB",
    d: "X4cTteJY_gn4FYPsXB8rdXix5vwsg1FLN5E3EaG6RJoVH-HLLKD9M7dx5oo7GURknchnrRweUkC7hT5fJLM0WbFAKNLWYTimewdqMoNkIlSMm-w5-bX0_y_xBAv9QGM_n_8TpS8hH1_k_DgN1DhqE4WH1Y5fJx3dKd8nU8v5j3NZ8-YBPzS9B3K8Z1Z1s-s1XZP5yp_QG2_HHX4S-x-nQZQ5xKcQ7s1L8R5-YT-8Jd5nE1h5H5j4wX_O2E3j5s_F7h2yUOGfXz1tY9j4y5_z5v4h6X4L8e5t5s5n_4e5_L2Q",
  };

  try {
    return await importJWK(jwk, "RSA-OAEP-256");
  } catch (error) {
    console.warn(chalk.yellow("Could not load JWE key, using direct token"));
    return null;
  }
};

// Transform token for GraphQL API compatibility
const transformTokenForGraphQL = async (accessToken, tokenData) => {
  try {
    // Decode the original JWT to extract user information
    const [header, payload, signature] = accessToken.split(".");
    const decodedPayload = JSON.parse(
      Buffer.from(payload, "base64").toString(),
    );

    // Get user data from session
    const userData = await getSessionData("user");
    const parsedUserData =
      typeof userData === "string" ? JSON.parse(userData) : userData;

    // Create the payload that matches what the backend expects for JWE tokens
    const jwePayload = {
      id: decodedPayload.sub,
      firstName: decodedPayload.given_name || parsedUserData?.firstName,
      lastName: decodedPayload.family_name || parsedUserData?.lastName,
      email: decodedPayload.email || parsedUserData?.email,
      authRealm: parsedUserData?.authRealm || "master",
      groups: decodedPayload.groups || parsedUserData?.groups || [],
      selectedRealm:
        parsedUserData?.selectedRealm ||
        (await getSessionData("selectedWorkspace")),
      access_token: accessToken, // Include the original access token as the backend does
    };

    try {
      // Try to create a JWE encrypted token like the backend expects
      const key = await getJWEKey();
      if (key) {
        const jwe = await new EncryptJWT(jwePayload)
          .setProtectedHeader({ alg: "RSA-OAEP-256", enc: "A256GCM" })
          .setIssuedAt()
          .setExpirationTime("1h")
          .setIssuer("home.aloma.io")
          .encrypt(key);

        return "id-" + jwe;
      }
    } catch (jweError) {
      console.warn(chalk.yellow("JWE encryption failed:"), jweError.message);
    }

    // Fallback: return the original token
    return accessToken;
  } catch (error) {
    console.warn(
      chalk.yellow("Token transformation failed, using original:"),
      error,
    );
    return accessToken;
  }
};
