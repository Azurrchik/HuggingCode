import assert from "node:assert/strict";
import test from "node:test";
import { commandPaletteItems, commandSuggestions, findCommand, formatHelp } from "../src/command-catalog.js";

test("command catalog находит команды и алиасы с понятным кратким описанием", () => {
  assert.equal(findCommand("model").title, "Выбрать модель");
  assert.equal(findCommand("color").name, "theme");
  assert.equal(findCommand("run").name, "verify");
  assert.equal(findCommand("missing"), null);
  assert.match(formatHelp("model"), /Открыть список Hugging Face моделей/);
  assert.match(formatHelp("color"), /Альтернативы: \/color/);
  assert.match(formatHelp(), /Модель/);
  assert.match(formatHelp(), /Проект/);
});

test("palette и composer строятся из единого command catalog", () => {
  const palette = commandPaletteItems();
  const suggestions = commandSuggestions();
  assert.ok(palette.some((item) => item.command === "/model" && item.detail.includes("модель")));
  assert.ok(suggestions.some(([name, detail]) => name === "theme" && detail.includes("цвет")));
  assert.ok(suggestions.some(([name]) => name === "security-review"));
});
