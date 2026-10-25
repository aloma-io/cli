// Module resolution hook (test only): the CLI's `open` dependency (which launches a browser) is
// replaced with fake-open.mjs, which records the URL instead.
const FAKE_OPEN = new URL("./fake-open.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "open") return { url: FAKE_OPEN, shortCircuit: true };
  return nextResolve(specifier, context);
}
