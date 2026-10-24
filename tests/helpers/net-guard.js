// Test-only network guard: the auth tests must never reach a real host. Every DNS lookup and every
// socket connect to anything but the loopback interface throws. Installed in the test process and,
// through child-preload.mjs, in every CLI process the tests start.
import dns from "node:dns";
import net from "node:net";

export const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function blocked(host) {
  const err = new Error(`test network guard: blocked connection to non-loopback host "${host}"`);
  err.code = "ETESTBLOCKED";
  return err;
}

export function installNetGuard() {
  if (globalThis.__alomaNetGuard) return;
  globalThis.__alomaNetGuard = true;

  const origLookup = dns.lookup;
  dns.lookup = function guardedLookup(host, ...rest) {
    if (!LOOPBACK.has(host)) {
      const cb = rest.at(-1);
      if (typeof cb === "function") {
        process.nextTick(() => cb(blocked(host)));
        return {};
      }
      throw blocked(host);
    }
    return origLookup.call(this, host, ...rest);
  };

  const origPromiseLookup = dns.promises.lookup;
  dns.promises.lookup = async function guardedPromiseLookup(host, ...rest) {
    if (!LOOPBACK.has(host)) throw blocked(host);
    return origPromiseLookup.call(this, host, ...rest);
  };

  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    let opts = args[0];
    if (Array.isArray(opts)) opts = opts[0]; // net.connect passes normalised args
    let host;
    if (opts && typeof opts === "object") {
      if (opts.path) return origConnect.apply(this, args); // unix socket / pipe
      host = opts.host ?? "localhost";
    } else {
      host = typeof args[1] === "string" ? args[1] : "localhost";
    }
    if (!LOOPBACK.has(host)) throw blocked(host);
    return origConnect.apply(this, args);
  };
}

installNetGuard();
