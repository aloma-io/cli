// Test-only preload (PLAT-10): wraps the global fetch so a request to any non-loopback host is recorded and
// failed here, never sent. Each one is appended to TEST_OFFHOST_LOG as {url, method, authorization, cookie}
// (the tests only ever hold FAKE sessions). Loopback requests go to the real fetch.
import fs from "node:fs";
import { LOOPBACK } from "./net-guard.js";

const realFetch = globalThis.fetch;

globalThis.fetch = async (url, init = {}) => {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (LOOPBACK.has(host)) return realFetch(url, init);
  const headers = new Headers(init.headers);
  fs.appendFileSync(
    process.env.TEST_OFFHOST_LOG,
    JSON.stringify({
      url: String(url),
      method: init.method ?? "GET",
      authorization: headers.get("authorization"),
      cookie: headers.get("cookie"),
    }) + "\n",
  );
  throw new TypeError("fetch failed", { cause: new Error("test: off-host request recorded, not sent") });
};
