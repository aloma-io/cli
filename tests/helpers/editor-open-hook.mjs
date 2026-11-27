// Test-only, loaded with --import after preload-fetch.mjs: the CLI's `open` dependency is replaced by a
// stand-in that runs the "editor" script named by TEST_EDITOR_SCRIPT on the target file and waits for it.
// Unlike the shell stand-in in cli-harness.js this works on every platform.
import nodeModule from "node:module";

const FAKE = `data:text/javascript,${encodeURIComponent(`
import { spawnSync } from "node:child_process";
export default async function open(target) {
  const r = spawnSync(process.execPath, [process.env.TEST_EDITOR_SCRIPT, target], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("editor failed: " + r.status);
  return { pid: 0 };
}
`)}`;

function resolve(specifier, context, nextResolve) {
  if (specifier === "open") return { url: FAKE, shortCircuit: true };
  return nextResolve(specifier, context);
}

// module.registerHooks() exists from Node 22.15 / 23.5; before that the same resolve function is
// handed to module.register() as a hooks module.
if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({ resolve });
} else {
  const hooks = `const FAKE = ${JSON.stringify(FAKE)};\nexport ${resolve.toString()}`;
  nodeModule.register(`data:text/javascript,${encodeURIComponent(hooks)}`);
}
