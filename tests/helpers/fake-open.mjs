// Stand-in for the `open` package in CLI processes started by the tests: records the URL the CLI
// would have opened in the browser. Never launches anything. With ALOMA_TEST_OPEN_FAILS set, it
// records the URL and then fails, as `open` does when no browser can be started.
import { appendFileSync } from "node:fs";

export default async function open(target) {
  const log = process.env.ALOMA_TEST_OPEN_LOG;
  if (!log) throw new Error("fake-open: ALOMA_TEST_OPEN_LOG not set");
  appendFileSync(log, `${target}\n`);
  if (process.env.ALOMA_TEST_OPEN_FAILS) throw new Error("fake-open: no browser available");
  return { pid: 0, unref() {}, on() {} };
}
