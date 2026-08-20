import assert from "node:assert/strict";
import test from "node:test";

test("TUI entry point loads with React public createElement API", async () => {
  const tui = await import("../src/tui/start.js");

  assert.equal(typeof tui.startInteractiveTui, "function");
});
