import path from "path";
import { promises as fs } from "fs";
import fetch from "node-fetch";
import { GRAPHQL_URL } from "./config.js";
import chalk from "chalk";
import { execSync } from "child_process";
import { ME_QUERY } from "./commands/auth/query.js";
import * as jose from "jose";

// Get the package root directory
export const getPackageRoot = async () => {
  // First check local node_modules
  const localPath = path.join(
    process.cwd(),
    "node_modules",
    "@aloma.io",
    "aloma",
  );
  try {
    const stats = await fs.stat(localPath);
    if (stats.isDirectory()) {
      return localPath;
    }
  } catch (e) {
    // Local path doesn't exist, try global
  }

  // Try global installation using npm root -g
  try {
    const globalRoot = execSync("npm root -g").toString().trim();
    const globalPath = path.join(globalRoot, "@aloma.io", "aloma");
    const stats = await fs.stat(globalPath);
    if (stats.isDirectory()) {
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

  try {
    // Set up headers based on token type
    const headers = {
      "Content-Type": "application/json",
    };

    headers.Authorization = `Bearer ${tokenData}`;
    headers.Cookie = `Authorization=Bearer%20${encodeURIComponent(tokenData)}`;

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
      // console.error(chalk.red("GraphQL Errors:"), data.errors);
      const errorMessages = data.errors
        .map((error) => error.message)
        .join("\n");
      throw new Error(errorMessages);
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
  const user = await graphQuery(ME_QUERY);
  const region = user.me.realm.region;
  if (region && !url.startsWith(`https://${region}.`)) {
    url = url.replace(/https:\/\//, `https://${region}.`);
  }

  return url;
};

export const doEncrypt = async ({
  pubKey,
  value,
  audience = "connector",
  expiration = "",
}) => {
  const algorithm = "RSA-OAEP-256";
  const issuer = "home.aloma.io";
  const key = await jose.importSPKI(atob(pubKey), algorithm);

  const item = new jose.EncryptJWT({ _data: value })
    .setProtectedHeader({ alg: algorithm, enc: "A256GCM" })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience);

  if (expiration && expiration !== "none") item.setExpirationTime(expiration);

  return await item.encrypt(key);
};
