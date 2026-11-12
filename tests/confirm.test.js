// PLAT-308: the y/N question settles on every way out, including input that ends without an answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { confirm, isYes } from "../src/confirm.js";

test("isYes: only y or yes, any case, spaces ignored", () => {
  for (const r of ["y", "yes", "Y", "YES", " Yes ", "\ty\n"]) assert.equal(isYes(r), true, JSON.stringify(r));
  for (const r of ["", "n", "yess", "yes please", " ", null, undefined]) assert.equal(isYes(r), false, JSON.stringify(r));
});

const ask = (feed) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const result = confirm("Sure? (y/N): ", { input, output });
  feed(input);
  return result;
};

test("confirm: y is true, n is false", { timeout: 3000 }, async () => {
  assert.equal(await ask((i) => i.write("y\n")), true);
  assert.equal(await ask((i) => i.write("n\n")), false);
});

test("confirm: input ended with no answer settles as false", { timeout: 3000 }, async () => {
  assert.equal(await ask((i) => i.end()), false);
});

test("confirm: an answer followed by the end of input is resolved once", { timeout: 3000 }, async () => {
  assert.equal(await ask((i) => i.end("y\n")), true);
});
