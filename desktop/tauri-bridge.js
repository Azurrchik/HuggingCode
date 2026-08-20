import { existsSync } from "node:fs";
import readline from "node:readline";

const sourceRoot = existsSync(new URL("./src/controller.js", import.meta.url)) ? "./src" : "../src";
const [
  { HuggingController },
  { verifyHuggingFaceToken },
  { getProviderToken, saveProviderToken },
  { getConfig, updateConfig, TOKEN_MODES },
  { THEME_OPTIONS, normalizeTheme },
  { PROVIDER_PRESETS, normalizeProvider },
] = await Promise.all([
  import(`${sourceRoot}/controller.js`),
  import(`${sourceRoot}/agent.js`),
  import(`${sourceRoot}/storage.js`),
  import(`${sourceRoot}/config.js`),
  import(`${sourceRoot}/tui/theme.js`),
  import(`${sourceRoot}/providers.js`),
]);

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
function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function status() { return controller?.getStatus() || { workspace: workspaceRoot }; }

async function startController(token, root = workspaceRoot, profile = {}) {
  workspaceRoot = root;
  controller?.close();
  controller = await HuggingController.create({ token, workspaceRoot, provider: profile.provider, providerEndpoint: profile.endpoint });
  controller.subscribe((event) => { const safe = safeEvent(event); if (safe) send({ type: "event", event: safe }); });
  await controller.initialize();
  return { needsToken: false, workspaceRoot, status: status() };
}

async function activeProfile() {
  const config = await getConfig();
  return normalizeProvider(config.provider, config.providerEndpoint);
}

async function connectProvider(params = {}) {
  const current = await activeProfile();
  const selected = normalizeProvider(params.provider || current.id, params.endpoint !== undefined ? params.endpoint : current.endpoint);
  const supplied = String(params.token || "").trim();
  const token = supplied || await getProviderToken(selected.id);
  if (!token) return { needsToken: true, provider: selected };
  let account = null;
  if (selected.id === "huggingface") account = await verifyHuggingFaceToken(token);
  const storage = supplied ? await saveProviderToken(selected.id, token) : null;
  await updateConfig({ provider: selected.id, providerEndpoint: selected.endpoint });
  return { ...(await startController(token, workspaceRoot, selected)), account, storage, provider: selected };
}

function modelFilters(params = {}) {
  return { code: params.code === true, tools: params.tools === true, vision: params.vision === true };
}

async function dispatch(method, params = {}) {
  switch (method) {
    case "bootstrap": return connectProvider();
    case "login": return connectProvider({ provider: "huggingface", token: params.token });
    case "connectProvider": return connectProvider(params);
    case "submit":
      if (!controller) throw new Error("Сначала подключите ключ выбранного провайдера.");
      await controller.submit(String(params.input || "")); return status();
    case "setWorkspace": {
      const root = String(params.path || "").trim();
      if (!root) throw new Error("Рабочая область не выбрана.");
      workspaceRoot = root;
      return connectProvider();
    }
    case "approval": controller?.resolveApproval(params.allow ? "allow" : "deny"); return true;
    case "fullMode": return controller?.confirmFullMode(String(params.phrase || "")) || false;
    case "cancel": return controller?.cancel() || false;
    case "settings": {
      if (!controller) throw new Error("Сначала подключите ключ провайдера.");
      await controller.refreshModelCatalog({ silent: true });
      return {
        status: status(),
        models: controller.getModelCatalog(String(params.query || ""), modelFilters(params)),
        modelCatalogSource: controller.modelCatalogSource,
        modelCatalogTotal: controller.modelCatalog.length,
        themes: THEME_OPTIONS,
        providers: PROVIDER_PRESETS,
        tokenModes: TOKEN_MODES,
      };
    }
    case "selectModel":
      if (!controller) throw new Error("Сначала подключите ключ провайдера.");
      await controller.selectModel(String(params.modelId || ""), String(params.policy || "fastest")); return status();
    case "selectTheme": {
      if (!controller) throw new Error("Сначала подключите ключ провайдера.");
      const theme = normalizeTheme(params.theme); if (!theme) throw new Error("Неизвестная тема.");
      await controller.updateConfig({ theme }); controller.emit({ type: "theme_changed", theme }); return { theme, status: status() };
    }
    case "selectTokenMode": {
      if (!controller) throw new Error("Сначала подключите ключ провайдера.");
      const tokenMode = String(params.tokenMode || "balanced");
      if (!TOKEN_MODES.includes(tokenMode)) throw new Error("Неизвестный режим расхода токенов.");
      await controller.updateConfig({ tokenMode });
      controller.emit({ type: "notice", level: "info", content: tokenMode === "economy" ? "Включена экономия токенов: компактный контекст, раннее сжатие истории и минимальный reasoning effort." : `Режим токенов: ${tokenMode}.` });
      return status();
    }
    case "status": return status();
    default: throw new Error(`Неизвестный desktop bridge method: ${method}`);
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let request;
  try { request = JSON.parse(line); send({ type: "response", id: request.id, ok: true, result: await dispatch(request.method, request.params) }); }
  catch (error) { send({ type: "response", id: request?.id ?? null, ok: false, error: error?.message || "Desktop bridge error" }); }
}
