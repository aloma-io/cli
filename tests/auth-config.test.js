// Characterisation tests for the auth configuration (src/config.js): where the CLI finds the login
// service, the API and the session endpoint, with a present, missing or corrupt configuration.
// Only the exported values are read; nothing is contacted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { makeSandbox, runDriver, REPO } from "./helpers/sandbox.js";

let sb;
afterEach(() => sb && sb.cleanup());

const template = (env) => JSON.parse(readFileSync(path.join(REPO, "config", `${env}.json`), "utf8"));
const loadConfig = async (config, env = {}) => {
  sb = makeSandbox({ config });
  const r = await runDriver(sb, { fn: "config" }, { env });
  assert.equal(r.result.ok, true, r.output);
  return { c: r.result.value, r };
};

test("values come from <package root>/.config/config.json; the session URL sits next to GraphQL", async () => {
  const { c, r } = await loadConfig({
    keycloakRealmUrl: "http://127.0.0.1:9/realms/test",
    clientId: "graph-cli",
    redirectUri: "http://localhost:9999",
    graphqlUrl: "http://127.0.0.1:9/some/path/graphql",
    graphqlHost: "127.0.0.1:9",
  });
  assert.equal(c.KEYCLOAK_REALM_URL, "http://127.0.0.1:9/realms/test");
  assert.equal(c.CLIENT_ID, "graph-cli");
  assert.equal(c.REDIRECT_URI, "http://localhost:9999");
  assert.equal(c.GRAPHQL_URL, "http://127.0.0.1:9/some/path/graphql");
  assert.equal(c.GRAPHQL_HOST, "127.0.0.1:9");
  assert.equal(c.SESSION_URL, "http://127.0.0.1:9/oauth2/cli/session", "path is replaced, host kept");
  assert.equal(c.SCOPE, "openid profile email groups", "default scope");
  assert.equal(r.output.trim(), "", "no warning when configured");
});

test("an explicit sessionUrl in the configuration is used as-is", async () => {
  const { c } = await loadConfig({ graphqlUrl: "http://127.0.0.1:9/graphql", sessionUrl: "http://127.0.0.1:8/x" });
  assert.equal(c.SESSION_URL, "http://127.0.0.1:8/x");
});

test("ALOMA_* environment variables override the configuration file", async () => {
  const { c } = await loadConfig(
    { keycloakRealmUrl: "http://127.0.0.1:9/a", graphqlUrl: "http://127.0.0.1:9/graphql", clientId: "file" },
    {
      ALOMA_KEYCLOAK_REALM_URL: "http://127.0.0.1:7/b",
      ALOMA_CLIENT_ID: "env-client",
      ALOMA_REDIRECT_URI: "http://localhost:7777",
      ALOMA_SCOPE: "openid",
      ALOMA_GRAPHQL_URL: "http://127.0.0.1:7/graphql",
      ALOMA_GRAPHQL_HOST: "127.0.0.1:7",
      ALOMA_JWKS_URL: "http://127.0.0.1:7/certs",
    },
  );
  assert.equal(c.KEYCLOAK_REALM_URL, "http://127.0.0.1:7/b");
  assert.equal(c.CLIENT_ID, "env-client");
  assert.equal(c.REDIRECT_URI, "http://localhost:7777");
  assert.equal(c.SCOPE, "openid");
  assert.equal(c.GRAPHQL_URL, "http://127.0.0.1:7/graphql");
  assert.equal(c.GRAPHQL_HOST, "127.0.0.1:7");
  assert.equal(c.JWKS_URL, "http://127.0.0.1:7/certs");
  assert.equal(c.SESSION_URL, "http://127.0.0.1:7/oauth2/cli/session", "derived from the overriding GraphQL URL");
  const { c: c2 } = await loadConfig({ graphqlUrl: "http://127.0.0.1:9/graphql" }, { ALOMA_SESSION_URL: "http://127.0.0.1:6/s" });
  assert.equal(c2.SESSION_URL, "http://127.0.0.1:6/s");
});

test("missing configuration: falls back to the production template, with a warning", async () => {
  const { c, r } = await loadConfig(undefined);
  const t = template("production");
  assert.match(r.stderr, /Using template configuration for production environment\./);
  assert.match(r.stderr, /Run "aloma setup" to configure the CLI properly\./);
  assert.equal(c.KEYCLOAK_REALM_URL, t.keycloakRealmUrl);
  assert.equal(c.GRAPHQL_URL, t.graphqlUrl);
  assert.equal(c.CLIENT_ID, t.clientId);
  assert.equal(c.SESSION_URL, new URL("/oauth2/cli/session", t.graphqlUrl).toString());
});

test("ALOMA_ENV picks the template used when there is no configuration", async () => {
  const { c, r } = await loadConfig(undefined, { ALOMA_ENV: "development" });
  assert.match(r.stderr, /Using template configuration for development environment\./);
  assert.equal(c.GRAPHQL_URL, template("development").graphqlUrl);
  assert.equal(c.ENVIRONMENT_NAME, "development");
});

// PINS SUSPECT BEHAVIOUR: a corrupt configuration file is treated exactly like a missing one: the
// CLI silently switches to the production template (only the generic warning is shown).
test("PINS SUSPECT BEHAVIOUR: a corrupt configuration silently falls back to the production template", async () => {
  const { c, r } = await loadConfig("{corrupt", { ALOMA_ENV: "" });
  assert.match(r.stderr, /Using template configuration for production environment\./);
  assert.doesNotMatch(r.output, /corrupt|JSON|Unexpected/i);
  assert.equal(c.GRAPHQL_URL, template("production").graphqlUrl);
});

test("no configuration and no template: built-in defaults; no API or session URL", async () => {
  const { c, r } = await loadConfig(undefined, { ALOMA_ENV: "no-such-env" });
  assert.match(r.stderr, /No configuration found\. Run "aloma setup" to configure the CLI\./);
  assert.equal(c.KEYCLOAK_REALM_URL, "");
  assert.equal(c.GRAPHQL_URL, "");
  assert.equal(c.SESSION_URL, "");
  assert.equal(c.CLIENT_ID, "graph", "built-in default differs from the templates' graph-cli");
  assert.equal(c.REDIRECT_URI, "http://localhost:8989");
  assert.equal(c.JWKS_URL, "https://accounts.aloma.io/realms/master/protocol/openid-connect/certs");
});
