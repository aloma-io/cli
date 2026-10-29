// Test sandbox for the auth tests: a temporary HOME, where the CLI keeps its configuration and its
// session (<HOME>/.config/aloma/config.json and session.json), and a project directory (the cwd)
// that also holds a package tree (<project>/node_modules/@aloma.io/aloma) like the one a cloned
// repository could ship: the CLI must ignore it. A fake `npm` on PATH stops the CLI from ever
// finding the real global install. All servers bind to loopback; plain-http loopback mocks are
// allowed through ALOMA_ALLOW_HTTP_LOOPBACK=1 (never any other host).
import { spawn, execFileSync } from "node:child_process";
import { realpathSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import "./net-guard.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..");
export const CLI = path.join(REPO, "src", "cli.js");
export const DRIVER = path.join(HERE, "driver.mjs");
const PRELOAD = pathToFileURL(path.join(HERE, "child-preload.mjs")).href;

// Obvious fakes only. Each is unique so a leak can be found in any output.
export const FAKE = {
  session: "id-FAKE-SESSION-0000-test-only",
  switchedSession: "id-FAKE-SWITCHED-1111-test-only",
  accessToken: "FAKE-ACCESS-TOKEN-2222-test-only",
  refreshToken: "FAKE-REFRESH-TOKEN-3333-test-only",
  code: "FAKE-AUTH-CODE-4444-test-only",
};

export function makeSandbox({ config } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aloma-auth-test-")));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const pkgRoot = path.join(project, "node_modules", "@aloma.io", "aloma");
  const binDir = path.join(root, "bin");
  for (const d of [home, pkgRoot, binDir]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(binDir, "npm"), `#!/bin/sh\necho ${path.join(root, "no-global-root")}\n`);
  chmodSync(path.join(binDir, "npm"), 0o755);

  const configDir = path.join(home, ".config", "aloma");
  const configPath = path.join(configDir, "config.json");
  if (config !== undefined) {
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, typeof config === "string" ? config : JSON.stringify(config));
  }
  const sb = {
    root,
    home,
    project,
    pkgRoot,
    binDir,
    configDir,
    configPath,
    cacheDir: configDir,
    sessionPath: path.join(configDir, "session.json"),
    // where a cloned repository could plant a config and a session (must be ignored)
    plantedConfigPath: path.join(pkgRoot, ".config", "config.json"),
    plantedSessionPath: path.join(pkgRoot, ".cache", "session.json"),
    openLog: path.join(root, "open.log"),
    listenLog: path.join(root, "listen.log"),
    env: {
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      HOME: home,
      USERPROFILE: home,
      TMPDIR: os.tmpdir(),
      FORCE_COLOR: "0",
      NO_UPDATE_NOTIFIER: "1",
      ALOMA_ALLOW_HTTP_LOOPBACK: "1",
      ALOMA_TEST_OPEN_LOG: path.join(root, "open.log"),
      ALOMA_TEST_LISTEN_LOG: path.join(root, "listen.log"),
    },
    plant({ config: planted, session } = {}) {
      if (planted !== undefined) {
        mkdirSync(path.dirname(sb.plantedConfigPath), { recursive: true });
        writeFileSync(sb.plantedConfigPath, JSON.stringify(planted));
      }
      if (session !== undefined) {
        mkdirSync(path.dirname(sb.plantedSessionPath), { recursive: true });
        writeFileSync(sb.plantedSessionPath, JSON.stringify(session));
      }
    },
    writeSession(obj) {
      mkdirSync(sb.cacheDir, { recursive: true });
      writeFileSync(sb.sessionPath, typeof obj === "string" ? obj : JSON.stringify(obj));
    },
    readSession() {
      return existsSync(sb.sessionPath) ? JSON.parse(readFileSync(sb.sessionPath, "utf8")) : null;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
  return sb;
}

// A loopback HTTP(S) server that records every request (method, url, headers, body).
export async function startServer(handler, { host = "127.0.0.1", tls } = {}) {
  const requests = [];
  const listener = (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const rec = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(rec);
      try {
        await handler(rec, res);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
  };
  const make = () => (tls ? https.createServer(tls, listener) : http.createServer(listener));
  const servers = [make()];
  const sockets = new Set();
  servers[0].on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  // "localhost" is a second host name for the same machine, and clients disagree on which address they try first:
  // Node 18's fetch takes ::1, Node 22's takes 127.0.0.1. Listening on "localhost" binds just one of them, so bind
  // 127.0.0.1 and then ::1 on the same port (two listeners rather than "::", which is not dual-stack on every
  // host). If the machine has no IPv6 loopback, 127.0.0.1 alone is all that can be asked of it (PLAT-117).
  await new Promise((r) => servers[0].listen(0, host === "localhost" ? "127.0.0.1" : host, r));
  const port = servers[0].address().port;
  if (host === "localhost") {
    const v6 = make();
    v6.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    const bound = await new Promise((r) => {
      v6.once("error", () => r(false));
      v6.listen(port, "::1", () => r(true));
    });
    if (bound) servers.push(v6);
  }
  const shownHost = host.includes(":") ? `[${host}]` : host;
  return {
    port,
    origin: `${tls ? "https" : "http"}://${shownHost}:${port}`,
    requests,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        Promise.all(servers.map((v) => new Promise((d) => v.close(() => d())))).then(() => r());
      }),
  };
}

export function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

// A free port for the CLI's callback server. Chosen outside the OS ephemeral ranges (Linux
// 32768-60999, macOS 49152-65535) so servers other test files bind to port 0 cannot take it first.
export async function freePort() {
  for (;;) {
    const port = 20000 + Math.floor(Math.random() * 10000);
    const s = http.createServer();
    const ok = await new Promise((r) => {
      s.once("error", () => r(false));
      s.listen(port, () => r(true)); // all interfaces, as the CLI binds it
    });
    if (ok) {
      await new Promise((r) => s.close(r));
      return port;
    }
  }
}

// A throwaway self-signed certificate for localhost / 127.0.0.1, generated per run (never committed).
export function makeCert(dir) {
  const key = path.join(dir, "test-key.pem");
  const cert = path.join(dir, "test-cert.pem");
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1",
      "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  return { keyPath: key, certPath: cert, key: readFileSync(key), cert: readFileSync(cert) };
}

function run(sb, argv, { env = {}, onOpen, timeoutMs = 30000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", PRELOAD, ...argv], {
      cwd: cwd ?? sb.project,
      env: Object.fromEntries(Object.entries({ ...sb.env, ...env }).filter(([, v]) => v !== undefined)),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const browser = [];
    let seen = 0;
    const poll = setInterval(() => {
      if (!onOpen || !existsSync(sb.openLog)) return;
      const urls = readFileSync(sb.openLog, "utf8").split("\n").filter(Boolean);
      while (seen < urls.length) {
        const u = urls[seen++];
        browser.push(Promise.resolve().then(() => onOpen(u)));
      }
    }, 20);
    const killer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", reject);
    child.on("close", async (code, signal) => {
      clearInterval(poll);
      clearTimeout(killer);
      const browserResults = await Promise.allSettled(browser);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        output: stdout + stderr,
        browser: browserResults.map((r) => (r.status === "fulfilled" ? r.value : { error: r.reason })),
        opened: existsSync(sb.openLog) ? readFileSync(sb.openLog, "utf8").split("\n").filter(Boolean) : [],
        listens: existsSync(sb.listenLog)
          ? readFileSync(sb.listenLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
          : [],
      });
    });
  });
}

// Run the real CLI entry point (src/cli.js) in the sandbox.
export const runCli = (sb, args, opts) => run(sb, [CLI, ...args], opts);

// Call one exported auth/session function in a sandboxed process; returns its result too.
// `driver` runs the same driver from another copy of the package (an installed copy, for the
// legacy-session migration tests).
export async function runDriver(sb, action, { driver = DRIVER, ...opts } = {}) {
  const r = await run(sb, [driver, JSON.stringify(action)], opts);
  const line = r.stdout.split("\n").find((l) => l.startsWith("@@RESULT "));
  r.result = line ? JSON.parse(line.slice(9)) : undefined;
  r.stdout = r.stdout
    .split("\n")
    .filter((l) => !l.startsWith("@@RESULT "))
    .join("\n");
  r.output = r.stdout + r.stderr;
  return r;
}

// Does any of the fake secrets appear in the text?
export function leakedSecrets(text, secrets = Object.values(FAKE)) {
  return secrets.filter((s) => s && text.includes(s));
}
