// Test-only, loaded with --import BEFORE child-preload.mjs by preload-hooks.test.js.
// Records every call to module.register() (deprecated on Node 26, DEP0205) in ALOMA_TEST_REGISTER_LOG.
// With ALOMA_TEST_NO_REGISTER_HOOKS set it also removes module.registerHooks, to exercise the fallback.
import { appendFileSync } from "node:fs";
import mod, { syncBuiltinESMExports } from "node:module";

const log = process.env.ALOMA_TEST_REGISTER_LOG;
const real = mod.register;
mod.register = function spiedRegister(...args) {
  appendFileSync(log, "register\n");
  return real.apply(this, args);
};
if (process.env.ALOMA_TEST_NO_REGISTER_HOOKS) delete mod.registerHooks;
syncBuiltinESMExports();
