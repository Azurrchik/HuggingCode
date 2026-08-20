import * as p from "@clack/prompts";
import chalk from "chalk";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_AUTO_COMPACT_THRESHOLD,
  PERMISSION_MODES,
  REASONING_EFFORTS,
  getConfig,
  getConfigLocation,
  updateConfig,
} from "./config.js";
import { CodingAgent, verifyHuggingFaceToken } from "./agent.js";
import { permissionModeDescriptions, decidePermission } from "./permissions.js";
import { clearStoredToken, getCredentialLocation, getStoredToken, saveToken } from "./storage.js";
import { createWorkspace } from "./workspace.js";
import { branchSession, createSession, getSessionDirectory, listSessions, loadSession, saveSession, sessionToText } from "./session-store.js";
import { getSkillDirectory, listSkills, loadSkill } from "./skills.js";
import { TaskManager } from "./tasks.js";

const TOKEN_URL = "https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained";
const MEMORY_FILE = "HUGGINGCODE.md";

function cancelled(value) {
  if (p.isCancel(value)) {
    p.cancel("Сеанс завершён.");
    process.exit(0);
  }
  return value;
}

function themeColor(theme) {
  const colors = { orange: "#f9b84a", yellow: "#f9e34a", green: "#57d68d", blue: "#67b7ff", purple: "#bf93ff", red: "#ff7585", cyan: "#50d9df", pink: "#ff87c8" };
  return chalk.hex(colors[theme] || colors.orange);
}

function banner(theme = "orange") {
  const color = themeColor(theme);
  console.clear();
  console.log(color.bold("  _   _             _             ____          _      "));
  console.log(color.bold(" | | | |_   _  __ _(_)_ __   __ _ / ___|___   __| | ___ "));
  console.log(color.bold(" | |_| | | | |/ _` | | '_ \\ / _` | |   / _ \\ / _` |/ _  |"));
  console.log(color.bold(" |  _  | |_| | (_| | | | | | (_| | |__| (_) | (_| |  __/"));
  console.log(color.bold(" |_| |_|\\__,_|\\__, |_|_| |_|\\__, |\\____\\___/ \\__,_|\\___|"));
  console.log(color.bold("                |___/         |___/                         "));
  console.log(chalk.dim("  Локальный coding agent с удалёнными моделями Hugging Face\n"));
}

function usage() {
  console.log(chalk.bold("Основные команды"));
  console.log(chalk.dim("  /help                         справка по командам"));
  console.log(chalk.dim("  /model [id] · /effort [level] модель и уровень рассуждений"));
  console.log(chalk.dim("  /mode [режим] · /permissions   режимы manual, accept-edits, plan, safe-auto"));
  console.log(chalk.dim("  /plan [задача] · /goal [текст] планирование и цель"));
  console.log(chalk.dim("  /context · /compact [фокус]    состояние и сжатие контекста"));
  console.log(chalk.dim("  /diff · /review · /security-review · /verify  проверка изменений"));
  console.log(chalk.dim("  /init · /memory [add <текст>]   память и соглашения проекта"));
  console.log(chalk.dim("  /skills · /skill <имя> [args]   пользовательские Markdown-навыки"));
  console.log(chalk.dim("  /subtask <задача> · /tasks · /stop <id>  локальные подзадачи"));
  console.log(chalk.dim("  /rename · /resume · /branch · /rewind · /export  сессии"));
  console.log(chalk.dim("  /status · /doctor · /usage · /config · /debug  настройки и диагностика"));
  console.log(chalk.dim("  /add-dir <путь> · /cd <путь>    доверенные каталоги"));
  console.log(chalk.dim("  /login · /logout · /clear · /exit\n"));
  console.log(chalk.dim("Интеграции с облачными аккаунтами, MCP, удалёнными сессиями и обход подтверждений намеренно не включены в локальную безопасную версию."));
}

async function login() {
  p.note(
    `Откройте ссылку и создайте fine-grained токен с разрешением “Make calls to Inference Providers”.\n${TOKEN_URL}\n\nТокен будет зашифрован Windows DPAPI и привязан к вашей учётной записи Windows.`,
    "Подключение Hugging Face",
  );

  while (true) {
    const token = cancelled(await p.password({
      message: "Вставьте токен Hugging Face",
      validate(value) {
        if (!value?.trim()) return "Токен не может быть пустым.";
        if (!value.trim().startsWith("hf_")) return "Токен должен начинаться с hf_.";
      },
    }));
    const spinner = p.spinner();
    spinner.start("Проверяю токен");
    try {
      const account = await verifyHuggingFaceToken(token.trim());
      await saveToken(token.trim());
      spinner.stop(`Токен принят для ${account}.`);
      return token.trim();
    } catch (error) {
      spinner.stop("Токен не сохранён.");
      p.log.error(error.message);
      const retry = cancelled(await p.confirm({ message: "Попробовать ещё раз?", initialValue: true }));
      if (!retry) throw new Error("Вход отменён.");
    }
  }
}

function preview(content, lines = 14) {
  const contentLines = String(content ?? "").split(/\r?\n/);
  const clipped = contentLines.slice(0, lines).join("\n");
  return contentLines.length > lines ? `${clipped}\n… (${contentLines.length - lines} строк не показано)` : clipped;
}

async function readProjectMemory(workspaceRoot) {
  try {
    const memory = await readFile(path.join(workspaceRoot, MEMORY_FILE), "utf8");
    return memory.slice(0, 12_000);
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw new Error(`Не удалось прочитать ${MEMORY_FILE}.`);
  }
}

function formatModeList(currentMode) {
  return Object.entries(permissionModeDescriptions)
    .map(([mode, description]) => `${mode === currentMode ? "*" : " "} ${mode}: ${description}`)
    .join("\n");
}

function formatTasks(tasks) {
  if (!tasks.length) return "Локальных подзадач пока нет.";
  return tasks.map((task) => {
    const detail = task.status === "completed" ? preview(task.result, 4) : task.error || "выполняется";
    return `${task.id}  [${task.status}]  ${task.title}\n${detail}`;
  }).join("\n\n");
}

function parseCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [name, ...rest] = trimmed.slice(1).split(/\s+/);
  return { name: name.toLowerCase(), args: rest.join(" ").trim() };
}

async function askForExplicitApproval(action, config) {
  const result = decidePermission(config.permissionMode, action);
  if (result.decision === "deny") {
    p.log.warn(result.reason);
    return false;
  }
  if (result.decision === "allow") {
    p.log.step(chalk.dim(`Разрешено режимом ${config.permissionMode}: ${result.reason}`));
    return true;
  }

  if (action.type === "write") {
    p.note(`${chalk.bold("Файл:")} ${action.path}\n${chalk.bold("Причина:")} ${action.reason || "не указана"}\n\n${preview(action.content)}`, "Модель предлагает изменить файл");
    return !p.isCancel(await p.confirm({ message: `Разрешить запись ${action.path}?`, initialValue: false }));
  }
  if (action.type === "delete") {
    p.note(`${chalk.bold("Файл:")} ${action.path}\n${chalk.bold("Причина:")} ${action.reason || "не указана"}`, "Модель предлагает удалить файл");
    return !p.isCancel(await p.confirm({ message: `Разрешить удаление ${action.path}?`, initialValue: false }));
  }

  p.note(`${chalk.bold("Команда:")} ${action.command}\n${chalk.bold("Причина:")} ${action.reason || "не указана"}\n\nКоманда будет выполнена в текущем рабочем каталоге.`, "Модель предлагает выполнить команду");
  return !p.isCancel(await p.confirm({ message: "Разрешить выполнение команды?", initialValue: false }));
}

function eventLogger(event, getConfig) {
  const config = getConfig();
  if (event.type === "model_request") p.log.step(chalk.dim(`Запрос к ${event.model}`));
  if (event.type === "tool_request") p.log.step(chalk.dim(`Инструмент: ${event.name}`));
  if (event.type === "tool_result" && event.name === "run_command") p.log.message(chalk.dim(preview(event.result, 10)));
  if (event.type === "warning") p.log.warn(event.content);
  if (config.debug && !["model_request", "tool_request"].includes(event.type)) p.log.message(chalk.dim(`[debug] ${JSON.stringify(event)}`));
}

async function createRuntime(token, config, options = {}) {
  const workspace = await createWorkspace(options.workspaceRoot || process.cwd(), options.addedDirectories || []);
  const memory = await readProjectMemory(workspace.root);
  const agent = new CodingAgent({
    token,
    model: config.model,
    maxTokens: config.maxTokens,
    reasoningEffort: config.reasoningEffort,
    permissionMode: config.permissionMode,
    workspace,
    memory,
    approve: (action) => askForExplicitApproval(action, config),
    onEvent: (event) => eventLogger(event, () => config),
  });
  if (options.messages) agent.restore(options.messages);
  return { agent, workspace, memory };
}

async function applyConfig(state, patch) {
  const next = await updateConfig(patch);
  Object.assign(state.config, next);
  state.agent.setModel(state.config.model);
  state.agent.setReasoningEffort(state.config.reasoningEffort);
  state.agent.setPermissionMode(state.config.permissionMode);
  return state.config;
}

async function persistCurrentSession(state, checkpointLabel = "turn") {
  const roots = state.workspace.listRoots().filter((root) => !root.primary).map((root) => root.root);
  const checkpoints = Array.isArray(state.session.metadata?.checkpoints) ? state.session.metadata.checkpoints : [];
  const checkpoint = { createdAt: new Date().toISOString(), label: checkpointLabel, messages: state.agent.getSnapshot() };
  state.session = await saveSession({
    ...state.session,
    workspaceRoot: state.workspace.root,
    messages: state.agent.getSnapshot(),
    metadata: {
      ...state.session.metadata,
      addedDirectories: roots,
      goal: state.goal || "",
      checkpoints: [...checkpoints, checkpoint].slice(-8),
    },
  });
}

async function runAgentTurn(state, prompt, label = "turn") {
  const goalPrefix = state.goal ? `Active goal for this session: ${state.goal}\n\n` : "";
  const answer = await state.agent.ask(`${goalPrefix}${prompt}`);
  p.log.message(`\n${chalk.bold("HuggingCode")}\n${answer}\n`);
  await persistCurrentSession(state, label);
  const stats = state.agent.getContextStats();
  if (stats.estimatedTokens >= state.config.autoCompactThreshold) {
    p.log.warn(`Контекст приблизился к порогу ${state.config.autoCompactThreshold.toLocaleString()} токенов. Выполните /compact, чтобы продолжить с резюме.`);
  }
}

async function runReadOnlyAgentTurn(state, prompt, label) {
  const originalMode = state.agent.permissionMode;
  state.agent.setPermissionMode("plan");
  try {
    await runAgentTurn(state, prompt, label);
  } finally {
    state.agent.setPermissionMode(originalMode);
  }
}

async function executeReviewPrompt(state, label, instruction) {
  const spinner = p.spinner();
  const originalMode = state.agent.permissionMode;
  spinner.start(label);
  try {
    state.agent.setPermissionMode("plan");
    const answer = await state.agent.ask(instruction);
    spinner.stop(`${label}: готово.`);
    p.log.message(`\n${chalk.bold("HuggingCode")}\n${answer}\n`);
    await persistCurrentSession(state, label);
  } catch (error) {
    spinner.stop(`${label}: ошибка.`);
    p.log.error(error.message);
  } finally {
    state.agent.setPermissionMode(originalMode);
  }
}

async function handleCommand(state, input) {
  const parsed = parseCommand(input);
  if (!parsed) return false;
  const { name, args } = parsed;

  if (["exit", "quit"].includes(name)) {
    await persistCurrentSession(state, "exit");
    p.outro("До встречи.");
    return "exit";
  }
  if (name === "help") {
    usage();
    return true;
  }
  if (["clear", "reset", "new"].includes(name)) {
    await persistCurrentSession(state, args || "before clear");
    state.agent.reset();
    state.session = await createSession({ name: args || "Новая сессия", workspaceRoot: state.workspace.root, messages: state.agent.getSnapshot(), metadata: { goal: state.goal } });
    state.goal = "";
    p.log.success("Создана новая чистая сессия. Предыдущая сохранена локально.");
    return true;
  }
  if (name === "status") {
    const stats = state.agent.getContextStats();
    p.note(`Модель: ${state.config.model}\nУсилие: ${state.config.reasoningEffort}\nРежим: ${state.config.permissionMode}\nРабочая область: ${state.workspace.root}\nСессия: ${state.session.name} (${state.session.id})\nСообщений: ${stats.messageCount}\nХранилище токена: ${getCredentialLocation()}`, "Статус HuggingCode");
    return true;
  }
  if (name === "model") {
    if (!args) {
      p.log.info(`Текущая модель: ${state.agent.model}`);
      return true;
    }
    await applyConfig(state, { model: args });
    state.agent.setModel(state.config.model);
    p.log.success(`Модель изменена: ${state.config.model}`);
    return true;
  }
  if (name === "effort") {
    if (!args) {
      p.log.info(`Текущий уровень рассуждений: ${state.config.reasoningEffort}. Допустимо: ${REASONING_EFFORTS.join(", ")}.`);
      return true;
    }
    if (!REASONING_EFFORTS.includes(args)) {
      p.log.error(`Неизвестный уровень. Допустимо: ${REASONING_EFFORTS.join(", ")}.`);
      return true;
    }
    await applyConfig(state, { reasoningEffort: args });
    state.agent.setReasoningEffort(args);
    p.log.success(`Уровень рассуждений: ${args}`);
    return true;
  }
  if (["mode", "permissions", "allowed-tools"].includes(name)) {
    if (!args || name !== "mode") {
      p.note(formatModeList(state.config.permissionMode), "Режимы разрешений");
      if (!args) return true;
    }
    if (!PERMISSION_MODES.includes(args)) {
      p.log.error(`Неизвестный режим. Допустимо: ${PERMISSION_MODES.join(", ")}.`);
      return true;
    }
    await applyConfig(state, { permissionMode: args });
    state.agent.setPermissionMode(args);
    p.log.success(`Режим разрешений изменён: ${args}`);
    return true;
  }
  if (name === "plan") {
    if (state.config.permissionMode !== "plan") {
      await applyConfig(state, { permissionMode: "plan" });
      state.agent.setPermissionMode("plan");
      p.log.success("Включён режим plan: запись файлов и команды заблокированы.");
    }
    if (args) await runAgentTurn(state, `Create a concrete implementation plan for this task. Explore the workspace as needed, but do not make changes: ${args}`, "plan");
    return true;
  }
  if (name === "goal") {
    if (!args) {
      p.log.info(state.goal ? `Активная цель: ${state.goal}` : "Активной цели нет.");
      return true;
    }
    if (["clear", "stop", "off", "reset", "none", "cancel"].includes(args.toLowerCase())) {
      state.goal = "";
      p.log.success("Цель очищена.");
    } else {
      state.goal = args;
      p.log.success(`Цель сохранена: ${state.goal}`);
    }
    await persistCurrentSession(state, "goal");
    return true;
  }
  if (name === "context") {
    const stats = state.agent.getContextStats();
    const breakdown = Object.entries(stats.byRole).map(([role, tokens]) => `${role}: ~${tokens.toLocaleString()}`).join("\n");
    p.note(`Сообщений: ${stats.messageCount}\nСимволов: ${stats.characters.toLocaleString()}\nОценка: ~${stats.estimatedTokens.toLocaleString()} токенов\nПорог авто-подсказки: ${state.config.autoCompactThreshold.toLocaleString()}\n\n${breakdown}`, "Контекст");
    return true;
  }
  if (name === "compact") {
    const spinner = p.spinner();
    spinner.start("Сжимаю контекст через выбранную модель");
    try {
      const result = await state.agent.compact(args);
      spinner.stop(result);
      await persistCurrentSession(state, "compact");
    } catch (error) {
      spinner.stop("Контекст не сжат.");
      p.log.error(error.message);
    }
    return true;
  }
  if (name === "autocompact") {
    if (!args) {
      p.log.info(`Порог авто-подсказки: ${state.config.autoCompactThreshold.toLocaleString()} токенов. Используйте /autocompact <4000-1000000> или /autocompact auto.`);
      return true;
    }
    const threshold = args === "auto" ? DEFAULT_AUTO_COMPACT_THRESHOLD : Number(args.replace(/[kK]$/, "000"));
    if (!Number.isInteger(threshold) || threshold < 4000 || threshold > 1_000_000) {
      p.log.error("Укажите целое значение от 4000 до 1000000, например /autocompact 50000.");
      return true;
    }
    await applyConfig(state, { autoCompactThreshold: threshold });
    p.log.success(`Порог контекста: ${threshold.toLocaleString()} токенов.`);
    return true;
  }
  if (name === "btw") {
    if (!args) {
      p.log.error("Использование: /btw <побочный вопрос>");
      return true;
    }
    const spinner = p.spinner();
    spinner.start("Задаю побочный вопрос без изменения основной сессии");
    try {
      const answer = await state.agent.askSideQuestion(args);
      spinner.stop("Ответ получен.");
      p.note(answer, "BTW");
    } catch (error) {
      spinner.stop("Ошибка побочного вопроса.");
      p.log.error(error.message);
    }
    return true;
  }
  if (name === "init") {
    const existing = await readProjectMemory(state.workspace.root);
    if (existing) {
      p.note(existing, `${MEMORY_FILE} уже существует`);
      return true;
    }
    const template = `# ${MEMORY_FILE}\n\n## Project conventions\n\n- Describe the project’s commands, test workflow, style, and constraints here.\n- Never commit secrets.\n- Keep changes focused and verify them before completion.\n`;
    const allowed = await askForExplicitApproval({ type: "write", path: MEMORY_FILE, content: template, reason: "Создание памяти и соглашений проекта" }, state.config);
    if (allowed) {
      await state.workspace.writeTextFile(MEMORY_FILE, template);
      state.memory = template;
      state.agent.setMemory(template);
      p.log.success(`${MEMORY_FILE} создан.`);
    }
    return true;
  }
  if (name === "memory") {
    if (!args) {
      p.note(state.memory || `${MEMORY_FILE} пока не создан. Выполните /init или /memory add <инструкция>.`, "Память проекта");
      return true;
    }
    if (args.startsWith("add ")) {
      const addition = args.slice(4).trim();
      if (!addition) {
        p.log.error("Добавьте текст после /memory add.");
        return true;
      }
      const next = `${state.memory || `# ${MEMORY_FILE}\n\n## Project conventions\n`}\n- ${addition}\n`;
      const allowed = await askForExplicitApproval({ type: "write", path: MEMORY_FILE, content: next, reason: "Добавление инструкции в память проекта" }, state.config);
      if (allowed) {
        await state.workspace.writeTextFile(MEMORY_FILE, next);
        state.memory = next;
        state.agent.setMemory(next);
        p.log.success("Память проекта обновлена.");
      }
      return true;
    }
    p.log.error("Использование: /memory или /memory add <инструкция>.");
    return true;
  }
  if (name === "diff") {
    p.note(await state.workspace.getGitDiff({}), "Git diff");
    return true;
  }
  if (["review", "code-review"].includes(name)) {
    await executeReviewPrompt(state, "Проверка изменений", `Review the current Git diff for correctness issues, regressions, missing tests, and maintainability. Read the diff and relevant files. Do not make edits. ${args ? `Review focus: ${args}` : ""}`);
    return true;
  }
  if (name === "security-review") {
    await executeReviewPrompt(state, "Проверка безопасности", "Review the current Git diff and relevant code for security risks such as injection, auth failures, unsafe data handling, secrets exposure, and authorization gaps. Do not make edits. Report findings by severity with concrete remediation.");
    return true;
  }
  if (name === "simplify") {
    await executeReviewPrompt(state, "Поиск упрощений", `Inspect the current diff and relevant code for safe simplifications, duplication, unnecessary complexity, and performance improvements. Do not make edits; provide a prioritized list. ${args ? `Focus: ${args}` : ""}`);
    return true;
  }
  if (["run", "verify"].includes(name)) {
    await runAgentTurn(state, `Verify the project change. Inspect package scripts and repository guidance, then propose and run the smallest relevant verification commands after required approvals. Report observed results, not guesses. ${args ? `Verification target: ${args}` : ""}`, name);
    return true;
  }
  if (name === "usage" || name === "cost" || name === "stats") {
    const usage = state.agent.getUsage();
    p.note(`Запросов модели: ${usage.requests}\nВходных токенов: ${usage.promptTokens.toLocaleString()}\nВыходных токенов: ${usage.completionTokens.toLocaleString()}\nВсего токенов: ${usage.totalTokens.toLocaleString()}\n\nHuggingCode не вычисляет цену: она зависит от модели, провайдера и настроек Hugging Face.`, "Использование в этой сессии");
    return true;
  }
  if (["config", "settings"].includes(name)) {
    if (!args || args === "--help") {
      p.note(`model=${state.config.model}\nmaxTokens=${state.config.maxTokens}\npermissionMode=${state.config.permissionMode}\nreasoningEffort=${state.config.reasoningEffort}\nautoCompactThreshold=${state.config.autoCompactThreshold}\ntheme=${state.config.theme}\ndebug=${state.config.debug}\n\nИзменение: /config ключ=значение. Поддерживаются model, maxTokens, permissionMode, reasoningEffort, autoCompactThreshold, theme, debug.`, "Настройки");
      return true;
    }
    const patch = {};
    for (const pair of args.split(/\s+/)) {
      const index = pair.indexOf("=");
      if (index < 1) {
        p.log.error(`Ожидался формат ключ=значение: ${pair}`);
        return true;
      }
      const key = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (key === "model") patch.model = value;
      else if (key === "maxTokens" || key === "autoCompactThreshold") patch[key] = Number(value);
      else if (key === "permissionMode" || key === "mode") patch.permissionMode = value;
      else if (key === "reasoningEffort" || key === "effort") patch.reasoningEffort = value;
      else if (key === "theme") patch.theme = value;
      else if (key === "debug") patch.debug = value === "true" || value === "on";
      else {
        p.log.error(`Неизвестный ключ: ${key}`);
        return true;
      }
    }
    await applyConfig(state, patch);
    state.agent.setModel(state.config.model);
    state.agent.setReasoningEffort(state.config.reasoningEffort);
    state.agent.setPermissionMode(state.config.permissionMode);
    p.log.success("Настройки сохранены.");
    return true;
  }
  if (["color", "theme"].includes(name)) {
    if (!args) {
      p.log.info(`Текущая цветовая схема: ${state.config.theme}. Допустимо: orange, yellow, green, blue, purple, red, cyan, pink.`);
      return true;
    }
    await applyConfig(state, { theme: args });
    p.log.success("Цветовая схема сохранена. Она будет применена при следующем запуске.");
    return true;
  }
  if (name === "debug") {
    if (!args) {
      p.log.info(`Отладочный журнал: ${state.config.debug ? "включён" : "выключен"}. Используйте /debug on или /debug off.`);
      return true;
    }
    await applyConfig(state, { debug: ["on", "true"].includes(args) });
    p.log.success(`Отладочный журнал ${state.config.debug ? "включён" : "выключен"}.`);
    return true;
  }
  if (["doctor", "checkup"].includes(name)) {
    const git = await state.workspace.getGitStatus();
    const skills = await listSkills(state.workspace.root);
    p.note(`Node.js: ${process.version}\nРабочая область: ${state.workspace.root}\nКонфиг: ${getConfigLocation()}\nСессии: ${getSessionDirectory()}\nНавыки: ${skills.length} (${getSkillDirectory(state.workspace.root)})\n\nGit:\n${git}`, "Диагностика");
    return true;
  }
  if (name === "add-dir") {
    if (!args) {
      p.log.error("Использование: /add-dir <путь к каталогу>.");
      return true;
    }
    const yes = cancelled(await p.confirm({ message: `Добавить доверенный каталог ${args} к этой сессии? Модель сможет читать и менять его по текущим правилам.`, initialValue: false }));
    if (yes) {
      try {
        const id = await state.workspace.addDirectory(args);
        state.agent.refreshSystemPrompt();
        await persistCurrentSession(state, "add-dir");
        p.log.success(`Каталог добавлен как @${id}. Используйте пути вида @${id}/файл.`);
      } catch (error) {
        p.log.error(error.message);
      }
    }
    return true;
  }
  if (name === "cd") {
    if (!args) {
      p.log.error("Использование: /cd <путь к новому рабочему каталогу>.");
      return true;
    }
    const yes = cancelled(await p.confirm({ message: `Перейти сессией в ${args}? Новая рабочая область станет основным доверенным каталогом.`, initialValue: false }));
    if (yes) {
      try {
        const oldMessages = state.agent.getSnapshot();
        const oldRoots = state.workspace.listRoots().filter((root) => !root.primary).map((root) => root.root);
        const runtime = await createRuntime(state.token, state.config, { workspaceRoot: args, addedDirectories: oldRoots, messages: oldMessages });
        state.agent = runtime.agent;
        state.workspace = runtime.workspace;
        state.memory = runtime.memory;
        await persistCurrentSession(state, "cd");
        p.log.success(`Рабочая область изменена: ${state.workspace.root}`);
      } catch (error) {
        p.log.error(error.message);
      }
    }
    return true;
  }
  if (name === "skills" || name === "reload-skills") {
    const skills = await listSkills(state.workspace.root);
    p.note(skills.length ? skills.map((skill) => `${skill.name}: ${skill.description}`).join("\n") : `Навыки не найдены. Создайте Markdown-файлы в ${getSkillDirectory(state.workspace.root)}.`, name === "reload-skills" ? "Навыки перечитаны" : "Доступные навыки");
    return true;
  }
  if (name === "skill") {
    const [skillName, ...skillArgs] = args.split(/\s+/);
    if (!skillName) {
      p.log.error("Использование: /skill <имя> [аргументы].");
      return true;
    }
    try {
      const skill = await loadSkill(state.workspace.root, skillName, skillArgs.join(" "));
      await runAgentTurn(state, `Run the user-invoked project skill “${skill.name}”. Follow its instructions precisely within the existing safety boundaries.\n\n${skill.prompt}`, `skill:${skill.name}`);
    } catch (error) {
      p.log.error(error.message);
    }
    return true;
  }
  if (name === "subtask") {
    if (!args) {
      p.log.error("Использование: /subtask <задача для исследования>.");
      return true;
    }
    const task = state.tasks.start(args, () => state.agent.askSideQuestion(`Investigate this independently for the main coding task. Read no files and make no changes; provide a concise technical recommendation based on the conversation: ${args}`));
    p.log.success(`Подзадача запущена: ${task.id}. Используйте /tasks для результата.`);
    return true;
  }
  if (["tasks", "bashes", "list-agents", "agents"].includes(name)) {
    if (args) {
      const task = state.tasks.get(args);
      p.note(task ? formatTasks([task]) : "Подзадача не найдена.", "Подзадачи");
    } else {
      p.note(formatTasks(state.tasks.list()), "Подзадачи");
    }
    return true;
  }
  if (name === "stop") {
    if (!args) {
      p.log.error("Использование: /stop <id подзадачи>.");
      return true;
    }
    try {
      const task = state.tasks.stop(args);
      p.log.success(`Подзадача ${task.id} остановлена.`);
    } catch (error) {
      p.log.error(error.message);
    }
    return true;
  }
  if (name === "batch") {
    if (!args) {
      p.log.error("Использование: /batch <крупная задача>.");
      return true;
    }
    await runReadOnlyAgentTurn(state, `You are in a local CLI without cloud worktrees or pull-request automation. Decompose this task into independently verifiable work packages, identify dependencies and risks, then produce an ordered plan. Do not make changes: ${args}`, "batch-plan");
    return true;
  }
  if (name === "rename") {
    if (!args) {
      p.log.info(`Текущая сессия: ${state.session.name}`);
      return true;
    }
    state.session.name = args.slice(0, 120);
    await persistCurrentSession(state, "rename");
    p.log.success("Сессия переименована.");
    return true;
  }
  if (["resume", "continue"].includes(name)) {
    if (!args) {
      const sessions = await listSessions();
      p.note(sessions.length ? sessions.map((item) => `${item.id}\n  ${item.name} · ${item.updatedAt} · ${item.workspaceRoot}`).join("\n\n") : "Сохранённых сессий нет.", "Сохранённые сессии — используйте /resume <id>");
      return true;
    }
    try {
      const loaded = await loadSession(args);
      const yes = cancelled(await p.confirm({ message: `Возобновить «${loaded.name}» в ${loaded.workspaceRoot}?`, initialValue: false }));
      if (yes) {
        const runtime = await createRuntime(state.token, state.config, { workspaceRoot: loaded.workspaceRoot, addedDirectories: loaded.metadata?.addedDirectories || [], messages: loaded.messages });
        state.agent = runtime.agent;
        state.workspace = runtime.workspace;
        state.memory = runtime.memory;
        state.session = loaded;
        state.goal = loaded.metadata?.goal || "";
        p.log.success(`Сессия возобновлена: ${loaded.name}`);
      }
    } catch (error) {
      p.log.error(error.message);
    }
    return true;
  }
  if (name === "branch") {
    await persistCurrentSession(state, "before branch");
    state.session = await branchSession(state.session, args || `${state.session.name} — ветка`);
    state.agent.restore(state.session.messages);
    p.log.success(`Создана и открыта ветка сессии: ${state.session.name}`);
    return true;
  }
  if (["rewind", "checkpoint", "undo"].includes(name)) {
    const checkpoints = Array.isArray(state.session.metadata?.checkpoints) ? state.session.metadata.checkpoints : [];
    if (name === "checkpoint" && !args) {
      await persistCurrentSession(state, "ручная контрольная точка");
      p.log.success("Контрольная точка сохранена.");
      return true;
    }
    if (!checkpoints.length) {
      p.log.warn("Контрольных точек пока нет. Они создаются после каждого ответа и через /checkpoint.");
      return true;
    }
    const index = Math.max(1, Number(args) || 1);
    const checkpoint = checkpoints.at(-index);
    if (!checkpoint) {
      p.log.error(`Доступно контрольных точек: ${checkpoints.length}.`);
      return true;
    }
    const yes = cancelled(await p.confirm({ message: `Восстановить контрольную точку «${checkpoint.label}» от ${checkpoint.createdAt}?`, initialValue: false }));
    if (yes) {
      state.agent.restore(checkpoint.messages);
      await persistCurrentSession(state, "rewind");
      p.log.success("Контекст восстановлен из контрольной точки. Изменения файлов не откатываются автоматически.");
    }
    return true;
  }
  if (name === "export") {
    const filename = args || `huggingcode-session-${state.session.id}.md`;
    if (filename.includes("..") || path.isAbsolute(filename)) {
      p.log.error("Экспорт должен быть относительным путём внутри рабочей области.");
      return true;
    }
    const content = sessionToText({ ...state.session, messages: state.agent.getSnapshot() });
    const allowed = await askForExplicitApproval({ type: "write", path: filename, content, reason: "Экспорт локальной расшифровки сессии" }, state.config);
    if (allowed) {
      await state.workspace.writeTextFile(filename, content);
      p.log.success(`Сессия экспортирована: ${filename}`);
    }
    return true;
  }
  if (name === "login") {
    state.token = await login();
    const runtime = await createRuntime(state.token, state.config, { workspaceRoot: state.workspace.root, addedDirectories: state.workspace.listRoots().filter((root) => !root.primary).map((root) => root.root) });
    state.agent = runtime.agent;
    state.workspace = runtime.workspace;
    state.memory = runtime.memory;
    p.log.success("Токен обновлён. Контекст текущей сессии очищен.");
    return true;
  }
  if (name === "logout") {
    const yes = cancelled(await p.confirm({ message: "Удалить локально сохранённый токен?", initialValue: false }));
    if (yes) {
      await clearStoredToken();
      p.log.success("Токен удалён. Перезапустите HuggingCode для нового входа.");
      return "exit";
    }
    return true;
  }
  if (["feedback", "bug", "share"].includes(name)) {
    p.note("Отправка данных во внешние сервисы не реализована. Для приватности сформулируйте описание проблемы в локальном файле проекта или обратитесь в используемый сервис Hugging Face.", "Обратная связь");
    return true;
  }

  const directSkill = await listSkills(state.workspace.root).then((skills) => skills.find((skill) => skill.name === name));
  if (directSkill) {
    const skill = await loadSkill(state.workspace.root, name, args);
    await runAgentTurn(state, `Run the user-invoked project skill “${skill.name}”. Follow its instructions precisely within the existing safety boundaries.\n\n${skill.prompt}`, `skill:${skill.name}`);
    return true;
  }

  const unsupported = new Set(["mcp", "plugin", "hooks", "background", "bg", "fork", "remote-control", "rc", "teleport", "tp", "schedule", "loop", "proactive", "autofix-pr", "desktop", "app", "chrome", "mobile", "voice", "web-setup", "design-sync", "design-login", "install-github-app", "install-slack-app", "privacy-settings", "upgrade", "usage-credits", "sandbox", "terminal-setup", "tui", "keybindings", "focus", "statusline", "insights", "heapdump", "radio", "stickers", "powerup", "release-notes", "import", "claude-api", "dataviz", "deep-research"]);
  if (unsupported.has(name)) {
    p.note("Эта команда зависит от внешней облачной инфраструктуры, сторонних учётных записей, постоянных фоновых процессов или фирменных интеграций. В самостоятельной локальной версии HuggingCode она намеренно не реализована. Используйте доступные локальные аналоги: /skills, /subtask, /batch, /doctor, /review, /verify и /plan.", `/${name} недоступна`);
    return true;
  }

  p.log.error(`Неизвестная команда: /${name}. Используйте /help.`);
  return true;
}

export async function startInteractive() {
  let config = await getConfig();
  banner(config.theme);
  p.intro(themeColor(config.theme).black(" HuggingCode "));

  let token = await getStoredToken();
  if (!token) token = await login();

  const runtime = await createRuntime(token, config);
  const state = {
    token,
    config,
    agent: runtime.agent,
    workspace: runtime.workspace,
    memory: runtime.memory,
    session: await createSession({ name: "Новая сессия", workspaceRoot: runtime.workspace.root, messages: runtime.agent.getSnapshot() }),
    tasks: new TaskManager(),
    goal: "",
  };

  p.log.success(`Рабочий каталог: ${state.workspace.root}`);
  p.log.info(`Модель: ${state.config.model} · режим: ${state.config.permissionMode}`);
  usage();

  while (true) {
    const input = cancelled(await p.text({ message: themeColor(state.config.theme)(">"), placeholder: "Что нужно сделать в этом проекте?" }));
    const command = input.trim();
    if (!command) continue;

    try {
      const handled = await handleCommand(state, command);
      if (handled === "exit") return;
      if (!handled) await runAgentTurn(state, command);
    } catch (error) {
      p.log.error(error.message);
    }
  }
}
