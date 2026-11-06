// PLAT-119: the one arrow-key picker (src/ui/select.js), driven by a fake input stream. Whatever way the
// picker ends (a pick, a cancel with Escape or Ctrl-C, or an error), raw mode is off and input is paused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { selectFromList } from "../src/ui/select.js";
import { CliError } from "../src/runtime.js";

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const ENTER = "\r";
const CTRL_C = "\u0003";
const ESCAPE = "\u001b";

function fakeInput({ failRawMode = false } = {}) {
  const input = new EventEmitter();
  input.rawMode = false;
  input.paused = true;
  input.rawModeCalls = [];
  input.setRawMode = (on) => {
    input.rawModeCalls.push(on);
    if (failRawMode) throw new Error("no raw mode here");
    input.rawMode = on;
  };
  input.resume = () => {
    input.paused = false;
  };
  input.pause = () => {
    input.paused = true;
  };
  input.setEncoding = () => {};
  return input;
}

function fakeOutput() {
  return {
    text: "",
    write(chunk) {
      this.text += chunk;
      return true;
    },
  };
}

const items = [
  { id: "a1", name: "Alpha" },
  { id: "b2", name: "Beta" },
  { id: "c3", name: "Gamma" },
];

const start = (input, extra = {}) => {
  const output = fakeOutput();
  const picked = selectFromList({
    title: "Select a thing to switch to:",
    items,
    input,
    output,
    ...extra,
  });
  return { picked, output };
};

const assertTerminalRestored = (input) => {
  assert.equal(input.rawMode, false, "raw mode is off");
  assert.equal(input.paused, true, "input is paused");
  assert.equal(input.listenerCount("data"), 0, "no key listener is left");
};

test("the picker puts the terminal into raw mode while it waits", async () => {
  const input = fakeInput();
  const { picked } = start(input);
  assert.equal(input.rawMode, true);
  assert.equal(input.paused, false);
  input.emit("data", ENTER);
  await picked;
});

test("Enter picks the first item; arrows move the choice; the terminal is restored", async () => {
  const input = fakeInput();
  const first = start(input);
  input.emit("data", ENTER);
  assert.deepEqual(await first.picked, items[0]);
  assertTerminalRestored(input);

  const second = fakeInput();
  const moved = start(second);
  second.emit("data", DOWN);
  second.emit("data", DOWN);
  second.emit("data", UP);
  second.emit("data", ENTER);
  assert.deepEqual(await moved.picked, items[1]);
  assertTerminalRestored(second);
});

test("the choice wraps around at both ends", async () => {
  const up = fakeInput();
  const a = start(up);
  up.emit("data", UP);
  up.emit("data", ENTER);
  assert.deepEqual(await a.picked, items[2]);

  const down = fakeInput();
  const b = start(down, { currentId: "c3" });
  down.emit("data", DOWN);
  down.emit("data", ENTER);
  assert.deepEqual(await b.picked, items[0]);
});

test("the current item starts selected and is marked", async () => {
  const input = fakeInput();
  const { picked, output } = start(input, { currentId: "b2" });
  assert.match(output.text, /\[current\]/);
  input.emit("data", ENTER);
  assert.deepEqual(await picked, items[1]);
});

test("the screen shows the title, the items with their ids, and the pick", async () => {
  const input = fakeInput();
  const { picked, output } = start(input);
  input.emit("data", ENTER);
  await picked;
  assert.match(output.text, /Select a thing to switch to:/);
  assert.match(output.text, /Alpha/);
  assert.match(output.text, /\(ID: c3\)/);
  assert.match(output.text, /Selected: Alpha/);
});

test("Ctrl-C cancels with a CliError and restores the terminal", async () => {
  const input = fakeInput();
  const { picked } = start(input);
  input.emit("data", CTRL_C);
  await assert.rejects(picked, (e) => {
    assert.ok(e instanceof CliError);
    assert.equal(e.message, "\nSelection cancelled.");
    return true;
  });
  assertTerminalRestored(input);
});

test("Escape cancels with a CliError and restores the terminal", async () => {
  const input = fakeInput();
  const { picked } = start(input);
  input.emit("data", ESCAPE);
  await assert.rejects(picked, (e) => {
    assert.ok(e instanceof CliError);
    assert.equal(e.message, "\nSelection cancelled.");
    return true;
  });
  assertTerminalRestored(input);
});

test("keys after the end are ignored", async () => {
  const input = fakeInput();
  const { picked } = start(input);
  input.emit("data", ENTER);
  await picked;
  input.emit("data", DOWN);
  assertTerminalRestored(input);
});

test("an error while drawing rejects and restores the terminal", async () => {
  const input = fakeInput();
  const broken = [{ id: "x", get name() { throw new Error("cannot draw"); } }];
  const { picked } = start(input, { items: broken });
  await assert.rejects(picked, /cannot draw/);
  assertTerminalRestored(input);
});

test("an error while handling a key rejects and restores the terminal", async () => {
  const input = fakeInput();
  let calls = 0;
  const flaky = [
    { id: "x", get name() { if (++calls > 1) throw new Error("cannot redraw"); return "X"; } },
    { id: "y", name: "Y" },
  ];
  const { picked } = start(input, { items: flaky });
  input.emit("data", DOWN);
  await assert.rejects(picked, /cannot redraw/);
  assertTerminalRestored(input);
});

test("when raw mode cannot be switched on, the picker rejects and input is paused again", async () => {
  const input = fakeInput({ failRawMode: true });
  const { picked } = start(input);
  await assert.rejects(picked, /no raw mode here/);
  assert.equal(input.paused, true);
  assert.equal(input.rawMode, false);
  assert.equal(input.listenerCount("data"), 0);
});
