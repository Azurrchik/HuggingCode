import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodingAgent } from "../src/agent.js";
import { CheckpointStore } from "../src/checkpoints.js";
import { appendTranscript, createTranscript } from "../src/tui/transcript.js";
import { detectProjectChecks } from "../src/verification.js";

function testWorkspace() {
  return {
    toolDefinitions: [],
    listRoots: () => [{ id: "workspace", root: "C:/test", primary: true }],
    execute: async () => "unused",
  };
}

test("transcript объединяет потоковые delta и финализирует сообщение", () => {
  let rows = createTranscript();
  rows = appendTranscript(rows, { type: "user", content: "hello" });
  rows = appendTranscript(rows, { type: "text_delta", turnId: "t1", content: "Привет" });
  rows = appendTranscript(rows, { type: "text_delta", turnId: "t1", content: ", мир" });
  rows = appendTranscript(rows, { type: "assistant_final", turnId: "t1", content: "Привет, мир" });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].kind, "assistant");
  assert.equal(rows[1].content, "Привет, мир");
});

test("CodingAgent передаёт потоковые текстовые события и сохраняет финальный ответ", async () => {
  const events = [];
  const agent = new CodingAgent({
    token: "hf_test",
    model: "example/model",
    maxTokens: 128,
    workspace: testWorkspace(),
    approve: async () => false,
    onEvent: (event) => events.push(event),
  });
  agent.client = {
    async *chatCompletionStream() {
      yield { choices: [{ delta: { content: "Поток" } }] };
      yield { choices: [{ delta: { content: "овый ответ" } }], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } };
    },
  };
  const answer = await agent.ask("test", { stream: true });
  assert.equal(answer, "Потоковый ответ");
  assert.deepEqual(events.filter((event) => event.type === "text_delta").map((event) => event.content), ["Поток", "овый ответ"]);
  assert.equal(events.at(-1).type, "final");
  assert.equal(agent.getUsage().totalTokens, 7);
});

test("checkpoint откатывает созданный агентом файл", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "huggingcode-checkpoint-"));
  const oldAppData = process.env.APPDATA;
  process.env.APPDATA = path.join(root, "appdata");
  try {
    const target = path.join(root, "created.txt");
    const store = new CheckpointStore(root);
    await store.beginTurn("turn_test");
    await writeFile(target, "new content", "utf8");
    await store.record({ type: "write", target, label: "created.txt", before: { exists: false, content: "" }, after: { exists: true, content: "new content" } });
    const result = await store.undoLatest();
    assert.equal(result.found, true);
    assert.deepEqual(result.removed, ["created.txt"]);
    await assert.rejects(() => readFile(target, "utf8"), { code: "ENOENT" });
  } finally {
    if (oldAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = oldAppData;
    await rm(root, { recursive: true, force: true });
  }
});

test("обнаруживаются npm проверки проекта", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "huggingcode-checks-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { lint: "node --check .", test: "node --test" } }), "utf8");
    const checks = await detectProjectChecks(root);
    assert.deepEqual(checks.map((check) => check.command), ["npm run lint", "npm run test"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
