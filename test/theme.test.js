import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTheme, resolveTheme, THEME_OPTIONS } from "../src/tui/theme.js";

test("theme system поддерживает расширенную палитру и цветовые aliases", () => {
  assert.ok(THEME_OPTIONS.some((theme) => theme.id === "midnight"));
  assert.ok(THEME_OPTIONS.some((theme) => theme.id === "rose"));
  assert.equal(normalizeTheme("teal"), "midnight");
  assert.equal(normalizeTheme("pink"), "rose");
  assert.equal(normalizeTheme("unknown"), null);
  assert.equal(resolveTheme("mono").name, "mono");
  assert.equal(resolveTheme("unknown").name, "ember");
  assert.match(resolveTheme("midnight").colors.accent, /^#/);
});
