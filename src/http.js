// The CLI's one HTTP client (PLAT-117). Every request the CLI makes itself goes through here, so the transport
// rules in net-security.js hold by construction, not by each call site remembering them:
// - the URL is checked (https only, see assertSecureUrl) before anything is sent;
// - redirects are never followed: a 3xx answer is an error (see refuseRedirect);
// - the session (`auth`) is attached here, to this one request only, as a bearer header and the cookie the API reads.
// Built on Node's own fetch. The sign-in library (openid-client) keeps its own stack.
import { GRAPHQL_URL } from "./config.js";
import { assertSecureUrl, refuseRedirect } from "./net-security.js";

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Cookie: `Authorization=Bearer%20${encodeURIComponent(token)}`,
});

// Send one request; returns the Response (any non-redirect status). `what` names the service in errors.
export async function request(url, { method = "GET", headers = {}, body, auth, what = "API" } = {}) {
  assertSecureUrl(url, `${what} URL`);
  let response;
  try {
    response = await fetch(url, {
      method,
      redirect: "manual",
      headers: auth ? { ...headers, ...authHeaders(auth) } : headers,
      body,
    });
  } catch (error) {
    // fetch says only "fetch failed"; the reason (refused connection, untrusted certificate) is in the cause.
    throw error.cause instanceof Error ? new Error(error.cause.message, { cause: error }) : error;
  }
  refuseRedirect(response.status, what);
  return response;
}

export function postJson(url, body, { headers = {}, ...options } = {}) {
  return request(url, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// One GraphQL operation against the API; returns its data, or throws its errors joined one per line.
export async function graphql(query, variables = {}, { auth, url = GRAPHQL_URL } = {}) {
  const response = await postJson(url, { query, variables }, { auth });
  const data = await response.json();
  if (data.errors) {
    throw new Error(data.errors.map((error) => error.message).join("\n"));
  }
  return data.data;
}
