import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

// Where the CLI keeps its configuration and session: one fixed folder per user, never the current
// directory and never the installed package (a cloned repository can ship a node_modules tree, and
// an installed package folder is often readable by every user).
//
//   $XDG_CONFIG_HOME/aloma   when XDG_CONFIG_HOME is an absolute path
//   %APPDATA%\aloma          on Windows
//   ~/.config/aloma          otherwise
//
// The session is a JSON file readable by its owner only (0600, folder 0700). The OS keychain
// (keytar) was considered and not used: keytar is archived upstream, is a native module whose
// binary is fetched by an install script (so it fails when installed with --ignore-scripts and
// needs libsecret and a desktop session on Linux), and a keychain entry would not stop another
// process of the same user either, which is the residual risk of a 0600 file too.
export function getConfigDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && path.isAbsolute(xdg)) return path.join(xdg, "aloma");
  if (
    process.platform === "win32" &&
    process.env.APPDATA &&
    path.isAbsolute(process.env.APPDATA)
  ) {
    return path.join(process.env.APPDATA, "aloma");
  }
  return path.join(os.homedir(), ".config", "aloma");
}

// The folder of the package that is running (this file's ../). Only used to find a session an
// older version kept inside its own package folder; never derived from the current directory.
export const OWN_PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

// Create the folder owner-only, and tighten it if it already exists with wider permissions.
export async function ensurePrivateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await tighten(dir, PRIVATE_DIR_MODE);
  return dir;
}

// chmod to `mode` when group or other have any access. Best effort (e.g. Windows, or a file owned
// by someone else, which the CLI then still uses as before).
export async function tighten(file, mode) {
  if (process.platform === "win32") return;
  try {
    const st = await fs.stat(file);
    if ((st.mode & 0o077) !== 0) await fs.chmod(file, mode);
  } catch (e) {
    if (e.code !== "ENOENT" && e.code !== "EPERM") throw e;
  }
}
