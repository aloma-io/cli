// Stand-in for the `open` package in CLI processes started by the tests: records the URL the CLI
// would have opened in the browser. Never launches anything.
import { appendFileSync } from "node:fs";

export default async function open(target) {
  const log = process.env.ALOMA_TEST_OPEN_LOG;
  if (!log) throw new Error("fake-open: ALOMA_TEST_OPEN_LOG not set");
  appendFileSync(log, `${target}\n`);
  return { pid: 0, unref() {}, on() {} };
}
