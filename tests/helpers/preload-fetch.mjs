// Test-only preload (replaces preload-axios.mjs, PLAT-117): wraps the global fetch so `company switch` never touches
// the network. A request to a *.invalid host (the harness sets ALOMA_GRAPHQL_HOST=graphql.test.invalid) is answered
// here and appended to the file named by TEST_REALM_LOG; everything else (the local GraphQL mock) goes to the real
// fetch. The answer is built from env: TEST_REALM_STATUS (default 200), TEST_REALM_HEADERS ({name: value or [values]}),
// TEST_REALM_FAIL (a network error with that message). The CLI's own src/http.js still runs in full: URL check,
// redirect handling, auth headers, status.
import fs from "node:fs";

const realFetch = globalThis.fetch;

globalThis.fetch = async (url, init = {}) => {
  if (!new URL(url).hostname.endsWith(".invalid")) return realFetch(url, init);
  fs.appendFileSync(
    process.env.TEST_REALM_LOG,
    JSON.stringify({
      url: String(url),
      method: init.method ?? "GET",
      redirect: init.redirect ?? "follow",
      headers: Object.fromEntries(new Headers(init.headers)),
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    }) + "\n",
  );
  if (process.env.TEST_REALM_FAIL) {
    throw new TypeError("fetch failed", { cause: new Error(process.env.TEST_REALM_FAIL) });
  }
  const headers = Object.entries(JSON.parse(process.env.TEST_REALM_HEADERS || "{}")).flatMap(([name, value]) =>
    [].concat(value).map((v) => [name, v]),
  );
  return new Response("{}", { status: Number(process.env.TEST_REALM_STATUS || 200), headers });
};
