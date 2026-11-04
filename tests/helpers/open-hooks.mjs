// Module resolution hook (test only): the CLI's `open` dependency (which launches a browser) is
// replaced with fake-open.mjs, which records the URL instead. Synchronous, so the same function serves
// module.registerHooks() and (as a hooks module) the module.register() fallback.
const FAKE_OPEN = new URL("./fake-open.mjs", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "open") return { url: FAKE_OPEN, shortCircuit: true };
  return nextResolve(specifier, context);
}
