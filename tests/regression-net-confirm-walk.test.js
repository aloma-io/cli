// Regression checks for four small shared modules: the transport rules, the y/N prompt, the package
// version and the .js file walker. They are otherwise reached only through other code.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertSecureUrl,
  isLoopbackHost,
  refuseRedirect,
} from "../src/net-security.js";
import { getPackageVersion } from "../src/package-utils.js";
import { walkJsFiles } from "../src/walk.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withEnv(value, fn) {
  const saved = process.env.ALOMA_ALLOW_HTTP_LOOPBACK;
  try {
    if (value === undefined) delete process.env.ALOMA_ALLOW_HTTP_LOOPBACK;
    else process.env.ALOMA_ALLOW_HTTP_LOOPBACK = value;
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.ALOMA_ALLOW_HTTP_LOOPBACK;
    else process.env.ALOMA_ALLOW_HTTP_LOOPBACK = saved;
  }
}

test("isLoopbackHost accepts localhost, ::1, [::1] and 127.x.y.z", () => {
  for (const h of [
    "localhost",
    "::1",
    "[::1]",
    "127.0.0.1",
    "127.1.2.3",
    "127.255.255.255",
  ]) {
    assert.equal(isLoopbackHost(h), true, h);
  }
});

test("isLoopbackHost refuses look-alike hosts and an empty string", () => {
  for (const h of [
    "127.0.0.1.evil.example",
    "localhost.evil.example",
    "128.0.0.1",
    "",
  ]) {
    assert.equal(isLoopbackHost(h), false, JSON.stringify(h));
  }
});

test("assertSecureUrl returns the parsed URL for https", async () => {
  await withEnv(undefined, () => {
    const u = assertSecureUrl("https://api.example.test:8443/path?q=1");
    assert.ok(u instanceof URL);
    assert.equal(u.protocol, "https:");
    assert.equal(u.host, "api.example.test:8443");
    assert.equal(u.pathname, "/path");
  });
});

test("assertSecureUrl refuses a non-absolute string, naming the default or a custom label", async () => {
  await withEnv(undefined, () => {
    assert.throws(() => assertSecureUrl("not a url"), {
      message: "The API URL is not an absolute URL",
    });
    assert.throws(() => assertSecureUrl("/just/a/path", "session URL"), {
      message: "The session URL is not an absolute URL",
    });
  });
});

test("assertSecureUrl refuses plain http, naming the host and the label", async () => {
  await withEnv(undefined, () => {
    assert.throws(() => assertSecureUrl("http://api.example.test"), {
      message:
        "Refusing to send credentials to http://api.example.test: the API URL must use https",
    });
    assert.throws(
      () => assertSecureUrl("http://api.example.test:81", "login URL"),
      {
        message:
          "Refusing to send credentials to http://api.example.test:81: the login URL must use https",
      },
    );
  });
});

test("assertSecureUrl allows http on loopback only when ALOMA_ALLOW_HTTP_LOOPBACK is exactly 1", async () => {
  await withEnv("1", () => {
    assert.equal(assertSecureUrl("http://127.0.0.1:3000").protocol, "http:");
    assert.equal(
      assertSecureUrl("http://localhost:3000").host,
      "localhost:3000",
    );
    assert.equal(assertSecureUrl("http://[::1]:3000").protocol, "http:");
  });
  for (const value of ["true", "0", "", "yes", undefined]) {
    await withEnv(value, () => {
      assert.throws(
        () => assertSecureUrl("http://127.0.0.1:3000"),
        /must use https/,
        String(value),
      );
    });
  }
});

test("assertSecureUrl refuses http on a non-loopback host even with the variable set", async () => {
  await withEnv("1", () => {
    assert.throws(
      () => assertSecureUrl("http://api.example.test"),
      /Refusing to send .* to http:\/\/api.example.test/,
    );
    assert.throws(
      () => assertSecureUrl("http://127.0.0.1.evil.example"),
      /must use https/,
    );
  });
});

test("assertSecureUrl refuses ftp and other schemes, even with the variable set", async () => {
  await withEnv("1", () => {
    for (const url of [
      "ftp://localhost/file",
      "ws://localhost",
      "file:///etc/hosts",
    ]) {
      assert.throws(() => assertSecureUrl(url), /must use https/, url);
    }
  });
});

test("refuseRedirect throws for 301, 302, 307 and 308 naming the default or given label", () => {
  for (const status of [301, 302, 307, 308]) {
    assert.throws(
      () => refuseRedirect(status),
      (e) =>
        e.message.startsWith(`The API answered with a redirect (${status})`),
      String(status),
    );
    assert.throws(
      () => refuseRedirect(status, "session service"),
      (e) =>
        e.message.startsWith(
          `The session service answered with a redirect (${status})`,
        ),
    );
  }
});

test("refuseRedirect does nothing for 200, 204, 299, 400 and 500", () => {
  for (const status of [200, 204, 299, 400, 500]) {
    assert.equal(refuseRedirect(status), undefined, String(status));
  }
});

function ask(answer) {
  const code = `import { confirm } from ${JSON.stringify(new URL("../src/confirm.js", import.meta.url).href)};
const yes = await confirm("Proceed with it? ");
process.stdout.write("\\nRESULT=" + yes + "\\n");`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    input: answer + "\n",
    encoding: "utf8",
    cwd: REPO,
    timeout: 30000,
  });
  assert.equal(run.status, 0, run.stderr);
  return {
    yes: /RESULT=(true|false)/.exec(run.stdout)?.[1] === "true",
    stdout: run.stdout,
  };
}

test("confirm: y, yes, Y, YES and ' yes ' are a yes", () => {
  for (const a of ["y", "yes", "Y", "YES", " yes "])
    assert.equal(ask(a).yes, true, JSON.stringify(a));
});

test("confirm: n, no, an empty answer, yeah and 'yes please' are a no", () => {
  for (const a of ["n", "no", "", "yeah", "yes please"])
    assert.equal(ask(a).yes, false, JSON.stringify(a));
});

test("confirm writes the question to stdout", () => {
  assert.ok(ask("y").stdout.includes("Proceed with it? "));
});

test("getPackageVersion returns the version field of package.json", () => {
  const expected = JSON.parse(
    readFileSync(path.join(REPO, "package.json"), "utf8"),
  ).version;
  const got = getPackageVersion();
  assert.equal(typeof got, "string");
  assert.ok(got.length > 0);
  assert.equal(got, expected);
});

function withTree(fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), "walk-test-"));
  return Promise.resolve()
    .then(() => fn(root))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}

const byRel = (a, b) =>
  a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;

test("walkJsFiles finds .js files at every depth, with absolute and relative paths", () =>
  withTree(async (root) => {
    mkdirSync(path.join(root, "a", "b"), { recursive: true });
    writeFileSync(path.join(root, "top.js"), "");
    writeFileSync(path.join(root, "a", "mid.js"), "");
    writeFileSync(path.join(root, "a", "b", "deep.js"), "");
    const got = (await walkJsFiles(root)).sort(byRel);
    assert.deepEqual(got, [
      {
        absPath: path.join(root, "a", "b", "deep.js"),
        relPath: path.join("a", "b", "deep.js"),
      },
      {
        absPath: path.join(root, "a", "mid.js"),
        relPath: path.join("a", "mid.js"),
      },
      { absPath: path.join(root, "top.js"), relPath: "top.js" },
    ]);
    const nested = (await walkJsFiles(path.join(root, "a"), root)).sort(byRel);
    assert.deepEqual(
      nested.map((f) => f.relPath),
      [path.join("a", "b", "deep.js"), path.join("a", "mid.js")],
    );
    const own = (await walkJsFiles(path.join(root, "a"))).sort(byRel);
    assert.deepEqual(
      own.map((f) => f.relPath),
      [path.join("b", "deep.js"), "mid.js"],
    );
  }));

test("walkJsFiles ignores other extensions and a folder named x.js", () =>
  withTree(async (root) => {
    for (const name of ["m.mjs", "d.json", "s.js.map", "readme.md"])
      writeFileSync(path.join(root, name), "");
    mkdirSync(path.join(root, "x.js"));
    assert.deepEqual(await walkJsFiles(root), []);
    writeFileSync(path.join(root, "x.js", "inner.js"), "");
    assert.deepEqual(
      (await walkJsFiles(root)).map((f) => f.relPath),
      [path.join("x.js", "inner.js")],
    );
  }));

test("walkJsFiles returns [] for an empty folder and rejects for a missing one", () =>
  withTree(async (root) => {
    assert.deepEqual(await walkJsFiles(root), []);
    await assert.rejects(walkJsFiles(path.join(root, "missing")), {
      code: "ENOENT",
    });
  }));
