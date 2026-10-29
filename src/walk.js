import fs from "fs/promises";
import path from "path";

// Every .js file under `dir`, recursively, with its path and its path relative to `baseDir`.
export async function walkJsFiles(dir, baseDir = dir) {
  let results = [];
  const list = await fs.readdir(dir, { withFileTypes: true });
  for (const file of list) {
    const filePath = path.join(dir, file.name);
    if (file.isDirectory()) {
      results = results.concat(await walkJsFiles(filePath, baseDir));
    } else if (file.isFile() && file.name.endsWith(".js")) {
      results.push({
        absPath: filePath,
        relPath: path.relative(baseDir, filePath),
      });
    }
  }
  return results;
}
