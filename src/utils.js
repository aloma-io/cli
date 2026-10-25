import path from "path";
import { promises as fs } from "fs";
import fetch from "node-fetch";
import { GRAPHQL_URL } from "./config.js";
import chalk from "chalk";
import { ME_QUERY } from "./commands/auth/query.js";
import * as jose from "jose";
import {
  getConfigDir,
  ensurePrivateDir,
  tighten,
  OWN_PACKAGE_ROOT,
  PRIVATE_FILE_MODE,
} from "./paths.js";
import { assertSecureUrl, refuseRedirect } from "./net-security.js";

const SESSION_FILE = "session.json";

// Versions up to 0.1.0 kept the session in <package folder>/.cache/session.json, world-readable.
// If the running package still has one, move it to the per-user folder (owner-only) and remove the
// old copy. Only the running package's own folder is looked at, never the current directory, so a
// session planted in a cloned repository is never imported. Best effort; never prints contents.
async function migrateLegacySession(dir) {
  const legacyPath = path.join(OWN_PACKAGE_ROOT, ".cache", SESSION_FILE);
  let legacy;
  try {
    legacy = await fs.readFile(legacyPath, "utf-8");
    JSON.parse(legacy);
  } catch {
    return; // none, unreadable or corrupt: leave it alone
  }
  try {
    await fs.writeFile(path.join(dir, SESSION_FILE), legacy, {
      encoding: "utf-8",
      mode: PRIVATE_FILE_MODE,
      flag: "wx", // an existing session in the per-user folder wins
    });
  } catch (e) {
    if (e.code !== "EEXIST") return;
  }
  try {
    await fs.unlink(legacyPath);
    await fs.rmdir(path.dirname(legacyPath));
  } catch {
    // folder not empty or not ours: fine
  }
}

// Get the storage path: the per-user configuration folder (see paths.js), owner-only.
export const getStoragePath = async (folder) => {
  const dir = await ensurePrivateDir(getConfigDir());
  await migrateLegacySession(dir);
  return dir;
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

    assertSecureUrl(GRAPHQL_URL, "API URL");
    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      redirect: "manual",
      headers,
      body: JSON.stringify({
        query,
        variables,
      }),
    });
    refuseRedirect(response.status, "API");

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
    const sessionPath = path.join(cachePath, SESSION_FILE);
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

    // Write back to file, readable by its owner only (also when the file already existed)
    await fs.writeFile(sessionPath, JSON.stringify(sessionData, null, 2), {
      encoding: "utf-8",
      mode: PRIVATE_FILE_MODE,
    });
    await tighten(sessionPath, PRIVATE_FILE_MODE);
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
    const sessionPath = path.join(cachePath, SESSION_FILE);
    await tighten(sessionPath, PRIVATE_FILE_MODE);
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
