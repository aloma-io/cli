import { postJson } from "../../http.js";

// The API's sign-in endpoint for the CLI lives next to its GraphQL endpoint.
export function sessionUrlFor(graphqlUrl) {
  return new URL("/oauth2/cli/session", graphqlUrl).toString();
}

// Hands the ID token from the login service to the API and returns the session it issues.
export async function exchangeIdTokenForSession({ idToken, url }) {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("No ID token received from the login service");
  }

  // https only; a redirect is refused, so the ID token is never resent elsewhere (src/http.js)
  const response = await postJson(
    url,
    { id_token: idToken },
    {
      headers: { Accept: "application/json", "User-Agent": "Aloma CLI" },
      what: "Aloma sign-in",
    },
  );

  if (!response.ok) {
    throw new Error(`Aloma sign-in was not accepted (${response.status})`);
  }

  const data = await response.json().catch(() => ({}));
  if (typeof data.token !== "string" || !data.token.startsWith("id-")) {
    throw new Error("Aloma sign-in returned no session");
  }

  return data.token;
}
