import net from "node:net";

const loopback = (host) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof normalized[0] === "object" ? normalized[0]
    : { host: typeof normalized[1] === "string" ? normalized[1] : "localhost" };
  if (options.path || !loopback(options.host || "localhost")) {
    throw new Error("CI tests prohibit non-loopback network connections.");
  }
  return connect.apply(this, args);
};
const fetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!loopback(url.hostname)) throw new Error("CI tests prohibit non-loopback fetch.");
  return fetch(input, init);
};
