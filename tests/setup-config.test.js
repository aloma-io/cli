// PLAT-81: `aloma setup` (src/setup.js, src/commands/setup/index.js) writes the bundled template for the
// environment to <HOME>/.config/aloma/config.json, and src/index.js exports a fixed set of names.
// Everything runs in a throw-away HOME; nothing outside it is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sandboxTest, REPO } from "./helpers/cli-harness.js";

const template = (name) =>
  fs.readFileSync(path.join(REPO, "config", `${name}.json`), "utf8");
const mode = (p) => fs.statSync(p).mode & 0o777;

// the sandbox starts with a config.json holding "{}"; setup tests start from no configuration folder
function freshHome(sb) {
  const dir = path.join(sb.root, "home", ".config", "aloma");
  fs.rmSync(dir, { recursive: true, force: true });
  return { dir, file: path.join(dir, "config.json") };
}

test("setup: the first run creates the folder and config.json, both owner-only", sandboxTest(async (sb) => {
  const { dir, file } = freshHome(sb);
  const r = await sb.run(["setup"], { env: { ALOMA_ENV: "development" } });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /CLI configuration setup completed/);
  assert.match(r.stdout, /Aloma CLI is now configured/);
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(file), 0o600);
  assert.deepEqual(fs.readdirSync(dir), ["config.json"]);
}));

test("setup: config.json holds the bundled template as JSON indented by two spaces", sandboxTest(async (sb) => {
  const { file } = freshHome(sb);
  await sb.run(["setup"], { env: { ALOMA_ENV: "development" } });
  const written = fs.readFileSync(file, "utf8");
  assert.deepEqual(JSON.parse(written), JSON.parse(template("development")));
  assert.equal(written, JSON.stringify(JSON.parse(template("development")), null, 2));
}));

test("setup: a second run without --force leaves the file unchanged and says so", sandboxTest(async (sb) => {
  const { file } = freshHome(sb);
  await sb.run(["setup"], { env: { ALOMA_ENV: "development" } });
  fs.writeFileSync(file, '{"edited":true}');
  const r = await sb.run(["setup"], { env: { ALOMA_ENV: "development" } });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Configuration files already exist\. Use --force to overwrite\./);
  assert.match(r.stderr, /CLI configuration setup completed/);
  assert.equal(fs.readFileSync(file, "utf8"), '{"edited":true}');
}));

test("setup: --force overwrites an existing config.json (short form -f too)", sandboxTest(async (sb) => {
  const { file } = freshHome(sb);
  await sb.run(["setup"], { env: { ALOMA_ENV: "development" } });
  fs.writeFileSync(file, '{"edited":true}');
  const r = await sb.run(["setup", "--force"], { env: { ALOMA_ENV: "development" } });
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /already exist/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), JSON.parse(template("development")));
  fs.writeFileSync(file, "{}");
  assert.equal((await sb.run(["setup", "-f"], { env: { ALOMA_ENV: "development" } })).code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), JSON.parse(template("development")));
}));

test("setup: ALOMA_ENV picks the development or the production template", sandboxTest(async (sb) => {
  const { file } = freshHome(sb);
  for (const name of ["development", "production"]) {
    const r = await sb.run(["setup", "--force"], { env: { ALOMA_ENV: name } });
    assert.equal(r.code, 0);
    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(written.environment, name);
    assert.deepEqual(written, JSON.parse(template(name)));
  }
  assert.notEqual(template("development"), template("production"));
}));

test("setup: without ALOMA_ENV, NODE_ENV picks the template, and production is the default", sandboxTest(async (sb) => {
  const { file } = freshHome(sb);
  const viaNode = await sb.run(["setup", "--force"], { env: { ALOMA_ENV: "", NODE_ENV: "development" } });
  assert.equal(viaNode.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).environment, "development");
  const dflt = await sb.run(["setup", "--force"], { env: { ALOMA_ENV: "", NODE_ENV: "" } });
  assert.equal(dflt.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).environment, "production");
}));

test("setup: ALOMA_ENV wins over NODE_ENV when both are set", sandboxTest(async (sb) => {
  const { file } = freshHome(sb);
  const r = await sb.run(["setup"], { env: { ALOMA_ENV: "production", NODE_ENV: "development" } });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).environment, "production");
}));

test("setup: an unknown environment reports 'template not found' and exits 1 without writing config.json", sandboxTest(async (sb) => {
  const { dir, file } = freshHome(sb);
  const r = await sb.run(["setup"], { env: { ALOMA_ENV: "staging" } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Configuration template not found for environment: staging/);
  // once from the progress line, once from the command's own error report
  assert.equal(r.stderr.match(/Setup failed: Configuration template not found/g)?.length, 2);
  assert.doesNotMatch(r.stdout, /Aloma CLI is now configured/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(dir), true);
}));

test("setup: an unknown environment with --force leaves an existing config.json unchanged", sandboxTest(async (sb) => {
  const { file } = freshHome(sb);
  await sb.run(["setup"], { env: { ALOMA_ENV: "development" } });
  const before = fs.readFileSync(file, "utf8");
  const r = await sb.run(["setup", "--force"], { env: { ALOMA_ENV: "staging" } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Configuration template not found for environment: staging/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
}));

test("setup: an existing folder is reused and its config.json is created owner-only", sandboxTest(async (sb) => {
  const { dir, file } = freshHome(sb);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const r = await sb.run(["setup"], { env: { ALOMA_ENV: "production" } });
  assert.equal(r.code, 0);
  assert.equal(mode(file), 0o600);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).environment, "production");
}));

test("setup: XDG_CONFIG_HOME, when absolute, decides where the folder is created", sandboxTest(async (sb) => {
  freshHome(sb);
  const xdg = path.join(sb.root, "xdg");
  const r = await sb.run(["setup"], { env: { ALOMA_ENV: "development", XDG_CONFIG_HOME: xdg } });
  assert.equal(r.code, 0);
  assert.equal(mode(path.join(xdg, "aloma")), 0o700);
  assert.equal(mode(path.join(xdg, "aloma", "config.json")), 0o600);
  assert.equal(fs.existsSync(path.join(sb.root, "home", ".config", "aloma")), false);
}));

test("setup: --help describes the command and its --force option", sandboxTest(async (sb) => {
  const r = await sb.run(["setup", "--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Setup Aloma CLI configuration/);
  assert.match(r.stdout, /-f, --force\s+Force overwrite existing configuration/);
}));

// ---------------------------------------------------------------- src/index.js

test("src/index.js exports exactly these names", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aloma-index-test-"));
  try {
    // importing src/index.js runs the CLI on process.argv; "setup" with a throw-away HOME is a command that
    // returns normally, so the module finishes loading and the exports can be listed
    const script = `process.argv.push("x", "setup");
      const m = await import(${JSON.stringify(path.join(REPO, "src", "index.js"))});
      console.log("EXPORTS " + JSON.stringify(Object.keys(m).sort()));`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { PATH: process.env.PATH, HOME: home, ALOMA_ENV: "development", NO_COLOR: "1" },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    const line = r.stdout.split("\n").find((l) => l.startsWith("EXPORTS "));
    assert.deepEqual(JSON.parse(line.slice("EXPORTS ".length)), [
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
    ]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
