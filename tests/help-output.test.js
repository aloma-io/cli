// PLAT-119: the help text of the program, of every command group and of every command is the same as
// before each command group registered itself (tests/fixtures/help-output.txt, captured from the earlier layout).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO } from "./helpers/cli-harness.js";

const help = (args) =>
  spawnSync(process.execPath, ["src/cli.js", ...args, "--help"], {
    cwd: REPO,
    encoding: "utf8",
  }).stdout;

const commandNames = (text) => {
  const at = text.indexOf("\nCommands:\n");
  if (at < 0) return [];
  return text
    .slice(at + 11)
    .split("\n")
    .filter((line) => /^  \S/.test(line))
    .map((line) => line.trim().split(/[ |]/)[0])
    .filter((name) => name !== "help");
};

test("aloma --help, every group's help and every command's help are unchanged", () => {
  let actual = "";
  const walk = (parts) => {
    actual += `=== aloma ${parts.join(" ")}${parts.length ? " " : ""}--help\n${help(parts)}`;
    for (const name of commandNames(help(parts))) walk([...parts, name]);
  };
  walk([]);
  const expected = fs.readFileSync(
    path.join(REPO, "tests", "fixtures", "help-output.txt"),
    "utf8",
  );
  assert.equal(actual, expected);
});
