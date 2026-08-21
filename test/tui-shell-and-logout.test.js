import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findCommand } from "../src/command-catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("logout command describes the current provider key rather than a Hugging Face-only token", () => {
  const command = findCommand("logout");

  assert.equal(command.title, "Удалить ключ");
  assert.match(command.short, /текущего провайдера/);
  assert.doesNotMatch(command.short, /Hugging Face/);
});

test("controller clears the active provider credential on logout", async () => {
  const controller = await readFile(path.join(root, "src", "controller.js"), "utf8");

  assert.match(controller, /import \{ clearProviderToken, getStorageInfo \}/);
  assert.match(controller, /clearProviderToken\(provider\.id\)/);
  assert.match(controller, /Ключ \$\{provider\.label\} удалён/);
  assert.doesNotMatch(controller, /clearStoredToken\(\)/);
});

test("CLI opens a branded main menu immediately and supports a model shortcut fallback", async () => {
  const [app, palette, prompt, footer] = await Promise.all([
    readFile(path.join(root, "src", "tui", "App.js"), "utf8"),
    readFile(path.join(root, "src", "tui", "CommandPalette.js"), "utf8"),
    readFile(path.join(root, "src", "tui", "PromptInput.js"), "utf8"),
    readFile(path.join(root, "src", "tui", "FooterBar.js"), "utf8"),
  ]);

  assert.match(app, /const \[paletteOpen, setPaletteOpen\] = useState\(true\)/);
  assert.match(app, /value\.toLowerCase\(\) === "m" \|\| value\.toLowerCase\(\) === "o" \|\| key\.return/);
  assert.match(app, /onOpenModel: \(\) => submit\("\/model"\)/);
  assert.match(palette, /Главное меню HuggingCode/);
  assert.match(palette, /Выберите действие для старта/);
  assert.match(prompt, /if \(!value\.trim\(\)\) return onOpenModel\?\.\(\)/);
  assert.match(prompt, /Enter отправить \/ пустой — модели/);
  assert.match(prompt, /Ctrl\+M\/Ctrl\+O модели/);
  assert.match(footer, /Ctrl\+M\/Ctrl\+O модели/);
});
