// Loaded with --import into every CLI process the auth tests start.
// - fixed umask so file-permission assertions are deterministic
// - network guard (loopback only)
// - `open` replaced by a recorder (no browser)
// - records every server.listen() call so the tests can see which interface the callback binds
// - optionally shortens the 5-minute sign-in timeout
import { appendFileSync } from "node:fs";
import http from "node:http";
import nodeModule from "node:module";
import "./net-guard.js";
import { resolve } from "./open-hooks.mjs";

process.umask(0o022);

// module.register() is deprecated from Node 26 (DEP0205) and prints a warning into the child's output;
// module.registerHooks() (Node 22.15+, 23.5+) is its synchronous replacement. The fallback is only
// reached on Node 22.0-22.14 and 23.0-23.4.
if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({ resolve });
} else {
  nodeModule.register(new URL("./open-hooks.mjs", import.meta.url).href);
}

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
