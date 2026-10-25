import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// Get the package version from package.json
export const getPackageVersion = () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return packageJson.version;
};
