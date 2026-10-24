// Test harness for the command regression tests.
//
// Runs the repo's own src/cli.js in a child process, inside a throw-away directory that
// looks like an installed package (node_modules/@aloma.io/aloma/.cache/session.json holds
// a FAKE token). The GraphQL endpoint is a local http server on 127.0.0.1 that records
// every request; nothing ever leaves the machine. `open` (browser/editor launch) is
// replaced by a fake executable first on PATH.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as AUTH_Q from "../../src/commands/auth/query.js";
import * as WORKSPACE_Q from "../../src/commands/workspace/query.js";
import * as STEP_Q from "../../src/commands/step/query.js";
import * as LIBRARY_Q from "../../src/commands/library/query.js";
import * as TASK_Q from "../../src/commands/task/query.js";
import * as WEBHOOK_Q from "../../src/commands/webhook/query.js";
import * as SECRET_Q from "../../src/commands/secret/query.js";
import * as CONNECTOR_Q from "../../src/commands/connector/query.js";
import * as USER_Q from "../../src/commands/user/query.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "src", "cli.js");
const PRELOAD = pathToFileURL(path.join(HERE, "preload-axios.mjs")).href;

// query text -> exported constant name (e.g. LIST_STEPS_QUERY)
const OPS = new Map();
for (const mod of [
  AUTH_Q,
  WORKSPACE_Q,
  STEP_Q,
  LIBRARY_Q,
  TASK_Q,
  WEBHOOK_Q,
  SECRET_Q,
  CONNECTOR_Q,
  USER_Q,
]) {
  for (const [name, text] of Object.entries(mod)) OPS.set(text, name);
}

export const FAKE_TOKEN = "fake-token-for-tests-only";
export const gqlError = (...messages) => ({
  __gqlErrors: messages.map((message) => ({ message })),
});
export const rawReply = (status, text) => ({ __raw: { status, text } });

async function startApi() {
  const calls = [];
  const unmocked = [];
  const handlers = new Map();
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const reply = (status, text) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(text);
      };
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return reply(400, "{}");
      }
      const op = OPS.get(parsed.query) || "UNKNOWN_OPERATION";
      const call = {
        op,
        variables: parsed.variables,
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: parsed.query,
      };
      calls.push(call);
      const handler = handlers.get(op);
      if (handler === undefined) {
        unmocked.push(op);
        return reply(
          200,
          JSON.stringify({ errors: [{ message: `UNMOCKED ${op}` }] }),
        );
      }
      let out = typeof handler === "function" ? handler(call.variables, call) : handler;
      if (Array.isArray(out?.__sequence)) out = out.__sequence.shift();
      if (out && out.__raw) return reply(out.__raw.status, out.__raw.text);
      if (out && out.__gqlErrors)
        return reply(200, JSON.stringify({ errors: out.__gqlErrors }));
      reply(200, JSON.stringify({ data: out }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}/graphql`,
    calls,
    unmocked,
    // api.on('LIST_STEPS_QUERY', {listAutomationSteps: []}) or a function (vars) => data
    on: (op, h) => handlers.set(op, h),
    // successive replies for one operation
    sequence: (op, ...replies) => handlers.set(op, { __sequence: replies }),
    ops: () => calls.map((c) => c.op),
    close: () => new Promise((r) => server.close(r)),
  };
}

const FAKE_OPEN = `#!/bin/sh
# fake "open": log the arguments; optionally run an "editor" on the target file
printf '%s\\n' "$*" >> "$TEST_OPEN_LOG"
for last in "$@"; do :; done
if [ -n "$TEST_EDITOR_SCRIPT" ]; then "$TEST_NODE" "$TEST_EDITOR_SCRIPT" "$last"; fi
exit 0
`;

export const canFakeOpen = process.platform === "darwin";

export async function createSandbox({
  session = { token: FAKE_TOKEN, selectedWorkspace: "ws-sel" },
  env = {},
} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aloma-cli-test-")));
  // the CLI looks for its package (and session cache) in <cwd>/node_modules/@aloma.io/aloma
  const work = path.join(root, "work");
  const pkg = path.join(work, "node_modules", "@aloma.io", "aloma");
  fs.mkdirSync(path.join(pkg, ".config"), { recursive: true });
  fs.mkdirSync(path.join(pkg, ".cache"), { recursive: true });
  fs.writeFileSync(path.join(pkg, ".config", "config.json"), "{}");
  const sessionFile = path.join(pkg, ".cache", "session.json");
  if (session) fs.writeFileSync(sessionFile, JSON.stringify(session));
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "open"), FAKE_OPEN, { mode: 0o755 });
  const openLog = path.join(root, "open.log");
  const axiosLog = path.join(root, "axios.log");
  const api = await startApi();

  const sb = {
    root,
    work, // default cwd for the CLI; relative paths in tests resolve here
    api,
    sessionFile,
    openLog,
    axiosLog,
    readSession: () => JSON.parse(fs.readFileSync(sessionFile, "utf8")),
    write(rel, text) {
      const p = path.isAbsolute(rel) ? rel : path.join(work, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
      return p;
    },
    read: (rel) =>
      fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(work, rel), "utf8"),
    exists: (rel) =>
      fs.existsSync(path.isAbsolute(rel) ? rel : path.join(work, rel)),
    list: (rel = ".") =>
      fs
        .readdirSync(path.join(work, rel))
        .filter((n) => n !== "node_modules")
        .sort(),
    openCalls: () =>
      fs.existsSync(openLog)
        ? fs.readFileSync(openLog, "utf8").trim().split("\n")
        : [],
    axiosCalls: () =>
      fs.existsSync(axiosLog)
        ? fs
            .readFileSync(axiosLog, "utf8")
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l))
        : [],

    // Run `aloma <args>`. `answers` = [{ when: /regex/, send: 'y\n' }] answered in order
    // when the regex shows up in stdout (for readline prompts).
    async run(args, { cwd = work, answers = [], env: extra = {}, timeoutMs = 20000 } = {}) {
      const childEnv = {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: home,
        TMPDIR: path.join(root, "tmp"),
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        TZ: "UTC",
        LANG: "en_US.UTF-8",
        ALOMA_GRAPHQL_URL: api.url,
        ALOMA_GRAPHQL_HOST: "graphql.test.invalid",
        ALOMA_ENV: "test",
        NODE_OPTIONS: `--import ${PRELOAD}`,
        TEST_AXIOS_LOG: axiosLog,
        TEST_OPEN_LOG: openLog,
        TEST_NODE: process.execPath,
        ...env,
        ...extra,
      };
      fs.mkdirSync(childEnv.TMPDIR, { recursive: true });
      return await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, ...args], {
          cwd,
          env: childEnv,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const pending = [...answers];
        let scanFrom = 0;
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`timeout running: aloma ${args.join(" ")}\n${stdout}\n${stderr}`));
        }, timeoutMs);
        child.stdout.on("data", (d) => {
          stdout += d;
          while (pending.length) {
            const rest = stdout.slice(scanFrom);
            const m = pending[0].when.exec(rest);
            if (!m) break;
            scanFrom += m.index + m[0].length;
            child.stdin.write(pending.shift().send);
            if (!pending.length) child.stdin.end();
          }
        });
        child.stderr.on("data", (d) => (stderr += d));
        child.on("close", (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal, stdout, stderr, out: stdout + stderr });
        });
        child.stdin.on("error", () => {});
        if (!answers.length) child.stdin.end();
      });
    },

    async close() {
      await api.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  return sb;
}

// test body wrapper that always cleans up
export function sandboxTest(options, fn) {
  if (typeof options === "function") {
    fn = options;
    options = undefined;
  }
  return async (t) => {
    const sb = await createSandbox(options);
    try {
      await fn(sb, t);
    } finally {
      await sb.close();
    }
  };
}
