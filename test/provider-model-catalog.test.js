import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fetchProviderModelCatalog } from "../src/model-catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("loads and normalizes the model catalog from an OpenAI-compatible provider", async () => {
  const requests = [];
  const catalog = await fetchProviderModelCatalog(
    { id: "custom", label: "Другой OpenAI-совместимый API", endpoint: "https://models.example.test/v1/" },
    "test-api-key",
    {
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({
          object: "list",
          data: [
            { id: "acme/coder-1", object: "model", owned_by: "acme", context_length: 65536 },
            { id: "acme/vision-1", object: "model", owned_by: "acme" },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  );

  assert.deepEqual(requests, [{
    url: "https://models.example.test/v1/models",
    options: { headers: { Authorization: "Bearer test-api-key" }, signal: undefined },
  }]);
  assert.deepEqual(catalog.map((model) => model.id), ["acme/coder-1", "acme/vision-1"]);
  assert.equal(catalog[0].description, "Модель OpenAI-совместимого провайдера");
  assert.equal(catalog[0].contextLength, 65536);
  assert.ok(catalog[0].tags.includes("code"));
  assert.ok(catalog[1].tags.includes("vision"));
});

test("refuses a non-HTTPS custom model endpoint before making a request", async () => {
  let called = false;

  await assert.rejects(
    fetchProviderModelCatalog(
      { id: "custom", endpoint: "http://localhost:8000/v1" },
      "test-api-key",
      { fetchImpl: async () => { called = true; throw new Error("must not run"); } },
    ),
    /HTTPS Base URL/,
  );

  assert.equal(called, false);
});

test("controller and interfaces use the live provider catalog for custom APIs", async () => {
  const [controller, picker, desktop] = await Promise.all([
    readFile(path.join(root, "src", "controller.js"), "utf8"),
    readFile(path.join(root, "src", "tui", "ModelPicker.js"), "utf8"),
    readFile(path.join(root, "desktop", "renderer", "renderer.js"), "utf8"),
  ]);

  assert.match(controller, /fetchProviderModelCatalog\(provider, this\.token\)/);
  assert.match(controller, /modelCatalogSource = "provider"/);
  assert.match(controller, /code: this\.config\.provider === "huggingface"/);
  assert.match(picker, /живой каталог провайдера/);
  assert.match(desktop, /Live каталог выбранного провайдера/);
});
