// The test preload (tests/helpers/child-preload.mjs) is loaded with --import into every CLI process
// the auth tests start. Node 26 prints a DeprecationWarning (DEP0205) for module.register(), which
// broke the "prints nothing" assertions there. The preload must use module.registerHooks() when it
// exists, and `open` must still resolve to the fake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as nodeModule from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPY = pathToFileURL(path.join(HERE, "helpers", "register-spy.mjs")).href;
const PRELOAD = pathToFileURL(path.join(HERE, "helpers", "child-preload.mjs")).href;
const HAS_REGISTER_HOOKS = typeof nodeModule.registerHooks === "function";

const CHILD = `
import open from "open";
await open("http://127.0.0.1/signin");
let other = "none";
try { await import("open-not-the-fake"); } catch (e) { other = e.code; }
console.log(other);
`;

function child(extraEnv = {}, nodeArgs = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "preload-hooks-"));
  const openLog = path.join(dir, "open.log");
  const registerLog = path.join(dir, "register.log");
  try {
    const r = spawnSync(
      process.execPath,
      [...nodeArgs, "--import", SPY, "--import", PRELOAD, "--input-type=module", "-e", CHILD],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, ALOMA_TEST_OPEN_LOG: openLog, ALOMA_TEST_REGISTER_LOG: registerLog, ...extraEnv },
      },
    );
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      opened: existsSync(openLog) ? readFileSync(openLog, "utf8") : "",
      registerCalls: existsSync(registerLog) ? readFileSync(registerLog, "utf8").split("\n").filter(Boolean).length : 0,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("preload: open resolves to the fake and nothing else is remapped", () => {
  const r = child();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.opened, "http://127.0.0.1/signin\n");
  assert.equal(r.stdout.trim(), "ERR_MODULE_NOT_FOUND");
});

test("preload: emits no warning, even with --pending-deprecation", () => {
  const r = child({}, ["--pending-deprecation"]);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /DeprecationWarning|DEP0205/);
  assert.equal(r.stderr, "");
});

test("preload: module.register() is not called when module.registerHooks() exists", { skip: !HAS_REGISTER_HOOKS }, () => {
  assert.equal(child().registerCalls, 0);
});

test("preload: falls back to module.register() and still maps open when registerHooks is missing", () => {
  const r = child({ ALOMA_TEST_NO_REGISTER_HOOKS: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.registerCalls, 1);
  assert.equal(r.opened, "http://127.0.0.1/signin\n");
  assert.equal(r.stdout.trim(), "ERR_MODULE_NOT_FOUND");
});
