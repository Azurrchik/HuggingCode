const $ = (selector) => document.querySelector(selector);
const tauri = window.__TAURI__;
const bridge = tauri?.core?.invoke ? {
  call: (method, params = {}) => tauri.core.invoke("bridge_call", { method, params }),
  bootstrap() { return this.call("bootstrap"); },
  login(token) { return this.call("login", { token }); },
  submit(input) { return this.call("submit", { input }); },
  async chooseWorkspace() {
    const path = await tauri.core.invoke("choose_workspace");
    return path ? this.call("setWorkspace", { path }) : { canceled: true };
  },
  approve(allow) { return this.call("approval", { allow }); },
  enableFullMode(phrase) { return this.call("fullMode", { phrase }); },
  cancel() { return this.call("cancel"); },
  status() { return this.call("status"); },
  settings() { return this.call("settings"); },
  selectModel(modelId, policy) { return this.call("selectModel", { modelId, policy }); },
  selectTheme(theme) { return this.call("selectTheme", { theme }); },
  onEvent(listener) { return tauri.event.listen("agent:event", (event) => listener(event.payload)); },
} : window.huggingcode;
const state = { events: [], view: "chat", status: {}, liveByTurn: new Map() };
const THEMES = {
  ember: { accent: "#f6ad55", soft: "#dd6b20", success: "#68d391", info: "#90cdf4" },
  ocean: { accent: "#63b3ed", soft: "#3182ce", success: "#68d391", info: "#9f7aea" },
  forest: { accent: "#68d391", soft: "#38a169", success: "#9ae6b4", info: "#90cdf4" },
  violet: { accent: "#b794f4", soft: "#805ad5", success: "#68d391", info: "#90cdf4" },
  midnight: { accent: "#2dd4bf", soft: "#0f766e", success: "#86efac", info: "#67e8f9" },
  rose: { accent: "#f472b6", soft: "#db2777", success: "#86efac", info: "#c4b5fd" },
  mono: { accent: "#e5e7eb", soft: "#9ca3af", success: "#d1d5db", info: "#bfdbfe" },
};

function applyTheme(name) {
  const colors = THEMES[name] || THEMES.ember;
  const root = document.documentElement.style;
  root.setProperty("--accent", colors.accent);
  root.setProperty("--accent-soft", colors.soft);
  root.setProperty("--success", colors.success);
  root.setProperty("--violet", colors.info);
}

function text(value) { return String(value ?? ""); }
function escapePreview(value, limit = 520) {
  const normalized = text(value).replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}
function time(value) { return new Date(value || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function eventKind(event) {
  if (event.type === "user") return "user";
  if (event.type === "activity" || event.type === "turn_started") return "activity";
  if (event.type === "tool_started") return "tool";
  if (["tool_result", "verification"].includes(event.type)) return "result";
  if (event.type === "error" || event.level === "error") return "error";
  if (["assistant_final", "text_delta"].includes(event.type)) return "assistant";
  return "activity";
}
function eventLabel(event) {
  const map = { user: "USER", turn_started: "STEP", activity: "ACTIVITY", text_delta: "ASSISTANT", assistant_final: "ASSISTANT", tool_started: "TOOL", tool_result: "RESULT", verification: "VERIFY", notice: "INFO", warning: "WARN", error: "ERROR", turn_cancelled: "CANCELLED" };
  return event.tool ? `${map[event.type] || "EVENT"} · ${event.tool}` : (map[event.type] || "EVENT");
}
function appendEvent(incoming) {
  const event = { ...incoming, createdAt: incoming.createdAt || Date.now() };
  if (event.type === "text_delta") {
    const existing = state.liveByTurn.get(event.turnId);
    if (existing) { existing.content += event.content || ""; render(); return; }
    state.liveByTurn.set(event.turnId, event);
    state.events.push(event);
  } else if (event.type === "assistant_final") {
    const existing = state.liveByTurn.get(event.turnId);
    if (existing) {
      existing.type = "assistant_final";
      existing.content = event.content || existing.content;
      state.liveByTurn.delete(event.turnId);
    } else state.events.push(event);
  } else state.events.push(event);
  if (event.type === "activity") $("#activity").textContent = text(event.content);
  if (event.type === "tool_started") $("#activity").textContent = `Выполняю: ${text(event.content)}`;
  if (event.type === "tool_result") $("#activity").textContent = `Завершено: ${event.tool || "действие"}`;
  if (event.type === "assistant_final") $("#activity").textContent = "Ответ готов.";
  if (event.type === "theme_changed") applyTheme(event.theme);
  if (event.type === "approval_requested") showApproval(event.action);
  if (event.type === "full_mode_requested") showFullMode(event);
  if (event.type === "model_picker_requested" || event.type === "theme_picker_requested") openSettings();
  render();
}
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function renderChat() {
  const target = $("#chat-view"); target.replaceChildren();
  for (const event of state.events) {
    if (!["user", "turn_started", "activity", "text_delta", "assistant_final", "tool_started", "tool_result", "verification", "notice", "warning", "error", "turn_cancelled"].includes(event.type)) continue;
    const kind = eventKind(event);
    const card = element("article", `message ${kind}${event.type === "text_delta" ? " live" : ""}`);
    card.append(element("div", "message-header", `${eventLabel(event)} · ${time(event.createdAt)}`));
    card.append(element("div", "message-content", event.type === "activity" ? text(event.content) : text(event.content || event.details || "…")));
    target.append(card);
  }
  target.scrollTop = target.scrollHeight;
}
function renderTrajectory() {
  const target = $("#trajectory-view"); target.replaceChildren();
  const query = $("#search").value.trim().toLowerCase();
  const events = state.events.filter((event) => `${event.type} ${event.tool || ""} ${event.content || ""}`.toLowerCase().includes(query));
  target.append(element("div", "trajectory-summary", `Наблюдаемые события: ${events.length}. Здесь отображаются этапы, вызовы инструментов и результаты; скрытые рассуждения и системные инструкции не выводятся.`));
  for (const event of events) {
    if (event.type === "text_delta") continue;
    const kind = eventKind(event);
    const card = element("article", `event ${kind}`);
    const head = element("div", "event-head");
    head.append(element("span", "", eventLabel(event)));
    head.append(element("time", "", time(event.createdAt)));
    card.append(head);
    card.append(element("div", "event-body", escapePreview(event.content || event.details || "…")));
    target.append(card);
  }
}
function render() { renderChat(); renderTrajectory(); }
function setView(view) {
  state.view = view;
  $("#chat-view").classList.toggle("hidden", view !== "chat");
  $("#trajectory-view").classList.toggle("hidden", view !== "trajectory");
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
}
function showApproval(action) {
  const panel = $("#approval"); panel.replaceChildren(); panel.classList.remove("hidden");
  panel.append(element("h3", "", "Требуется подтверждение"));
  panel.append(element("p", "", text(action?.reason || "Агент хочет выполнить действие в workspace.")));
  panel.append(element("pre", "", JSON.stringify(action, null, 2)));
  const actions = element("div", "approval-actions");
  const deny = element("button", "ghost", "Отклонить");
  const allow = element("button", "primary", "Разрешить");
  deny.onclick = async () => { await bridge.approve(false); panel.classList.add("hidden"); };
  allow.onclick = async () => { await bridge.approve(true); panel.classList.add("hidden"); };
  actions.append(deny, allow); panel.append(actions);
}
function showFullMode(event) {
  const panel = $("#approval"); panel.replaceChildren(); panel.classList.remove("hidden");
  panel.append(element("h3", "", "Включение FULL MODE"));
  panel.append(element("p", "", "Режим действует только в этом сеансе. Он не отменяет границы workspace, защиту секретов и блокировку опасных shell-действий."));
  const input = element("input", ""); input.placeholder = `Введите: ${event.phrase}`; panel.append(input);
  const actions = element("div", "approval-actions");
  const cancel = element("button", "ghost", "Отмена"); const enable = element("button", "primary", "Включить");
  cancel.onclick = () => panel.classList.add("hidden");
  enable.onclick = async () => { const ok = await bridge.enableFullMode(input.value); if (ok) panel.classList.add("hidden"); };
  actions.append(cancel, enable); panel.append(actions);
}
async function send() {
  const prompt = $("#prompt"); const value = prompt.value.trim(); if (!value) return;
  prompt.value = ""; $("#send").disabled = true;
  try { state.status = await bridge.submit(value); updateStatus(); } catch (error) { appendEvent({ type: "error", content: error.message }); }
  finally { $("#send").disabled = false; }
}
function updateStatus() {
  const status = state.status || {};
  $("#model").textContent = text(status.model || "");
  $("#workspace-path").textContent = text(status.workspace || "workspace");
  const mode = $("#mode"); mode.textContent = text(status.mode || "manual"); mode.classList.toggle("full", status.mode === "full");
  applyTheme(status.theme);
}
async function openSettings() {
  const panel = $("#settings"); panel.replaceChildren();
  try {
    const data = await bridge.settings();
    const current = data.status || state.status;
    panel.append(element("h2", "", "Модель и оформление"));
    panel.append(element("p", "", "Изменения применяются к текущему сеансу. Trajectory сохраняет историю наблюдаемых шагов."));
    const modelLabel = element("label", "", "Модель Hugging Face");
    const model = element("select", "");
    for (const item of data.models || []) { const option = element("option", "", item.label ? `${item.label} — ${item.id}` : item.id); option.value = item.id; option.selected = item.id === current.model?.replace(/:(fastest|cheapest|preferred)$/, ""); model.append(option); }
    const policyLabel = element("label", "", "Стратегия маршрутизации");
    const policy = element("select", "");
    for (const value of ["fastest", "cheapest", "preferred"]) { const option = element("option", "", value); option.value = value; option.selected = current.model?.endsWith(`:${value}`); policy.append(option); }
    const themeLabel = element("label", "", "Цвет интерфейса");
    const theme = element("select", "");
    for (const item of data.themes || []) { const option = element("option", "", `${item.label} — ${item.description}`); option.value = item.id; option.selected = item.id === current.theme; theme.append(option); }
    panel.append(modelLabel, model, policyLabel, policy, themeLabel, theme);
    const actions = element("div", "settings-actions"); const close = element("button", "ghost", "Закрыть"); const apply = element("button", "primary", "Применить");
    close.onclick = () => panel.classList.add("hidden");
    apply.onclick = async () => {
      try {
        const modelStatus = await bridge.selectModel(model.value, policy.value);
        const themeResult = await bridge.selectTheme(theme.value);
        state.status = themeResult.status || modelStatus; updateStatus(); panel.classList.add("hidden");
      } catch (error) { appendEvent({ type: "error", content: error.message }); }
    };
    actions.append(close, apply); panel.append(actions); panel.classList.remove("hidden");
  } catch (error) { appendEvent({ type: "error", content: error.message }); }
}

async function setWorkspace() {
  try { const result = await bridge.chooseWorkspace(); if (!result.canceled) { state.status = result.status || result; updateStatus(); appendEvent({ type: "notice", content: `Рабочая область: ${result.workspaceRoot}` }); } } catch (error) { appendEvent({ type: "error", content: error.message }); }
}
async function login() {
  const status = $("#login-status"); status.textContent = "Проверяю токен…";
  try { const result = await bridge.login($("#token").value); state.status = result.status || result; $("#login").classList.add("hidden"); $("#workspace").classList.remove("hidden"); updateStatus(); status.textContent = ""; }
  catch (error) { status.textContent = error.message; }
}
async function bootstrap() {
  const result = await bridge.bootstrap(); state.status = result.status || result;
  if (result.needsToken) $("#login").classList.remove("hidden"); else { $("#workspace").classList.remove("hidden"); updateStatus(); }
}

$("#login-button").onclick = login;
$("#workspace-button").onclick = setWorkspace;
$("#settings-button").onclick = openSettings;
$("#send").onclick = send;
$("#search").oninput = renderTrajectory;
document.querySelectorAll(".tab").forEach((tab) => tab.onclick = () => setView(tab.dataset.view));
$("#prompt").addEventListener("keydown", (event) => { if (event.ctrlKey && event.key === "Enter") { event.preventDefault(); send(); } if (event.key === "Escape") bridge.cancel(); });
bridge.onEvent(appendEvent);
bootstrap();
