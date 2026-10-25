// Test-only preload: replaces axios.post so `company switch` never touches the network.
// Every call is appended to the file named by TEST_AXIOS_LOG; the reply is built from env.
import axios from "axios";
import fs from "fs";

axios.post = async (url, body, config) => {
  fs.appendFileSync(
    process.env.TEST_AXIOS_LOG,
    JSON.stringify({ url, body, config }) + "\n",
  );
  if (process.env.TEST_AXIOS_FAIL) {
    throw new Error(process.env.TEST_AXIOS_FAIL);
  }
  return {
    headers: JSON.parse(process.env.TEST_AXIOS_HEADERS || "{}"),
    data: {},
  };
};

// Network guard: any socket connection to a host other than loopback fails loudly.
import net from "node:net";
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = args[0];
  const host = typeof o === "object" && o !== null ? o.host : typeof args[1] === "string" ? args[1] : undefined;
  if (host && !["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`TEST GUARD: blocked non-local connection to ${host}`);
  }
  return realConnect.apply(this, args);
};
