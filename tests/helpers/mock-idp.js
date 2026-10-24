// A loopback stand-in for the login service (Keycloak-style OpenID Connect provider) and for the
// Aloma API (session exchange + GraphQL). Everything is fake and test-only: keys are generated per
// run, tokens are the FAKE values from sandbox.js.
import { createHash, randomBytes } from "node:crypto";
import * as jose from "jose";
import { startServer, json, FAKE } from "./sandbox.js";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export async function startMockIdp({ clientId = "graph-cli", discovery = true } = {}) {
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const codes = new Map();
  const ctl = {
    discovery,
    tokenStatus: 200,
    includeIdToken: true,
    includeAccessToken: true,
    idTokenOverrides: {},
    issued: [],
  };
  const realmPath = "/realms/test";
  let issuer;

  const srv = await startServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === `${realmPath}/.well-known/openid-configuration`) {
      if (!ctl.discovery) return json(res, 404, { error: "not found" });
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        userinfo_endpoint: `${issuer}/protocol/openid-connect/userinfo`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (u.pathname.endsWith("/.well-known/oauth-authorization-server")) return json(res, 404, {});
    if (u.pathname === `${realmPath}/protocol/openid-connect/certs`) return json(res, 200, { keys: [jwk] });
    if (u.pathname === `${realmPath}/protocol/openid-connect/logout`) {
      res.writeHead(204);
      return res.end();
    }
    if (u.pathname === `${realmPath}/protocol/openid-connect/token` && req.method === "POST") {
      const form = new URLSearchParams(req.body);
      const grant = codes.get(form.get("code"));
      if (!grant) return json(res, 400, { error: "invalid_grant" });
      const challenge = b64url(createHash("sha256").update(form.get("code_verifier") || "").digest());
      if (challenge !== grant.codeChallenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE" });
      if (form.get("redirect_uri") !== grant.redirectUri) return json(res, 400, { error: "invalid_grant" });
      if (ctl.tokenStatus !== 200) return json(res, ctl.tokenStatus, { error: "server_error" });
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new jose.SignJWT({
        nonce: grant.nonce,
        email: "someone@example.test",
        ...ctl.idTokenOverrides,
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(ctl.idTokenOverrides.iss ?? issuer)
        .setAudience(clientId)
        .setSubject("fake-user-1")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);
      ctl.issued.push(idToken);
      const body = { token_type: "Bearer", expires_in: 300, refresh_token: FAKE.refreshToken };
      if (ctl.includeAccessToken) body.access_token = FAKE.accessToken;
      if (ctl.includeIdToken) body.id_token = idToken;
      return json(res, 200, body);
    }
    return json(res, 404, { error: "not found" });
  });
  issuer = `${srv.origin}${realmPath}`;

  return {
    ...srv,
    issuer,
    ctl,
    // Act as the login page: accept the authorization request and return the redirect the browser
    // would follow back to the CLI.
    authorize(authUrl, { state, extra = {} } = {}) {
      const a = new URL(authUrl);
      const p = a.searchParams;
      const code = `${FAKE.code}-${randomBytes(4).toString("hex")}`;
      codes.set(code, {
        codeChallenge: p.get("code_challenge"),
        nonce: p.get("nonce"),
        redirectUri: p.get("redirect_uri"),
      });
      const cb = new URL(p.get("redirect_uri"));
      cb.searchParams.set("code", code);
      cb.searchParams.set("state", state ?? p.get("state"));
      for (const [k, v] of Object.entries(extra)) cb.searchParams.set(k, v);
      return cb.toString();
    },
  };
}

// The Aloma API: POST /oauth2/cli/session (ID token -> session) and POST /graphql.
export async function startMockApi({ sessionToken = FAKE.session } = {}) {
  const ctl = {
    sessionStatus: 200,
    sessionBody: () => ({ token: sessionToken }),
    graphql: (q) => {
      if (q.includes("listAutomationEnvironmentWithStats"))
        return { data: { listAutomationEnvironmentWithStats: [{ id: "ws-fake-1", name: "Fake Workspace" }] } };
      if (q.includes("me"))
        return {
          data: {
            me: {
              id: "u1",
              realm: { id: "realm-a", region: null },
              realms: [
                { id: "realm-a", name: "Fake Company A" },
                { id: "realm-b", name: "Fake Company B" },
              ],
            },
          },
        };
      return { data: {} };
    },
  };
  const srv = await startServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/oauth2/cli/session" && req.method === "POST") {
      if (ctl.sessionStatus !== 200) return json(res, ctl.sessionStatus, { error: ctl.sessionStatus });
      return json(res, 200, ctl.sessionBody(JSON.parse(req.body || "{}")));
    }
    if (u.pathname === "/graphql" && req.method === "POST") {
      const { query } = JSON.parse(req.body || "{}");
      const out = ctl.graphql(query, req);
      if (out && out.__raw) {
        res.writeHead(out.status, out.headers || {});
        return res.end(out.body);
      }
      return json(res, 200, out);
    }
    return json(res, 404, { error: "not found" });
  });
  return { ...srv, ctl, graphqlUrl: `${srv.origin}/graphql` };
}
