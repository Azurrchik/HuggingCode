import readline from "node:readline";
import { HuggingController } from "../src/controller.js";
import { verifyHuggingFaceToken } from "../src/agent.js";
import { getStoredToken, saveToken } from "../src/storage.js";
import { THEME_OPTIONS, normalizeTheme } from "../src/tui/theme.js";

let controller;
let workspaceRoot = process.cwd();

function safeEvent(event) {
  const allowed = new Set([
    "user", "turn_started", "activity", "text_delta", "assistant_final", "tool_started", "tool_result",
    "verification", "notice", "warning", "error", "turn_cancelled", "approval_requested", "full_mode_requested",
    "model_picker_requested", "theme_picker_requested", "theme_changed",
  ]);
  if (!allowed.has(event?.type)) return null;
  const { content, type, turnId, tool, details, level, action, phrase, workspace, model, round, stage } = event;
  return { type, content, turnId, tool, details, level, action, phrase, workspace, model, round, stage, createdAt: Date.now() };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function status() {
  return controller?.getStatus() || { workspace: workspaceRoot };
}

async function startController(token, root = workspaceRoot) {
  workspaceRoot = root;
  controller?.close();
  controller = await HuggingController.create({ token, workspaceRoot });
  controller.subscribe((event) => {
    const safe = safeEvent(event);
    if (safe) send({ type: "event", event: safe });
  });
  await controller.initialize();
  return { needsToken: false, workspaceRoot, status: status() };
}

async function dispatch(method, params = {}) {
  switch (method) {
    case "bootstrap": {
      const token = await getStoredToken();
      return token ? startController(token) : { needsToken: true, workspaceRoot };
    }
    case "login": {
      const token = String(params.token || "").trim();
      if (!token.startsWith("hf_")) throw new Error("Токен Hugging Face должен начинаться с hf_.");
      const account = await verifyHuggingFaceToken(token);
      const storage = await saveToken(token);
      return { ...(await startController(token)), account, storage };
    }
    case "submit":
      if (!controller) throw new Error("Сначала подключите Hugging Face token.");
      await controller.submit(String(params.input || ""));
      return status();
    case "setWorkspace": {
      const root = String(params.path || "").trim();
      if (!root) throw new Error("Рабочая область не выбрана.");
      const token = await getStoredToken();
      return token ? startController(token, root) : { needsToken: true, workspaceRoot: root };
    }
    case "approval":
      controller?.resolveApproval(params.allow ? "allow" : "deny");
      return true;
    case "fullMode":
      return controller?.confirmFullMode(String(params.phrase || "")) || false;
    case "cancel":
      return controller?.cancel() || false;
    case "settings":
      if (!controller) throw new Error("Сначала подключите Hugging Face token.");
      await controller.refreshModelCatalog({ silent: true });
      return { status: status(), models: controller.getModelCatalog("", { code: true }).slice(0, 80), themes: THEME_OPTIONS };
    case "selectModel":
      if (!controller) throw new Error("Сначала подключите Hugging Face token.");
      await controller.selectModel(String(params.modelId || ""), String(params.policy || "fastest"));
      return status();
    case "selectTheme": {
      if (!controller) throw new Error("Сначала подключите Hugging Face token.");
      const theme = normalizeTheme(params.theme);
      if (!theme) throw new Error("Неизвестная тема.");
      await controller.updateConfig({ theme });
      controller.emit({ type: "theme_changed", theme });
      return { theme, status: status() };
    }
    case "status": return status();
    default: throw new Error(`Неизвестный desktop bridge method: ${method}`);
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let request;
  try {
    request = JSON.parse(line);
    const result = await dispatch(request.method, request.params);
    send({ type: "response", id: request.id, ok: true, result });
  } catch (error) {
    send({ type: "response", id: request?.id ?? null, ok: false, error: error?.message || "Desktop bridge error" });
  }
}
