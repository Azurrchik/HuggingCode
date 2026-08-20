import assert from "node:assert/strict";
import test from "node:test";
import { HuggingController, FULL_MODE_PHRASE } from "../src/controller.js";
import { catalogFromPayload, formatModelSelection, normalizeModel, searchModels } from "../src/model-catalog.js";
import { credentialBackend, normalizePlatform, platformSnapshot, shellAdapter } from "../src/platform.js";

function controllerFixture() {
  const workspace = {
    root: "/tmp/huggingcode-test-workspace",
    toolDefinitions: [],
    listRoots: () => [{ id: "workspace", root: "/tmp/huggingcode-test-workspace", primary: true }],
    setMutationListener: () => {},
  };
  const config = {
    model: "openai/gpt-oss-120b:fastest",
    maxTokens: 4096,
    reasoningEffort: "auto",
    permissionMode: "manual",
    autoCompactThreshold: 80_000,
  };
  const checkpoints = { record: async () => {}, beginTurn: async () => {} };
  return new HuggingController({ token: "hf_test", config, workspace, memory: "", checkpoints });
}

test("platform adapter выбирает shell и хранилище для Windows, macOS и Linux", () => {
  assert.equal(normalizePlatform("win32"), "windows");
  assert.equal(normalizePlatform("darwin"), "macos");
  assert.equal(normalizePlatform("linux"), "linux");
  assert.equal(normalizePlatform("freebsd"), "other");

  assert.deepEqual(shellAdapter("win32").argumentsFor("echo ok"), ["/d", "/s", "/c", "echo ok"]);
  assert.deepEqual(shellAdapter("linux").argumentsFor("echo ok"), ["-lc", "echo ok"]);
  assert.equal(credentialBackend("win32").id, "dpapi");
  assert.equal(credentialBackend("darwin").id, "keychain");
  assert.equal(credentialBackend("linux").id, "secret-service");
  assert.deepEqual(platformSnapshot("linux"), {
    id: "linux",
    label: "Linux",
    shell: "/bin/sh",
    credentials: { id: "secret-service", label: "Linux Secret Service", persistent: true },
  });
});

test("model catalog нормализует provider payload, ищет code/models и форматирует policy suffix", () => {
  const model = normalizeModel({
    id: "acme/Code-Vision-1",
    display_name: "Acme Code Vision",
    capabilities: { tools: true, vision: true },
    context_length: 32768,
    max_output_tokens: 4096,
    provider: "acme",
  });
  assert.equal(model.id, "acme/Code-Vision-1");
  assert.equal(model.label, "Acme Code Vision");
  assert.deepEqual(model.tags.sort(), ["code", "tools", "vision"]);
  assert.equal(model.supportsTools, true);
  assert.equal(model.supportsVision, true);
  assert.equal(model.contextLength, 32768);

  const catalog = catalogFromPayload({ data: [model.raw, { id: "acme/Code-Vision-1" }, { id: "general/chat", description: "chat" }] });
  assert.equal(catalog.length, 2);
  assert.deepEqual(searchModels(catalog, "acme", { code: true, tools: true }).map((item) => item.id), ["acme/Code-Vision-1"]);
  assert.equal(formatModelSelection("acme/Code-Vision-1:cheapest", "preferred"), "acme/Code-Vision-1:preferred");
  assert.equal(formatModelSelection("acme/Code-Vision-1", "custom"), "acme/Code-Vision-1");
  assert.throws(() => formatModelSelection("", "fastest"), /не может быть пустым/);
});

test("full mode требует точную фразу, изменяет только runtime mode и может быть отменён", async () => {
  const controller = controllerFixture();
  const events = [];
  controller.subscribe((event) => events.push(event));

  const pending = controller.requestFullModeActivation();
  assert.equal(events.at(-1).type, "full_mode_requested");
  assert.equal(events.at(-1).phrase, FULL_MODE_PHRASE);
  assert.equal(controller.getStatus().mode, "manual");
  assert.equal(controller.confirmFullMode("enable full mode"), false);
  assert.equal(controller.getStatus().mode, "manual");
  assert.equal(controller.confirmFullMode(FULL_MODE_PHRASE), true);
  assert.equal(await pending, true);
  assert.equal(controller.getStatus().mode, "full");
  assert.equal(controller.config.permissionMode, "manual");
  assert.equal(controller.agent.permissionMode, "full");

  const secondController = controllerFixture();
  const cancelled = secondController.requestFullModeActivation();
  secondController.cancelFullModeActivation();
  assert.equal(await cancelled, false);
  assert.equal(secondController.getStatus().mode, "manual");
});

test("transcript хранит имя инструмента для tool и diff-карточек", async () => {
  const { appendTranscript, createTranscript } = await import("../src/tui/transcript.js");
  let rows = createTranscript();
  rows = appendTranscript(rows, { type: "tool_started", turnId: "t1", tool: "replace_in_file", content: "replace_in_file: src/app.js", details: { path: "src/app.js", old_string: "old", new_string: "new" } });
  rows = appendTranscript(rows, { type: "tool_result", turnId: "t1", tool: "replace_in_file", content: "replace_in_file: завершён", details: "ok" });
  assert.equal(rows[0].tool, "replace_in_file");
  assert.equal(rows[1].tool, "replace_in_file");
});

test("controller выводит контекстную /help-справку и открывает theme picker", async () => {
  const controller = controllerFixture();
  const events = [];
  controller.subscribe((event) => events.push(event));

  await controller.runSlash("/help model");
  assert.equal(events.at(-1).type, "assistant_final");
  assert.match(events.at(-1).content, /Открыть список Hugging Face моделей/);

  await controller.runSlash("/theme");
  assert.equal(events.at(-1).type, "theme_picker_requested");
  await controller.runSlash("/color");
  assert.equal(events.at(-1).type, "theme_picker_requested");
});

test("controller преобразует модельный анализ в безопасные activity-события", () => {
  const controller = controllerFixture();
  const events = [];
  controller.subscribe((event) => events.push(event));
  controller.currentTurn = { id: "trajectory_turn" };

  controller.onAgentEvent({ type: "model_request", model: "example/model", round: 2 });
  controller.onAgentEvent({ type: "analysis_started" });
  controller.onAgentEvent({ type: "thinking_delta", content: "private hidden chain" });

  assert.equal(events.length, 2);
  assert.equal(events[0].type, "activity");
  assert.match(events[0].content, /Шаг 2/);
  assert.equal(events[1].type, "activity");
  assert.doesNotMatch(events.map((event) => event.content).join("\n"), /private hidden chain/);
});
