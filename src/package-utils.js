import path from "path";
import { promises as fs } from "fs";
import { execSync } from "child_process";

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
