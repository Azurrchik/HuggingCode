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

test("CLI presents provider selection before requesting a first API key", async () => {
  const source = await readFile(path.join(root, "src", "tui", "start.js"), "utf8");

  assert.match(source, /message: "Выберите AI-провайдера"/);
  assert.match(source, /PROVIDER_PRESETS\.map/);
  assert.match(source, /message: "Введите HTTPS endpoint OpenAI-совместимого API"/);
  assert.match(source, /providerEndpoint: profile\.id === "custom" \? profile\.endpoint : ""/);
});
