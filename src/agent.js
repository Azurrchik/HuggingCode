import { createProviderClient, providerPreset } from "./providers.js";

const MAX_TOOL_ROUNDS = 20;

function buildSystemPrompt({ memory = "", permissionMode = "manual", roots = [], tokenMode = "balanced" } = {}) {
  const rootsText = roots.map((entry) => `${entry.primary ? "workspace" : `@${entry.id}`}: ${entry.root}`).join("\n") || "workspace: current directory";
  const modeRule = permissionMode === "plan"
    ? "You are in PLAN MODE. Explore and explain, but do not request write_file, replace_in_file, delete_file, or run_command. Produce a concrete checklist and wait for the user to switch modes before implementation."
    : "The host enforces permission rules for every write, deletion, and command. Explain impactful work briefly before requesting a tool.";
  const memoryLimit = tokenMode === "economy" ? 3_500 : 12_000;
  const economyRule = tokenMode === "economy" ? "Use concise tool inputs and answers. Reuse known workspace facts; avoid repeating long file contents." : "";
  return `You are HuggingCode, a careful terminal coding assistant.
You work only inside the trusted roots shown below. Your task is to help the user understand, change, and verify code.
Trusted roots:\n${rootsText}
Use the available tools when you need actual workspace information. Never invent file contents, command results, or completed changes.
Never ask for, expose, or write credentials, API keys, tokens, .env files, or other secrets. Do not attempt to access files outside the trusted roots.
${modeRule}
${economyRule}
Keep answers concise and practical. Summarize files changed and commands executed after you finish.
${memory ? `\nProject memory (follow it unless it conflicts with safety):\n${memory.slice(0, memoryLimit)}` : ""}`;
}

function getTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || "").join("");
  return "";
}

function asToolMessage(toolCallId, content) {
  return { role: "tool", tool_call_id: toolCallId, content: String(content) };
}

function estimateTokens(value) {
  return Math.ceil(String(value || "").length / 4);
}

function formatModelError(error, provider = "huggingface") {
  if (error?.name === "AbortError") return "Запрос отменён.";
  const label = providerPreset(provider).label;
  const status = error?.response?.status ?? error?.status;
  if (status === 401) return `${label} не принял ключ. Проверьте выбранного провайдера и API key.`;
  if (status === 402) return `Недостаточно кредитов или не настроена оплата у ${label}.`;
  if (status === 403) return `Ключ не имеет доступа к модели или провайдеру ${label}.`;
  if (status === 404) return "Модель или endpoint недоступны. Проверьте модель и настройки провайдера.";
  if (status === 429) return `${label} временно ограничил запросы. Подождите и повторите попытку.`;
  return `Ошибка ${label}: ${error?.message || "неизвестная ошибка"}`;
}

function requestAbortError() {
  const error = new Error("Запрос отменён.");
  error.name = "AbortError";
  return error;
}

function mergeToolDelta(entries, delta) {
  for (const item of delta?.tool_calls || []) {
    const index = Number(item?.index ?? 0);
    const current = entries[index] || { id: "", type: "function", function: { name: "", arguments: "" } };
    if (item.id) current.id = item.id;
    if (item.type) current.type = item.type;
    if (item.function?.name) current.function.name += item.function.name;
    if (item.function?.arguments) current.function.arguments += item.function.arguments;
    entries[index] = current;
  }
}

export async function verifyHuggingFaceToken(token) {
  const response = await fetch("https://huggingface.co/api/whoami-v2", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Токен не принят. Создайте новый токен и убедитесь, что он скопирован полностью.");
    throw new Error(`Не удалось проверить токен: HTTP ${response.status}.`);
  }
  const data = await response.json();
  return data.name || data.fullname || "Hugging Face user";
}

export class CodingAgent {
  constructor({ token, provider = "huggingface", providerEndpoint = "", model, maxTokens, reasoningEffort = "auto", permissionMode = "manual", tokenMode = "balanced", autoCompactThreshold = 48_000, workspace, approve, onEvent, memory = "" }) {
    this.provider = provider;
    this.providerEndpoint = providerEndpoint;
    this.client = createProviderClient({ provider, endpoint: providerEndpoint, token });
    this.model = model;
    this.maxTokens = maxTokens;
    this.reasoningEffort = reasoningEffort;
    this.tokenMode = tokenMode;
    this.autoCompactThreshold = autoCompactThreshold;
    this.permissionMode = permissionMode;
    this.workspace = workspace;
    this.approve = approve;
    this.onEvent = onEvent || (() => {});
    this.memory = memory;
    this.usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
    this.messages = [{ role: "system", content: buildSystemPrompt(this.getPromptState()) }];
  }

  getPromptState() {
    return { memory: this.memory, permissionMode: this.permissionMode, roots: this.workspace.listRoots(), tokenMode: this.tokenMode };
  }

  refreshSystemPrompt() {
    this.messages[0] = { role: "system", content: buildSystemPrompt(this.getPromptState()) };
  }

  setModel(model) { this.model = model; }
  setReasoningEffort(reasoningEffort) { this.reasoningEffort = reasoningEffort; }
  setTokenMode(tokenMode, autoCompactThreshold) { this.tokenMode = tokenMode; this.autoCompactThreshold = autoCompactThreshold; this.refreshSystemPrompt(); }
  setPermissionMode(permissionMode) { this.permissionMode = permissionMode; this.refreshSystemPrompt(); }
  setMemory(memory) { this.memory = memory || ""; this.refreshSystemPrompt(); }
  reset() { this.messages = [{ role: "system", content: buildSystemPrompt(this.getPromptState()) }]; }

  restore(messages) {
    if (!Array.isArray(messages) || !messages.length) throw new Error("Снимок сессии не содержит сообщений.");
    this.messages = structuredClone(messages);
    if (this.messages[0]?.role !== "system") this.messages.unshift({ role: "system", content: buildSystemPrompt(this.getPromptState()) });
    this.refreshSystemPrompt();
  }

  getSnapshot() { return structuredClone(this.messages); }

  getContextStats() {
    const byRole = {};
    let characters = 0;
    for (const message of this.messages) {
      const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
      characters += content.length;
      byRole[message.role] = (byRole[message.role] || 0) + estimateTokens(content);
    }
    return { messageCount: this.messages.length, characters, estimatedTokens: estimateTokens(" ".repeat(characters)), byRole };
  }

  getUsage() { return { ...this.usage }; }

  recordUsage(usage) {
    const promptTokens = Number(usage?.prompt_tokens || 0);
    const completionTokens = Number(usage?.completion_tokens || 0);
    const totalTokens = Number(usage?.total_tokens || promptTokens + completionTokens);
    this.usage.promptTokens += promptTokens;
    this.usage.completionTokens += completionTokens;
    this.usage.totalTokens += totalTokens;
    this.usage.requests += 1;
  }

  buildRequest(messages, tools) {
    const request = { model: this.model, messages, tools, tool_choice: tools.length ? "auto" : undefined, max_tokens: this.maxTokens, temperature: 0.2 };
    if (this.reasoningEffort !== "auto") request.reasoning_effort = this.reasoningEffort;
    return request;
  }

  async requestCompletion(messages, tools = this.workspace.toolDefinitions, signal) {
    const request = this.buildRequest(messages, tools);
    try {
      const completion = await this.client.chatCompletion(request, { signal });
      this.recordUsage(completion?.usage);
      return completion;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw requestAbortError();
      if (this.reasoningEffort !== "auto" && (error?.response?.status === 400 || error?.status === 400)) {
        delete request.reasoning_effort;
        try {
          const completion = await this.client.chatCompletion(request, { signal });
          this.recordUsage(completion?.usage);
          this.onEvent({ type: "warning", content: "Выбранная модель не приняла reasoning_effort; запрос повторён без этого параметра." });
          return completion;
        } catch (fallbackError) {
          if (signal?.aborted || fallbackError?.name === "AbortError") throw requestAbortError();
          throw new Error(formatModelError(fallbackError, this.provider));
        }
      }
      throw new Error(formatModelError(error, this.provider));
    }
  }

  async requestStream(messages, tools = this.workspace.toolDefinitions, signal) {
    const request = this.buildRequest(messages, tools);
    let emitted = false;
    try {
      const stream = this.client.chatCompletionStream(request, { signal });
      let content = "";
      let analysisObserved = false;
      let usage = null;
      const calls = [];
      for await (const chunk of stream) {
        if (signal?.aborted) throw requestAbortError();
        if (chunk?.usage) usage = chunk.usage;
        const delta = chunk?.choices?.[0]?.delta || {};
        const text = getTextContent(delta.content);
        if (text) {
          content += text;
          emitted = true;
          this.onEvent({ type: "text_delta", content: text });
        }
        const thinking = getTextContent(delta.reasoning_content || delta.reasoning || delta.thinking);
        if (thinking && !analysisObserved) {
          analysisObserved = true;
          this.onEvent({ type: "analysis_started" });
        }
        mergeToolDelta(calls, delta);
      }
      const response = { role: "assistant", content, ...(calls.filter(Boolean).length ? { tool_calls: calls.filter(Boolean) } : {}) };
      this.recordUsage(usage);
      return { choices: [{ message: response }], usage, analysisObserved };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw requestAbortError();
      if (emitted) throw new Error(formatModelError(error, this.provider));
      this.onEvent({ type: "warning", content: "Провайдер не поддержал streaming; ответ будет получен обычным запросом." });
      return this.requestCompletion(messages, tools, signal);
    }
  }

  async ask(userMessage, { signal, stream = true } = {}) {
    if (signal?.aborted) throw requestAbortError();
    if (this.tokenMode === "economy" && this.getContextStats().estimatedTokens >= this.autoCompactThreshold) {
      this.onEvent({ type: "warning", content: "Экономия токенов: сжимаю историю перед новым шагом." });
      await this.compact("Keep only decisions, changed files, checks and unresolved tasks.", { signal });
    }
    this.messages.push({ role: "user", content: userMessage });
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (signal?.aborted) throw requestAbortError();
      this.onEvent({ type: "model_request", model: this.model, round: round + 1 });
      const completion = stream ? await this.requestStream(this.messages, this.workspace.toolDefinitions, signal) : await this.requestCompletion(this.messages, this.workspace.toolDefinitions, signal);
      if (signal?.aborted) throw requestAbortError();
      const response = completion?.choices?.[0]?.message;
      if (!response) throw new Error("Hugging Face вернул ответ без сообщения.");
      this.messages.push(response);
      const toolCalls = response.tool_calls || [];
      if (!toolCalls.length) {
        const answer = getTextContent(response.content).trim() || "Готово.";
        this.onEvent({ type: "final", content: answer, usage: completion.usage });
        return answer;
      }
      for (const toolCall of toolCalls) {
        if (signal?.aborted) throw requestAbortError();
        const functionName = toolCall?.function?.name;
        let args = {};
        try {
          args = JSON.parse(toolCall?.function?.arguments || "{}");
        } catch {
          this.messages.push(asToolMessage(toolCall.id, "Инструмент не выполнен: модель передала некорректные JSON-параметры."));
          continue;
        }
        this.onEvent({ type: "tool_request", name: functionName, args });
        try {
          const result = await this.workspace.execute(functionName, args, this.approve);
          this.onEvent({ type: "tool_result", name: functionName, result });
          this.messages.push(asToolMessage(toolCall.id, result));
        } catch (error) {
          const result = `Инструмент не выполнен: ${error.message}`;
          this.onEvent({ type: "tool_result", name: functionName, result });
          this.messages.push(asToolMessage(toolCall.id, result));
        }
      }
    }
    throw new Error("Агент остановлен: превышен лимит из 20 последовательных вызовов инструментов.");
  }

  async askSideQuestion(question, { signal } = {}) {
    const messages = [...this.messages, { role: "user", content: `Side question: ${question}\nAnswer concisely. Do not use tools and do not change the main task.` }];
    const completion = await this.requestCompletion(messages, [], signal);
    const response = completion?.choices?.[0]?.message;
    if (!response) throw new Error("Hugging Face вернул ответ без сообщения.");
    return getTextContent(response.content).trim() || "Нет ответа.";
  }

  async compact(focus = "", { signal } = {}) {
    if (this.messages.length <= 2) return "Контекст уже достаточно короткий.";
    const original = this.messages.slice(1);
    const summaryRequest = [this.messages[0], { role: "user", content: `Summarize the following conversation for continued coding work. Preserve user goals, decisions, exact files changed, command outcomes, unresolved issues, and constraints. Omit secrets. ${focus ? `Focus on: ${focus}` : ""}\n\nConversation:\n${original.map((message) => `${message.role}: ${getTextContent(message.content)}`).join("\n\n")}` }];
    const completion = await this.requestCompletion(summaryRequest, [], signal);
    const summary = getTextContent(completion?.choices?.[0]?.message?.content).trim();
    if (!summary) throw new Error("Модель не вернула резюме контекста.");
    this.messages = [this.messages[0], { role: "assistant", content: `Сжатое резюме предыдущей сессии:\n${summary}` }];
    return "Контекст сжат и заменён локальным резюме.";
  }
}
