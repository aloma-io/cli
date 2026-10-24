import fetch from "node-fetch";
import { assertSecureUrl, refuseRedirect } from "../../net-security.js";

// The API's sign-in endpoint for the CLI lives next to its GraphQL endpoint.
export function sessionUrlFor(graphqlUrl) {
  return new URL("/oauth2/cli/session", graphqlUrl).toString();
}

// Hands the ID token from the login service to the API and returns the session it issues.
export async function exchangeIdTokenForSession({ idToken, url }) {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("No ID token received from the login service");
  }

  assertSecureUrl(url, "sign-in URL");
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual", // never resend the ID token to a redirect target
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Aloma CLI",
    },
    body: JSON.stringify({ id_token: idToken }),
  });
  refuseRedirect(response.status, "Aloma sign-in");

  if (!response.ok) {
    throw new Error(`Aloma sign-in was not accepted (${response.status})`);
  }

  const data = await response.json().catch(() => ({}));
  if (typeof data.token !== "string" || !data.token.startsWith("id-")) {
    throw new Error("Aloma sign-in returned no session");
  }

  return data.token;
}
