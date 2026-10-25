// Transport rules for every call that carries an ID token or the Aloma session.
//
// - Only https URLs are used. Plain http is accepted for a loopback host (localhost, 127.x, ::1)
//   and only when ALOMA_ALLOW_HTTP_LOOPBACK=1 is set, for local development against a local API.
// - Redirects are never followed: a 3xx answer is an error. So the credentials only ever go to the
//   configured origin (scheme, host and port), not to another host or another port on the same host.

export function isLoopbackHost(hostname) {
  const h = String(hostname).replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}

export function assertSecureUrl(url, what = "API URL") {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`The ${what} is not an absolute URL`);
  }
  if (u.protocol === "https:") return u;
  if (
    u.protocol === "http:" &&
    process.env.ALOMA_ALLOW_HTTP_LOOPBACK === "1" &&
    isLoopbackHost(u.hostname)
  ) {
    return u;
  }
  throw new Error(
    `Refusing to send credentials to ${u.protocol}//${u.host}: the ${what} must use https`,
  );
}

export function refuseRedirect(status, what = "API") {
  if (status >= 300 && status < 400) {
    throw new Error(
      `The ${what} answered with a redirect (${status}); the CLI does not follow redirects with your credentials`,
    );
  }
}
