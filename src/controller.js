import { readFile } from "node:fs/promises";
import path from "node:path";
import { CodingAgent } from "./agent.js";
import { getConfig, PERMISSION_MODES, REASONING_EFFORTS, updateConfig } from "./config.js";
import { decidePermission } from "./permissions.js";
import { clearStoredToken, getStorageInfo } from "./storage.js";
import { platformSnapshot } from "./platform.js";
import { branchSession, createSession, listSessions, loadSession, saveSession, sessionToText } from "./session-store.js";
import { listSkills, loadSkill } from "./skills.js";
import { TaskManager } from "./tasks.js";
import { createWorkspace } from "./workspace.js";
import { CheckpointStore } from "./checkpoints.js";
import { detectProjectChecks } from "./verification.js";
import { fallbackCatalog, fetchModelCatalog, formatModelSelection, searchModels } from "./model-catalog.js";

const MEMORY_FILE = "HUGGINGCODE.md";
export const FULL_MODE_PHRASE = "ENABLE FULL MODE";

async function memoryFrom(root) {
  try {
    return (await readFile(path.join(root, MEMORY_FILE), "utf8")).slice(0, 12_000);
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function shortToolEvent(event) {
  const args = event.args || {};
  if (args.path) return `${event.name}: ${args.path}`;
  if (args.command) return `${event.name}: ${args.command}`;
  return event.name || "tool";
}

export class HuggingController {
  static async create({ token, workspaceRoot = process.cwd() }) {
    const config = await getConfig();
    const workspace = await createWorkspace(workspaceRoot);
    const memory = await memoryFrom(workspace.root);
    const checkpoints = new CheckpointStore(workspace.root);
    return new HuggingController({ token, config, workspace, memory, checkpoints });
  }

  constructor({ token, config, workspace, memory, checkpoints }) {
    this.token = token;
    this.config = config;
    this.workspace = workspace;
    this.memory = memory;
    this.listeners = new Set();
    this.currentTurn = null;
    this.pendingApproval = null;
    this.pendingFullMode = null;
    this.runtimePermissionMode = config.permissionMode;
    this.closed = false;
    this.session = null;
    this.checkpoints = checkpoints;
    this.tasks = new TaskManager();
    this.attachments = [];
    this.modelCatalog = fallbackCatalog();
    this.modelCatalogSource = "fallback";
    this.workspace.setMutationListener(async (mutation) => {
      if (!this.currentTurn) return;
      await this.checkpoints.record(mutation);
      this.currentTurn.changedFiles ??= [];
      if (!this.currentTurn.changedFiles.includes(mutation.label)) this.currentTurn.changedFiles.push(mutation.label);
    });
    this.agent = this.createAgent();
  }

  createAgent() {
    return new CodingAgent({
      token: this.token,
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      reasoningEffort: this.config.reasoningEffort,
      permissionMode: this.runtimePermissionMode,
      workspace: this.workspace,
      memory: this.memory,
      approve: (action) => this.requestApproval(action),
      onEvent: (event) => this.onAgentEvent(event),
    });
  }

  async refreshModelCatalog({ silent = false } = {}) {
    try {
      this.modelCatalog = await fetchModelCatalog(this.token);
      this.modelCatalogSource = "live";
      if (!silent) this.emit({ type: "notice", level: "info", content: `Загружен каталог Hugging Face: ${this.modelCatalog.length} моделей.` });
    } catch (error) {
      this.modelCatalog = fallbackCatalog();
      this.modelCatalogSource = "fallback";
      if (!silent) this.emit({ type: "notice", level: "warn", content: `Каталог моделей временно недоступен; показан встроенный список (${error.message}).` });
    }
    return this.modelCatalog;
  }

  getModelCatalog(query = "", filters = {}) {
    return searchModels(this.modelCatalog, query, filters);
  }

  async selectModel(modelId, policy = "fastest") {
    const model = formatModelSelection(modelId, policy);
    await this.updateConfig({ model });
    this.emit({ type: "notice", level: "info", content: `Модель изменена: ${model}` });
    return model;
  }

  async initialize() {
    this.session = await createSession({
      name: "Новая интерактивная сессия",
      workspaceRoot: this.workspace.root,
      messages: this.agent.getSnapshot(),
      metadata: { interface: "tui" },
    });
    this.emit({ type: "notice", level: "info", content: `Рабочая область: ${this.workspace.root}` });
    this.emit({ type: "notice", level: "info", content: "HuggingCode Interactive TUI готов. Введите задачу или /help." });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  onAgentEvent(event) {
    const turnId = this.currentTurn?.id;
    if (event.type === "model_request") this.emit({ type: "notice", level: "info", content: `Запрос к ${event.model}` });
    if (event.type === "text_delta") this.emit({ type: "text_delta", turnId, content: event.content });
    if (event.type === "thinking_delta") this.emit({ type: "thinking_delta", turnId, content: event.content });
    if (event.type === "final") this.emit({ type: "assistant_final", turnId, content: event.content, usage: event.usage });
    if (event.type === "tool_request") this.emit({ type: "tool_started", turnId, tool: event.name, content: shortToolEvent(event), details: event.args });
    if (event.type === "tool_result") this.emit({ type: "tool_result", turnId, tool: event.name, content: `${event.name}: завершён`, details: event.result });
    if (event.type === "warning") this.emit({ type: "notice", level: "warn", content: event.content });
  }

  requestApproval(action) {
    if (this.closed) return Promise.resolve(false);
    const decision = decidePermission(this.runtimePermissionMode, action);
    if (decision.decision === "deny") {
      this.emit({ type: "notice", level: "warn", content: decision.reason });
      return Promise.resolve(false);
    }
    if (decision.decision === "allow") {
      this.emit({ type: "notice", level: "info", content: `Разрешено режимом ${this.runtimePermissionMode}: ${decision.reason}` });
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      this.pendingApproval = { action, resolve };
      this.emit({ type: "approval_requested", turnId: this.currentTurn?.id, action });
    });
  }

  resolveApproval(decision) {
    const pending = this.pendingApproval;
    if (!pending) return;
    this.pendingApproval = null;
    pending.resolve(decision === "allow");
  }

  getStatus({ busy = false, queueCount = 0, goal = "" } = {}) {
    return {
      model: this.config.model,
      mode: this.runtimePermissionMode,
      effort: this.config.reasoningEffort,
      workspace: this.workspace.root,
      context: { ...this.agent.getContextStats(), threshold: this.config.autoCompactThreshold },
      usage: this.agent.getUsage(),
      busy,
      queueCount,
      goal,
    };
  }

  async persist(label = "turn") {
    if (!this.session) return;
    this.session = await saveSession({
      ...this.session,
      workspaceRoot: this.workspace.root,
      messages: this.agent.getSnapshot(),
      metadata: { ...this.session.metadata, lastLabel: label },
    });
  }

  async updateConfig(patch) {
    const { permissionMode, ...persistedPatch } = patch;
    if (permissionMode === "full") throw new Error("Full mode включается только через typed-подтверждение.");
    this.config = await updateConfig({ ...persistedPatch, ...(permissionMode ? { permissionMode } : {}) });
    if (permissionMode) this.runtimePermissionMode = this.config.permissionMode;
    this.agent.setModel(this.config.model);
    this.agent.setReasoningEffort(this.config.reasoningEffort);
    this.agent.setPermissionMode(this.runtimePermissionMode);
    return this.config;
  }

  requestFullModeActivation() {
    if (this.closed) return Promise.resolve(false);
    if (this.runtimePermissionMode === "full") return Promise.resolve(true);
    return new Promise((resolve) => {
      this.pendingFullMode = { resolve };
      this.emit({ type: "full_mode_requested", phrase: FULL_MODE_PHRASE, workspace: this.workspace.root });
    });
  }

  confirmFullMode(phrase) {
    const pending = this.pendingFullMode;
    if (!pending) return false;
    if (String(phrase || "").trim() !== FULL_MODE_PHRASE) return false;
    this.pendingFullMode = null;
    this.runtimePermissionMode = "full";
    this.agent.setPermissionMode("full");
    pending.resolve(true);
    this.emit({ type: "notice", level: "warn", content: "FULL MODE включён только до закрытия текущего HuggingCode-сеанса." });
    return true;
  }

  cancelFullModeActivation() {
    const pending = this.pendingFullMode;
    if (!pending) return;
    this.pendingFullMode = null;
    pending.resolve(false);
  }

  async runSlash(input) {
    const [command, ...parts] = input.slice(1).trim().split(/\s+/);
    const arg = parts.join(" ").trim();
    switch ((command || "").toLowerCase()) {
      case "help":
        this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: "Команды: /help, /models, /model <id>, /mode <manual|accept-edits|plan|safe-auto|full>, /context, /compact, /undo, /verify, /sessions, /resume <id>, /branch <name>, /rename <name>, /export <path>, /skills, /skill <name> [args], /attach <path>, /subtask <task>, /tasks, /stop <id>, /clear, /status, /logout, /exit. Используйте Tab для подсказок." });
        return;
      case "status":
        this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: `Модель: ${this.config.model}\nРежим: ${this.runtimePermissionMode}\nРабочая область: ${this.workspace.root}` });
        return;
      case "context": {
        const context = this.agent.getContextStats();
        this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: `Контекст: ~${context.estimatedTokens.toLocaleString()} токенов, ${context.messageCount} сообщений. Порог: ${this.config.autoCompactThreshold.toLocaleString()}.` });
        return;
      }
      case "model":
        if (!arg) {
          await this.refreshModelCatalog({ silent: true });
          this.emit({ type: "model_picker_requested", models: this.modelCatalog, source: this.modelCatalogSource, currentModel: this.config.model });
        } else {
          const [modelId, policy] = parts;
          await this.selectModel(modelId, policy || "fastest");
        }
        return;
      case "effort":
        if (!arg) {
          this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: `Reasoning effort: ${this.config.reasoningEffort}. Доступно: ${REASONING_EFFORTS.join(", ")}.` });
        } else if (!REASONING_EFFORTS.includes(arg)) {
          throw new Error(`Неизвестный effort: ${arg}.`);
        } else {
          await this.updateConfig({ reasoningEffort: arg });
          this.emit({ type: "notice", level: "info", content: `Reasoning effort: ${arg}` });
        }
        return;
      case "theme":
        if (!arg) {
          this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: `Тема: ${this.config.theme}. Доступно: ember, ocean, forest, violet.` });
        } else {
          await this.updateConfig({ theme: arg });
          this.emit({ type: "notice", level: "info", content: `Тема обновлена: ${arg}. Перезапустите HuggingCode для смены цветов текущего окна.` });
        }
        return;
      case "mode":
      case "permissions":
        if (!arg) {
          this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: `Режим: ${this.runtimePermissionMode}. Доступно: ${PERMISSION_MODES.join(", ")}.` });
        } else if (!PERMISSION_MODES.includes(arg)) {
          this.emit({ type: "error", turnId: this.currentTurn?.id, content: `Неизвестный режим: ${arg}` });
        } else if (arg === "full") {
          const enabled = await this.requestFullModeActivation();
          if (!enabled) this.emit({ type: "notice", level: "info", content: "Full mode не включён." });
        } else {
          await this.updateConfig({ permissionMode: arg });
          this.emit({ type: "notice", level: "info", content: `Режим разрешений: ${arg}` });
        }
        return;
      case "compact": {
        const result = await this.agent.compact(arg);
        await this.persist("compact");
        this.emit({ type: "notice", level: "info", content: result });
        return;
      }
      case "clear":
        this.agent.reset();
        await this.persist("clear");
        this.emit({ type: "notice", level: "info", content: "Контекст очищен; сессия сохранена." });
        return;
      case "undo": {
        const result = await this.checkpoints.undoLatest();
        if (!result.found) {
          this.emit({ type: "notice", level: "info", content: "Подходящих checkpoint для отката нет." });
        } else {
          const details = [
            result.restored.length ? `восстановлено: ${result.restored.join(", ")}` : null,
            result.removed.length ? `удалено: ${result.removed.join(", ")}` : null,
            result.conflicts.length ? `конфликты: ${result.conflicts.join(", ")}` : null,
            result.failed.length ? `ошибки: ${result.failed.map((item) => item.path).join(", ")}` : null,
          ].filter(Boolean).join("\n");
          this.emit({ type: result.conflicts.length || result.failed.length ? "notice" : "verification", level: result.conflicts.length || result.failed.length ? "warn" : "info", content: details || "Checkpoint обработан." });
        }
        return;
      }
      case "verify": {
        const checks = await detectProjectChecks(this.workspace.root);
        if (!checks.length) {
          this.emit({ type: "notice", level: "warn", content: "Не удалось автоматически определить проверки проекта." });
          return;
        }
        for (const check of checks) {
          const allowed = await this.requestApproval({ type: "command", command: check.command, reason: `Проверка проекта, обнаружена в ${check.source}.` });
          if (!allowed) {
            this.emit({ type: "verification", turnId: this.currentTurn?.id, content: `${check.label}: пропущено` });
            continue;
          }
          const output = await this.workspace.runCommand(check.command);
          this.emit({ type: "verification", turnId: this.currentTurn?.id, content: `${check.label}\n${output}` });
        }
        return;
      }
      case "sessions": {
        const sessions = await listSessions();
        const matching = sessions.filter((item) => !arg || item.name.toLowerCase().includes(arg.toLowerCase()) || item.id.includes(arg));
        this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: matching.length ? matching.map((item) => `${item.id}\n${item.name} · ${item.messageCount} messages · ${item.updatedAt}\n${item.workspaceRoot}`).join("\n\n") : "Сохранённых сессий нет." });
        return;
      }
      case "resume": {
        if (!arg) throw new Error("Укажите ID сессии: /resume <id>.");
        const session = await loadSession(arg);
        this.agent.restore(session.messages);
        this.session = session;
        this.emit({ type: "notice", level: "info", content: `Сессия восстановлена: ${session.name}` });
        return;
      }
      case "branch": {
        const next = await branchSession(this.session, arg || `${this.session.name} — ветка`);
        this.session = next;
        this.emit({ type: "notice", level: "info", content: `Создана ветка сессии: ${next.name}` });
        return;
      }
      case "rename": {
        if (!arg) throw new Error("Укажите новое имя: /rename <имя>.");
        this.session = await saveSession({ ...this.session, name: arg });
        this.emit({ type: "notice", level: "info", content: `Сессия переименована: ${this.session.name}` });
        return;
      }
      case "export": {
        const destination = arg || `.huggingcode-exports/session-${this.session.id}.md`;
        const content = sessionToText({ ...this.session, messages: this.agent.getSnapshot() });
        const result = await this.workspace.execute("write_file", { path: destination, content, reason: "Экспорт локальной сессии в Markdown." }, (action) => this.requestApproval(action));
        this.emit({ type: "notice", level: "info", content: result });
        return;
      }
      case "skills": {
        const skills = await listSkills(this.workspace.root);
        this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: skills.length ? skills.map((skill) => `/${skill.name} — ${skill.description}`).join("\n") : "Пользовательские навыки не найдены. Создайте .huggingcode/skills/<name>.md." });
        return;
      }
      case "skill": {
        const [name, ...skillArgs] = parts;
        if (!name) throw new Error("Укажите имя навыка: /skill <name> [аргументы].");
        const skill = await loadSkill(this.workspace.root, name, skillArgs.join(" "));
        await this.agent.ask(`Run the user-invoked project skill “${skill.name}”. Follow its instructions precisely within the existing safety boundaries.\n\n${skill.prompt}`, { signal: this.currentTurn?.abort.signal, stream: true });
        await this.persist(`skill:${skill.name}`);
        return;
      }
      case "attach": {
        if (arg === "clear") {
          this.attachments = [];
          this.emit({ type: "notice", level: "info", content: "Вложения очищены." });
          return;
        }
        if (!arg) {
          this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: this.attachments.length ? `Ожидают отправки: ${this.attachments.map((item) => item.path).join(", ")}` : "Используйте /attach <путь>; доступны только UTF-8 текстовые файлы внутри доверенной рабочей области." });
          return;
        }
        if (this.attachments.length >= 4) throw new Error("Можно добавить не более 4 вложений к следующему сообщению.");
        const content = await this.workspace.readTextFile(arg);
        this.attachments.push({ path: arg, content });
        this.emit({ type: "notice", level: "info", content: `Прикреплён текстовый файл: ${arg}` });
        return;
      }
      case "models": {
        await this.refreshModelCatalog();
        const models = this.getModelCatalog(arg, { code: true }).slice(0, 20);
        this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: models.map((model) => `${model.id}\n${model.label} · ${model.tags.join(", ") || "chat"}${model.contextLength ? ` · ctx ${model.contextLength.toLocaleString()}` : ""}`).join("\n\n") || "Модели не найдены." });
        return;
      }
      case "subtask": {
        if (!arg) throw new Error("Укажите задачу: /subtask <текст>.");
        const task = this.tasks.start(arg, () => this.agent.askSideQuestion(arg));
        this.emit({ type: "notice", level: "info", content: `Подзадача запущена: ${task.id}` });
        return;
      }
      case "tasks": {
        const tasks = this.tasks.list();
        this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: tasks.length ? tasks.map((task) => `${task.id} · ${task.status} · ${task.title}`).join("\n") : "Локальных подзадач нет." });
        return;
      }
      case "stop": {
        if (!arg) throw new Error("Укажите ID подзадачи: /stop <id>.");
        const task = this.tasks.stop(arg);
        this.emit({ type: "notice", level: "warn", content: `Подзадача остановлена: ${task.id}` });
        return;
      }
      case "doctor": {
        const checkpoints = await this.checkpoints.list();
        const skills = await listSkills(this.workspace.root);
        const platform = platformSnapshot();
        const storage = getStorageInfo();
        this.emit({ type: "assistant_final", turnId: this.currentTurn?.id, content: [
          "HuggingCode doctor",
          `Platform: ${platform.label}`,
          `Shell: ${platform.shell}`,
          `Credential store: ${storage.label}${storage.sessionOnly ? " (session-only)" : ""}`,
          `Node.js: ${process.version}`,
          `Workspace: ${this.workspace.root}`,
          `Model: ${this.config.model}`,
          `Mode: ${this.runtimePermissionMode}`,
          `Effort: ${this.config.reasoningEffort}`,
          `Context: ~${this.agent.getContextStats().estimatedTokens} tokens`,
          `Checkpoints: ${checkpoints.length}`,
          `Skills: ${skills.length}`,
          `Attachments queued: ${this.attachments.length}`,
        ].join("\n") });
        return;
      }
      case "logout":
        await clearStoredToken();
        this.emit({ type: "notice", level: "warn", content: "Токен удалён. Перезапустите HuggingCode для нового входа." });
        return;
      default:
        this.emit({ type: "error", turnId: this.currentTurn?.id, content: `Команда /${command || ""} пока не перенесена в Interactive TUI. Используйте обычную задачу или /help.` });
    }
  }

  async submit(input) {
    const turnId = `turn_${Date.now().toString(36)}`;
    const abort = new AbortController();
    this.currentTurn = { id: turnId, cancelled: false, abort, changedFiles: [] };
    await this.checkpoints.beginTurn(turnId);
    this.emit({ type: "user", content: input });
    this.emit({ type: "turn_started", turnId, content: "Агент начал работу." });
    try {
      if (input.startsWith("/")) {
        await this.runSlash(input);
      } else {
        const attachments = this.attachments.splice(0);
        const prompt = attachments.length ? `${input}\n\nAttached workspace files (user explicitly selected these for this request):\n${attachments.map((item) => `--- ${item.path} ---\n${item.content}`).join("\n\n")}` : input;
        await this.agent.ask(prompt, { signal: abort.signal, stream: true });
        if (!abort.signal.aborted) {
          await this.persist("turn");
          if (this.currentTurn.changedFiles.length) {
            const checks = await detectProjectChecks(this.workspace.root);
            const list = checks.length ? checks.map((check) => check.label).join(" · ") : "нет автоматически обнаруженных";
            this.emit({ type: "verification", turnId, content: `Изменены файлы: ${this.currentTurn.changedFiles.join(", ")}\nРекомендуемые проверки: ${list}\nВыполните /verify для запуска с подтверждением.` });
          }
        }
      }
    } catch (error) {
      if (abort.signal.aborted || error?.name === "AbortError") {
        this.emit({ type: "turn_cancelled", turnId });
      } else {
        this.emit({ type: "error", turnId, content: error?.message || "Ошибка выполнения задачи." });
      }
    } finally {
      this.currentTurn = null;
      if (this.pendingApproval) this.resolveApproval("deny");
    }
  }

  cancel() {
    if (!this.currentTurn) return false;
    this.currentTurn.cancelled = true;
    this.currentTurn.abort.abort();
    this.resolveApproval("deny");
    return true;
  }

  close() {
    this.closed = true;
    if (this.currentTurn) this.currentTurn.abort.abort();
    this.resolveApproval("deny");
    this.cancelFullModeActivation();
  }
}
