import path from "path";
import { promises as fs, readFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

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

// Get the package version from package.json
export const getPackageVersion = () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return packageJson.version;
};
