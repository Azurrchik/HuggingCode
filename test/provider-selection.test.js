import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PROVIDER_PRESETS, normalizeProvider } from "../src/providers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("provider presets include Hugging Face and OpenAI-compatible choices", () => {
  assert.deepEqual(
    PROVIDER_PRESETS.map((provider) => provider.id),
    ["huggingface", "openai", "openrouter", "deepseek", "groq", "together", "custom"],
  );
  assert.throws(() => normalizeProvider("custom", "http://localhost:8080/v1"), /HTTPS URL/);
  assert.equal(normalizeProvider("custom", "https://example.test/v1/").endpoint, "https://example.test/v1");
});

test("CLI asks whether to use Hugging Face or another provider before requesting an API key", async () => {
  const source = await readFile(path.join(root, "src", "tui", "start.js"), "utf8");

  assert.match(source, /message: "Какой способ подключения использовать\?"/);
  assert.match(source, /label: "Hugging Face"/);
  assert.match(source, /label: "Другой OpenAI-совместимый провайдер"/);
  assert.match(source, /message: "Введите Base URL OpenAI-совместимого API"/);
  assert.match(source, /providerEndpoint: profile\.endpoint/);
});
