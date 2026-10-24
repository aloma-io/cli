// Runs one auth/session function inside a sandboxed CLI process (see sandbox.js runDriver) and
// prints its outcome as a single "@@RESULT {json}" line.
const action = JSON.parse(process.argv[2]);
const out = (o) => process.stdout.write(`@@RESULT ${JSON.stringify(o)}\n`);

try {
  let value;
  switch (action.fn) {
    case "config": {
      const c = await import("../../src/config.js");
      value = Object.fromEntries(Object.entries(c).filter(([k]) => k !== "AUTH_PUBLIC_KEY"));
      break;
    }
    case "getSessionData": {
      const u = await import("../../src/utils.js");
      value = await u.getSessionData(action.prop ?? null);
      break;
    }
    case "updateSessionData": {
      const u = await import("../../src/utils.js");
      value = await u.updateSessionData(action.prop, action.value);
      break;
    }
    case "getStoragePath": {
      const u = await import("../../src/utils.js");
      value = await u.getStoragePath("session");
      break;
    }
    case "graphQuery": {
      const u = await import("../../src/utils.js");
      value = await u.graphQuery(action.query ?? "query { me { id } }", action.variables ?? {});
      break;
    }
    default:
      throw new Error(`unknown driver action ${action.fn}`);
  }
  out({ ok: true, value: value === undefined ? null : value });
} catch (e) {
  out({ ok: false, error: e.message, code: e.code ?? null });
}
process.exit(0);
