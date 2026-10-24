// Loaded with --import into every CLI process the auth tests start.
// - fixed umask so file-permission assertions are deterministic
// - network guard (loopback only)
// - `open` replaced by a recorder (no browser)
// - records every server.listen() call so the tests can see which interface the callback binds
// - optionally shortens the 5-minute sign-in timeout
import { appendFileSync } from "node:fs";
import http from "node:http";
import { register } from "node:module";
import "./net-guard.js";

process.umask(0o022);

register(new URL("./open-hooks.mjs", import.meta.url).href);

const listenLog = process.env.ALOMA_TEST_LISTEN_LOG;
if (listenLog) {
  const origListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function recordedListen(...args) {
    const printable = args.filter((a) => typeof a !== "function");
    appendFileSync(listenLog, `${JSON.stringify(printable)}\n`);
    return origListen.apply(this, args);
  };
}

if (process.env.ALOMA_TEST_SHORT_AUTH_TIMEOUT) {
  const origSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = function shortTimeout(fn, ms, ...rest) {
    if (ms === 5 * 60 * 1000) ms = Number(process.env.ALOMA_TEST_SHORT_AUTH_TIMEOUT);
    return origSetTimeout(fn, ms, ...rest);
  };
}
