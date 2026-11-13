// Regression row 1.01, slice 8: the branches of the shared helpers that the command tests do not reach
// (pull-safety, context, runtime, paths, http, ui/select, the engine's sync failure wording and the package entry).
// Pure functions are imported directly; the cached `me` lookup and the package entry run in a child process
// against the sandbox API; nothing leaves the machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import { sandboxTest, REPO } from "./helpers/cli-harness.js";
import { pullTargetFile, headerText, oneLine, UnsafeNameError } from "../src/pull-safety.js";
import { CliError, failure, reportError } from "../src/runtime.js";
import { tighten } from "../src/paths.js";
import { request } from "../src/http.js";
import { selectFromList } from "../src/ui/select.js";

const srcUrl = (rel) => pathToFileURL(path.join(REPO, "src", rel)).href;

async function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

// ------------------------------------------------------------ pull-safety

test("pull-safety: a name part with characters Windows refuses is refused on win32 only", async () => {
  for (const name of ["a:b", "a<b", "a>b", 'a"b', "a|b", "a?b", "a*b", "ok/x:y"]) {
    await withPlatform("win32", () => {
      assert.throws(() => pullTargetFile(name, "/tmp/out"), UnsafeNameError, name);
    });
    await withPlatform("linux", () => {
      assert.ok(pullTargetFile(name, "/tmp/out").endsWith(".js"), name);
    });
  }
  await withPlatform("win32", () => {
    assert.ok(pullTargetFile("plain/name", "/tmp/out").endsWith("name.js"));
  });
});

test("pull-safety: headerText replaces comment ends and line breaks, and turns null and undefined into an empty string", () => {
  assert.equal(headerText("a */ b"), "a * / b");
  assert.equal(headerText("a\r\nb\nc\rd"), "a b c d");
  assert.equal(headerText("a b c"), "a b c");
  assert.equal(headerText("a\u2028b\u2029c"), "a b c");
  assert.equal(headerText("a b c"), "a b c");
  assert.equal(headerText(null), "");
  assert.equal(headerText(undefined), "");
  assert.equal(headerText(12), "12");
});

test("pull-safety: oneLine strips control characters and turns null and undefined into an empty string", () => {
  assert.equal(oneLine("a\u0000b\u001fc\u007fd e f"), "a b c d e f");
  assert.equal(oneLine("a\r\n\tb"), "a b");
  assert.equal(oneLine("a\u2028b\u2029c"), "a b c");
  assert.equal(oneLine(null), "");
  assert.equal(oneLine(undefined), "");
});

// ------------------------------------------------------------ runtime

test("runtime: failure returns a CliError unchanged and wraps anything else with the label and the cause", () => {
  const own = new CliError("final words");
  assert.equal(failure("Label:", own), own);

  const cause = new Error("low level");
  const wrapped = failure("Error listing things:", cause);
  assert.ok(wrapped instanceof CliError);
  assert.equal(wrapped.message, "Error listing things: low level");
  assert.equal(wrapped.cause, cause);
  assert.equal(wrapped.exitCode, 1);
});

test("runtime: failure still reads sensibly for a thrown string and for an object without a message (today's wording)", () => {
  const text = failure("Label:", "plain text");
  assert.equal(text.message, "Label: plain text");
  assert.equal(text.cause, "plain text");

  const bare = failure("Label:", {});
  assert.equal(bare.message, "Label: [object Object]");

  assert.equal(failure("Label:", null).message, "Label: null");
  assert.equal(failure("Label:", undefined).message, "Label: undefined");
});

async function captureStderr(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines.map((l) => l.replace(/\u001b\[[0-9;]*m/g, ""));
}

async function withDebug(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, "DEBUG");
  const before = process.env.DEBUG;
  if (value === undefined) delete process.env.DEBUG;
  else process.env.DEBUG = value;
  try {
    return await fn();
  } finally {
    if (had) process.env.DEBUG = before;
    else delete process.env.DEBUG;
  }
}

test("runtime: reportError prints the stack only when DEBUG is set, and prefers the cause's stack", async () => {
  const cause = new Error("inner");
  cause.stack = "CAUSE-STACK";
  const error = new CliError("outer", { cause });
  error.stack = "OWN-STACK";
  const plain = new TypeError("no cause");
  plain.stack = "PLAIN-STACK";

  const quiet = await withDebug(undefined, () => captureStderr(() => reportError(error)));
  assert.deepEqual(quiet, ["outer"]);

  const debugCause = await withDebug("1", () => captureStderr(() => reportError(error)));
  assert.deepEqual(debugCause, ["outer", "CAUSE-STACK"]);

  const debugPlain = await withDebug("1", () => captureStderr(() => reportError(plain)));
  assert.deepEqual(debugPlain, ["TypeError: no cause", "PLAIN-STACK"]);

  const thrownString = await withDebug("1", () => captureStderr(() => reportError("just text")));
  assert.deepEqual(thrownString, ["Error: just text"]);
});

// ------------------------------------------------------------ paths

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "aloma-paths-"));
const modeOf = (file) => fs.statSync(file).mode & 0o777;

test("paths: tighten does nothing on win32", async () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "f");
    fs.writeFileSync(file, "x");
    fs.chmodSync(file, 0o644);
    await withPlatform("win32", () => tighten(file, 0o600));
    assert.equal(modeOf(file), 0o644);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("paths: tighten changes the mode only when group or other bits are set", async () => {
  const dir = tmpDir();
  try {
    const wide = path.join(dir, "wide");
    const owner = path.join(dir, "owner");
    fs.writeFileSync(wide, "x");
    fs.writeFileSync(owner, "x");
    fs.chmodSync(wide, 0o640);
    fs.chmodSync(owner, 0o700);
    await tighten(wide, 0o600);
    await tighten(owner, 0o600);
    assert.equal(modeOf(wide), 0o600);
    assert.equal(modeOf(owner), 0o700, "no group or other bits: left alone");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("paths: tighten ignores a missing file and a permission refusal, and rethrows any other error", async () => {
  const dir = tmpDir();
  const original = fsp.chmod;
  try {
    await tighten(path.join(dir, "missing"), 0o600);

    const file = path.join(dir, "f");
    fs.writeFileSync(file, "x");
    fs.chmodSync(file, 0o644);

    fsp.chmod = async () => {
      throw Object.assign(new Error("not yours"), { code: "EPERM" });
    };
    await tighten(file, 0o600);

    fsp.chmod = async () => {
      throw Object.assign(new Error("disk on fire"), { code: "EIO" });
    };
    await assert.rejects(() => tighten(file, 0o600), { message: "disk on fire" });
  } finally {
    fsp.chmod = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------ http

async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("http: a failed fetch names the url and the reason, from the cause when there is one and from the error otherwise; the session is not in it", async () => {
  const url = "https://api.example.invalid/graphql";
  const session = "not-a-token";

  const withCause = await withFetch(
    async () => {
      throw new TypeError("fetch failed", { cause: new Error("connection refused") });
    },
    () => request(url, { auth: session }).catch((e) => e),
  );
  assert.equal(withCause.message, `request to ${url} failed, reason: connection refused`);
  assert.ok(withCause.cause instanceof TypeError);
  assert.ok(!withCause.message.includes(session));

  const withoutCause = await withFetch(
    async () => {
      throw new Error("own reason");
    },
    () => request(url, { auth: session }).catch((e) => e),
  );
  assert.equal(withoutCause.message, `request to ${url} failed, reason: own reason`);
  assert.ok(!withoutCause.message.includes(session));
});

// ------------------------------------------------------------ ui/select

function fakeInput() {
  const input = new EventEmitter();
  input.rawModeCalls = [];
  input.pauseCalls = 0;
  input.setRawMode = (on) => input.rawModeCalls.push(on);
  input.resume = () => {};
  input.pause = () => {
    input.pauseCalls += 1;
  };
  input.setEncoding = () => {};
  return input;
}

const items = [
  { id: "a1", name: "Alpha" },
  { id: "b2", name: "Beta" },
];

for (const [label, key] of [
  ["a pick", "\r"],
  ["a cancel", "\u0003"],
]) {
  test(`ui/select: a key press after ${label} does nothing`, async () => {
    const input = fakeInput();
    let text = "";
    const output = { write: (chunk) => ((text += chunk), true) };
    const picked = selectFromList({ title: "Pick one", items, input, output }).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    // the listener as the picker registered it, kept to call it after the picker is done
    const [handler] = input.listeners("data");
    input.emit("data", key);
    const result = await picked;
    assert.ok(result.value || result.error);

    const textAfter = text;
    const rawAfter = [...input.rawModeCalls];
    const pausesAfter = input.pauseCalls;
    for (const late of ["\u001b[B", "\u001b[A", "\r", "\u0003", "\u001b"]) handler(late);
    assert.equal(text, textAfter, "nothing more is printed");
    assert.deepEqual(input.rawModeCalls, rawAfter);
    assert.equal(input.pauseCalls, pausesAfter);
    assert.equal(input.listenerCount("data"), 0);
  });
}

// ------------------------------------------------------------ child processes in the sandbox

// Runs `script` (an ES module) with node in the sandbox's environment; resolves { code, stdout, stderr }.
function runScript(sb, script, args = []) {
  const file = path.join(sb.root, "child.mjs");
  fs.writeFileSync(file, script);
  const childEnv = {
    PATH: process.env.PATH,
    HOME: path.join(sb.root, "home"),
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    ALOMA_GRAPHQL_URL: sb.api.url,
    ALOMA_GRAPHQL_HOST: "graphql.test.invalid",
    ALOMA_ENV: "test",
    ALOMA_ALLOW_HTTP_LOOPBACK: "1",
    NODE_OPTIONS: `--import ${pathToFileURL(path.join(REPO, "tests", "helpers", "preload-fetch.mjs")).href}`,
    TEST_REALM_LOG: sb.realmLog,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: sb.work, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout\n${stdout}\n${stderr}`));
    }, 20000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const result = (r) => {
  assert.equal(r.code, 0, r.stderr);
  const line = r.stdout.split("\n").find((l) => l.startsWith("@@RESULT "));
  assert.ok(line, `no result line in: ${r.stdout}`);
  return JSON.parse(line.slice("@@RESULT ".length));
};

const attempt = `async (fn) => { try { return { value: await fn() }; } catch (e) { return { name: e.name, message: e.message }; } }`;

test("context: an answer without a `me` field gives null, no company and no companies", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", {});
  const r = await runScript(
    sb,
    `import * as ctx from ${JSON.stringify(srcUrl("context.js"))};
const out = {
  me: await ctx.getMe(),
  company: await ctx.currentCompany(),
  companies: await ctx.listCompanies(),
  region: await ctx.currentRegion(),
};
console.log("@@RESULT " + JSON.stringify(out));`,
  );
  assert.deepEqual(result(r), { me: null, company: null, companies: [], region: null });
  assert.equal(sb.api.ops().filter((o) => o === "ME_QUERY").length, 1, "asked once");
}));

test("context: a `me` without realms gives no company and no companies", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", { me: { id: "u-1" } });
  const r = await runScript(
    sb,
    `import * as ctx from ${JSON.stringify(srcUrl("context.js"))};
console.log("@@RESULT " + JSON.stringify({ company: await ctx.currentCompany(), companies: await ctx.listCompanies() }));`,
  );
  assert.deepEqual(result(r), { company: null, companies: [] });
}));

test("context: a missing list in the answer is an empty list; workspace and connector are reported as not found", sandboxTest(async (sb) => {
  sb.api.on("LIST_ENVIRONMENTS_QUERY", {});
  sb.api.on("LIST_AVAILABLE_CONNECTOR_QUERY", {});
  const r = await runScript(
    sb,
    `import * as ctx from ${JSON.stringify(srcUrl("context.js"))};
const attempt = ${attempt};
const out = {
  resolve: await attempt(() => ctx.resolveWorkspace("nope")),
  find: await attempt(() => ctx.findWorkspaceByName("nope")),
  connector: await attempt(() => ctx.resolveConnector("nope", { id: "ws-1" })),
};
console.log("@@RESULT " + JSON.stringify(out));`,
  );
  assert.deepEqual(result(r), {
    resolve: { name: "CliError", message: 'No workspace with the id or name "nope" among your workspaces.' },
    find: { value: null },
    connector: { name: "CliError", message: 'No connector with the id or name "nope" among the available connectors.' },
  });
}));

const EXPECTED_EXPORTS = [
  "AUTH_PUBLIC_KEY",
  "CLI",
  "CLIENT_ID",
  "ENVIRONMENT_NAME",
  "GRAPHQL_HOST",
  "GRAPHQL_URL",
  "JWKS_URL",
  "KEYCLOAK_REALM_URL",
  "REDIRECT_URI",
  "SCOPE",
  "SESSION_URL",
  "doEncrypt",
  "getSessionData",
  "getStoragePath",
  "graphQuery",
  "helloAloma",
  "updateSessionData",
  "urlForRegion",
];

test("package entry: exports CLI, the functions of utils.js and config.js, and helloAloma, which prints its greeting", sandboxTest(async (sb) => {
  sb.api.on("ME_QUERY", { me: { id: "u-1", realms: [] } });
  // importing the entry runs the CLI with this process's arguments: `company list` is a command that returns
  const r = await runScript(
    sb,
    `const entry = await import(${JSON.stringify(srcUrl("index.js"))});
console.log("@@RESULT " + JSON.stringify(Object.keys(entry).sort()));
entry.helloAloma();`,
    ["company", "list"],
  );
  const names = result(r);
  assert.deepEqual(names, [...EXPECTED_EXPORTS].sort());
  assert.match(r.stdout, /^Hello from the aloma-io package!$/m);
}));

// ------------------------------------------------------------ engine

const stepFile = "export const condition = { a: 1 };\n\nexport const content = async () => {\ndata.a = 1;\n};\n";
const libFile = "export const types = () => {\n  return `declare x: 1;`;\n};\n\nexport const content = () => {\nconst a = 1;\n};\n";
const YES = [{ when: /\(y\/N\): /, send: "y\n" }];

test("engine: a sync whose apply step throws reports the kind, the name and the message, and exits 1 (step)", sandboxTest(async (sb) => {
  sb.api.on("VALIDATE_IF_QUERY", { validateAutomationIf: true });
  sb.write("src/alpha.js", stepFile);
  sb.api.on("LIST_STEPS_QUERY", { listAutomationSteps: [{ id: "i-1", name: "alpha" }] });
  sb.api.on("GET_STEP_QUERY", {
    getAutomationStep: { id: "i-1", name: "alpha", enabled: true, version: 1, content: { if: "{}", do: "" } },
  });
  sb.api.on("SAVE_STEP_MUTATION", { __gqlErrors: [{ message: "backend said no" }] });
  const r = await sb.run(["step", "sync", "-s", "i-1", "-p", "src"], { answers: YES });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error updating step: alpha: backend said no\n");
  assert.doesNotMatch(r.stdout, /Successfully synced/);
}));

test("engine: a sync whose apply step throws reports the kind, the name and the message, and exits 1 (library)", sandboxTest(async (sb) => {
  sb.write("src/alpha.js", libFile);
  sb.api.on("LIST_AUTOMATION_LIBS_QUERY", { listAutomationLibs: [{ id: "i-1", name: "alpha" }] });
  sb.api.on("GET_AUTOMATION_LIB_QUERY", {
    getAutomationLib: { id: "i-1", name: "alpha", namespace: "alpha", enabled: true, tags: [], version: 1, types: "", content: { content: "" } },
  });
  sb.api.on("UPDATE_AUTOMATION_LIB_MUTATION", { __gqlErrors: [{ message: "backend said no" }] });
  const r = await sb.run(["library", "sync", "-l", "i-1", "-p", "src"], { answers: YES });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "Error updating library: alpha: backend said no\n");
  assert.doesNotMatch(r.stdout, /Successfully synced/);
}));
