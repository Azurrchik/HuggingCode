const $ = (selector) => document.querySelector(selector);
const tauri = window.__TAURI__;
const bridge = tauri?.core?.invoke ? {
  call: (method, params = {}) => tauri.core.invoke("bridge_call", { method, params }),
  bootstrap() { return this.call("bootstrap"); },
  login(token) { return this.call("login", { token }); },
  connectProvider(params) { return this.call("connectProvider", params); },
  submit(input) { return this.call("submit", { input }); },
  async chooseWorkspace() { const path = await tauri.core.invoke("choose_workspace"); return path ? this.call("setWorkspace", { path }) : { canceled: true }; },
  approve(allow) { return this.call("approval", { allow }); },
  enableFullMode(phrase) { return this.call("fullMode", { phrase }); },
  cancel() { return this.call("cancel"); },
  status() { return this.call("status"); },
  settings(params = {}) { return this.call("settings", params); },
  selectModel(modelId, policy) { return this.call("selectModel", { modelId, policy }); },
  selectTheme(theme) { return this.call("selectTheme", { theme }); },
  selectTokenMode(tokenMode) { return this.call("selectTokenMode", { tokenMode }); },
  onEvent(listener) { return tauri.event.listen("agent:event", (event) => listener(event.payload)); },
} : window.huggingcode;

const PROVIDERS = [
  { id: "huggingface", label: "Hugging Face Inference Providers", endpoint: "https://router.huggingface.co/v1" },
  { id: "openai", label: "OpenAI", endpoint: "https://api.openai.com/v1" },
  { id: "openrouter", label: "OpenRouter", endpoint: "https://openrouter.ai/api/v1" },
  { id: "deepseek", label: "DeepSeek", endpoint: "https://api.deepseek.com/v1" },
  { id: "groq", label: "Groq", endpoint: "https://api.groq.com/openai/v1" },
  { id: "together", label: "Together AI", endpoint: "https://api.together.xyz/v1" },
  { id: "custom", label: "Другой OpenAI-совместимый API", endpoint: "" },
];
const THEMES = {
  ember: { bg: "#111318", panel: "#1b1a1b", panel2: "#26201d", line: "#4a3930", text: "#fff8f0", accent: "#f6ad55", soft: "#dd6b20", success: "#68d391", warning: "#f6e05e", danger: "#fc8181", info: "#90cdf4", muted: "#a08b7c" },
  ocean: { bg: "#0d1520", panel: "#111f2d", panel2: "#162b40", line: "#2d4b68", text: "#edf7ff", accent: "#63b3ed", soft: "#3182ce", success: "#68d391", warning: "#f6e05e", danger: "#fc8181", info: "#9f7aea", muted: "#8ba8c4" },
  forest: { bg: "#0d1813", panel: "#14231b", panel2: "#1b3024", line: "#31513c", text: "#effcf2", accent: "#68d391", soft: "#38a169", success: "#9ae6b4", warning: "#f6e05e", danger: "#fc8181", info: "#90cdf4", muted: "#8fac96" },
  violet: { bg: "#17121f", panel: "#211a2c", panel2: "#30223f", line: "#543b70", text: "#f7f0ff", accent: "#b794f4", soft: "#805ad5", success: "#68d391", warning: "#f6e05e", danger: "#fc8181", info: "#90cdf4", muted: "#ad99c2" },
  midnight: { bg: "#071417", panel: "#102426", panel2: "#163437", line: "#28575b", text: "#ecffff", accent: "#2dd4bf", soft: "#0f766e", success: "#86efac", warning: "#fde047", danger: "#fb7185", info: "#67e8f9", muted: "#83a8aa" },
  rose: { bg: "#1a1018", panel: "#261621", panel2: "#351d2d", line: "#593247", text: "#fff4fb", accent: "#f472b6", soft: "#db2777", success: "#86efac", warning: "#facc15", danger: "#fb7185", info: "#c4b5fd", muted: "#b895aa" },
  mono: { bg: "#101114", panel: "#191a1e", panel2: "#24252a", line: "#4b5563", text: "#f5f5f5", accent: "#e5e7eb", soft: "#9ca3af", success: "#d1d5db", warning: "#f3f4f6", danger: "#fca5a5", info: "#bfdbfe", muted: "#9ca3af" },
};
const state = { events: [], view: "chat", status: {}, liveByTurn: new Map(), settingsData: null };

function text(value) { return String(value ?? ""); }
function time(value) { return new Date(value || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function providerLabel(id) { return (state.settingsData?.providers || PROVIDERS).find((item) => item.id === id)?.label || id || "Провайдер"; }
function applyTheme(name) {
  const colors = THEMES[name] || THEMES.ember;
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(colors)) root.setProperty(`--${key === "soft" ? "accent-soft" : key}`, value);
  root.setProperty("--accent-wash", `${colors.accent}20`);
  root.setProperty("--accent-glow", `${colors.accent}32`);
  document.documentElement.dataset.theme = THEMES[name] ? name : "ember";
}
function element(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node; }
function detailsText(value) { return typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2); }
function preview(value, limit = 560) { const raw = detailsText(value).replace(/\s+/g, " ").trim(); return raw.length > limit ? `${raw.slice(0, limit)}…` : raw; }
function eventKind(event) {
  if (event.type === "user") return "user";
  if (event.type === "tool_started") return "tool";
  if (["tool_result", "verification"].includes(event.type)) return "result";
  if (event.type === "error" || event.level === "error") return "error";
  if (["assistant_final", "text_delta"].includes(event.type)) return "assistant";
  return "activity";
}
function eventTitle(event) {
  const labels = { user: "ВЫ", turn_started: "ЗАДАЧА", activity: "НАБЛЮДАЕМЫЙ ШАГ", text_delta: "АГЕНТ", assistant_final: "АГЕНТ", tool_started: "ИНСТРУМЕНТ", tool_result: "РЕЗУЛЬТАТ", verification: "ПРОВЕРКА", notice: "ИНФО", warning: "ВНИМАНИЕ", error: "ОШИБКА", turn_cancelled: "ОТМЕНЕНО" };
  return event.tool ? `${labels[event.type] || "СОБЫТИЕ"} · ${event.tool}` : (labels[event.type] || "СОБЫТИЕ");
}
function eventStatus(event) {
  if (event.type === "tool_started" || event.type === "turn_started") return { label: "выполняется", icon: "◌", state: "running" };
  if (event.type === "error") return { label: "ошибка", icon: "×", state: "error" };
  if (["tool_result", "verification", "assistant_final"].includes(event.type)) return { label: "готово", icon: "✓", state: "done" };
  if (event.type === "turn_cancelled") return { label: "отменено", icon: "–", state: "cancelled" };
  return { label: "наблюдается", icon: "•", state: "info" };
}
function safeVisible(event) { return ["user", "turn_started", "activity", "text_delta", "assistant_final", "tool_started", "tool_result", "verification", "notice", "warning", "error", "turn_cancelled"].includes(event.type); }

function appendEvent(incoming) {
  const event = { ...incoming, createdAt: incoming.createdAt || Date.now() };
  if (event.type === "text_delta") {
    const existing = state.liveByTurn.get(event.turnId);
    if (existing) { existing.content += event.content || ""; render(); return; }
    state.liveByTurn.set(event.turnId, event); state.events.push(event);
  } else if (event.type === "assistant_final") {
    const existing = state.liveByTurn.get(event.turnId);
    if (existing) { existing.type = "assistant_final"; existing.content = event.content || existing.content; state.liveByTurn.delete(event.turnId); } else state.events.push(event);
  } else state.events.push(event);
  if (["activity", "turn_started"].includes(event.type)) $("#activity").textContent = text(event.content);
  if (event.type === "tool_started") $("#activity").textContent = `Выполняю: ${text(event.content)}`;
  if (["tool_result", "verification"].includes(event.type)) $("#activity").textContent = `Завершено: ${event.tool || "шаг"}`;
  if (event.type === "assistant_final") $("#activity").textContent = "Ответ готов.";
  if (event.type === "theme_changed") applyTheme(event.theme);
  if (event.type === "approval_requested") showApproval(event.action);
  if (event.type === "full_mode_requested") showFullMode(event);
  if (event.type === "model_picker_requested" || event.type === "theme_picker_requested") openSettings();
  render();
}

function addDetails(card, event) {
  if (event.details == null) return;
  const fold = element("details", "event-details");
  fold.append(element("summary", "", "Показать безопасные параметры и результат"));
  fold.append(element("pre", "", detailsText(event.details)));
  card.append(fold);
}
function renderChat() {
  const target = $("#chat-view"); target.replaceChildren();
  for (const event of state.events.filter(safeVisible)) {
    const kind = eventKind(event); const card = element("article", `message ${kind}${event.type === "text_delta" ? " live" : ""}`);
    const header = element("div", "message-header"); header.append(element("span", "", eventTitle(event))); header.append(element("time", "", time(event.createdAt))); card.append(header);
    if (kind === "activity" || kind === "tool" || kind === "result") {
      const meta = eventStatus(event); const row = element("div", "action-row"); row.append(element("span", `status-dot ${meta.state}`, meta.icon)); row.append(element("span", "action-copy", text(event.content || event.details || "…"))); row.append(element("span", "action-status", meta.label)); card.append(row);
    } else card.append(element("div", "message-content", text(event.content || event.details || "…")));
    if (["tool_started", "tool_result", "verification"].includes(event.type)) addDetails(card, event);
    target.append(card);
  }
  target.scrollTop = target.scrollHeight;
}
function renderTrajectory() {
  const target = $("#trajectory-view"); target.replaceChildren();
  const query = $("#search").value.trim().toLowerCase();
  const events = state.events.filter((event) => event.type !== "text_delta" && safeVisible(event) && `${event.type} ${event.tool || ""} ${event.content || ""} ${preview(event.details || "", 300)}`.toLowerCase().includes(query));
  $("#trajectory-count").textContent = String(events.length);
  const summary = element("section", "trajectory-hero");
  summary.append(element("h2", "", "Наблюдаемая траектория"));
  summary.append(element("p", "", `Шагов: ${events.length}. Показаны намерения, инструменты, результаты и проверки. Скрытые рассуждения и системные инструкции не выводятся.`));
  const chips = element("div", "trajectory-chips");
  for (const [kind, label] of [["activity", "План"], ["tool", "Инструменты"], ["result", "Результаты"], ["error", "Ошибки"]]) chips.append(element("span", `chip ${kind}`, `${label}: ${events.filter((event) => eventKind(event) === kind).length}`));
  summary.append(chips); target.append(summary);
  let lastTurn = null;
  for (const [index, event] of events.entries()) {
    if (event.turnId && event.turnId !== lastTurn) { target.append(element("div", "turn-divider", `Задача ${event.turnId.replace(/^turn_/, "")}`)); lastTurn = event.turnId; }
    const kind = eventKind(event); const status = eventStatus(event); const card = element("article", `trajectory-step ${kind}`);
    const rail = element("div", "step-rail"); rail.append(element("span", `step-icon ${status.state}`, status.icon)); rail.append(element("span", "step-index", String(index + 1).padStart(2, "0"))); card.append(rail);
    const content = element("div", "step-content"); const head = element("div", "step-head"); head.append(element("strong", "", eventTitle(event))); head.append(element("span", `status-badge ${status.state}`, status.label)); head.append(element("time", "", time(event.createdAt))); content.append(head);
    content.append(element("p", "step-body", preview(event.content || event.details || "…", 900)));
    addDetails(content, event); card.append(content); target.append(card);
  }
}
function render() { renderChat(); renderTrajectory(); }
function setView(view) { state.view = view; $("#chat-view").classList.toggle("hidden", view !== "chat"); $("#trajectory-view").classList.toggle("hidden", view !== "trajectory"); document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view)); }

function updateStatus() {
  const status = state.status || {}; $("#model").textContent = text(status.model || ""); $("#provider").textContent = providerLabel(status.provider);
  $("#workspace-path").textContent = text(status.workspace || "workspace"); const mode = $("#mode"); mode.textContent = text(status.mode || "manual"); mode.classList.toggle("full", status.mode === "full");
  $("#token-mode").textContent = status.tokenMode === "economy" ? "экономия токенов" : status.tokenMode || "balanced"; applyTheme(status.theme || "ember");
}
function showApproval(action) {
  const panel = $("#approval"); panel.replaceChildren(); panel.classList.remove("hidden"); panel.append(element("h3", "", "Требуется подтверждение")); panel.append(element("p", "", text(action?.reason || "Агент хочет выполнить действие в workspace."))); panel.append(element("pre", "", JSON.stringify(action, null, 2)));
  const actions = element("div", "approval-actions"); const deny = element("button", "ghost", "Отклонить"); const allow = element("button", "primary", "Разрешить"); deny.onclick = async () => { await bridge.approve(false); panel.classList.add("hidden"); }; allow.onclick = async () => { await bridge.approve(true); panel.classList.add("hidden"); }; actions.append(deny, allow); panel.append(actions);
}
function showFullMode(event) {
  const panel = $("#approval"); panel.replaceChildren(); panel.classList.remove("hidden"); panel.append(element("h3", "", "Включение FULL MODE")); panel.append(element("p", "", "Режим действует только в этом сеансе и не отменяет границы workspace, защиту секретов и блокировку опасных shell-действий.")); const input = element("input", ""); input.placeholder = `Введите: ${event.phrase}`; panel.append(input);
  const actions = element("div", "approval-actions"); const cancel = element("button", "ghost", "Отмена"); const enable = element("button", "primary", "Включить"); cancel.onclick = () => panel.classList.add("hidden"); enable.onclick = async () => { const ok = await bridge.enableFullMode(input.value); if (ok) panel.classList.add("hidden"); }; actions.append(cancel, enable); panel.append(actions);
}
async function send() { const prompt = $("#prompt"); const value = prompt.value.trim(); if (!value) return; prompt.value = ""; $("#send").disabled = true; try { state.status = await bridge.submit(value); updateStatus(); } catch (error) { appendEvent({ type: "error", content: error.message }); } finally { $("#send").disabled = false; } }
function selectOptions(select, items, current, format = (item) => item.label || item.id) { select.replaceChildren(); for (const item of items) { const option = element("option", "", format(item)); option.value = item.id; option.selected = item.id === current; select.append(option); } }
function providerDefaults(id) { return (state.settingsData?.providers || PROVIDERS).find((item) => item.id === id) || PROVIDERS[0]; }
async function openSettings() {
  const panel = $("#settings"); panel.replaceChildren();
  try {
    const data = await bridge.settings(); state.settingsData = data; const current = data.status || state.status;
    panel.append(element("h2", "", "Модель, провайдер и оформление")); panel.append(element("p", "", "Ключи сохраняются только в системном защищённом хранилище. Каталог Hugging Face загружается live и можно искать по всем моделям."));
    const providerLabelNode = element("label", "", "AI-провайдер"); const provider = element("select", ""); selectOptions(provider, data.providers || PROVIDERS, current.provider, (item) => item.label);
    const endpointLabel = element("label", "", "API endpoint"); const endpoint = element("input", ""); endpoint.value = current.providerEndpoint || providerDefaults(current.provider).endpoint || "";
    const keyLabel = element("label", "", "Новый API key (оставьте пустым, чтобы использовать сохранённый)"); const key = element("input", ""); key.type = "password"; key.autocomplete = "off";
    const modelLabel = element("label", "", "Модель"); const modelInput = element("input", ""); modelInput.value = text(current.model || "").replace(/:(fastest|cheapest|preferred)$/, ""); modelInput.placeholder = "Введите ID модели или выберите из результата поиска";
    const modelSearch = element("input", ""); modelSearch.placeholder = "Поиск по полному каталогу моделей Hugging Face";
    const filters = element("div", "filter-row"); const checks = {};
    for (const [id, label] of [["code", "coding"], ["tools", "tools"], ["vision", "vision"]]) { const wrap = element("label", "filter"); const input = element("input", ""); input.type = "checkbox"; input.checked = false; wrap.append(input, document.createTextNode(label)); filters.append(wrap); checks[id] = input; }
    const modelResults = element("select", "model-results"); modelResults.size = 8;
    const catalogNote = element("p", "catalog-note", "Загружаю каталог…");
    const loadModels = async () => {
      const result = await bridge.settings({ query: modelSearch.value, code: checks.code.checked, tools: checks.tools.checked, vision: checks.vision.checked }); state.settingsData = result;
      const models = result.models || []; modelResults.replaceChildren();
      for (const item of models) { const option = element("option", "", `${item.label || item.id} · ${item.provider || "auto"}${item.contextLength ? ` · ${Math.round(item.contextLength / 1000)}k ctx` : ""}`); option.value = item.id; modelResults.append(option); }
      catalogNote.textContent = result.modelCatalogSource === "live" ? `Live Hugging Face каталог: ${result.modelCatalogTotal} моделей, показано ${models.length}.` : `Встроенный список: ${models.length}. Проверьте токен или сеть для полного каталога.`;
    };
    modelResults.onchange = () => { if (modelResults.value) modelInput.value = modelResults.value; };
    modelSearch.oninput = () => loadModels().catch((error) => { catalogNote.textContent = error.message; }); for (const input of Object.values(checks)) input.onchange = () => loadModels().catch((error) => { catalogNote.textContent = error.message; });
    provider.onchange = () => { const next = providerDefaults(provider.value); if (provider.value !== "custom") endpoint.value = next.endpoint || ""; modelSearch.value = ""; modelResults.replaceChildren(); catalogNote.textContent = provider.value === "huggingface" ? "Нажмите Применить, затем каталог будет загружен live." : "Укажите модель вручную или из каталога выбранного провайдера."; };
    const policyLabel = element("label", "", "Маршрутизация модели"); const policy = element("select", ""); for (const value of ["fastest", "cheapest", "preferred"]) { const option = element("option", "", value); option.value = value; option.selected = current.model?.endsWith(`:${value}`); policy.append(option); }
    const tokenLabel = element("label", "", "Расход токенов"); const tokenMode = element("select", ""); for (const value of data.tokenModes || ["economy", "balanced", "quality"]) { const option = element("option", "", value === "economy" ? "economy — компактный контекст" : value === "quality" ? "quality — полный контекст" : "balanced — обычный режим"); option.value = value; option.selected = value === (current.tokenMode || "balanced"); tokenMode.append(option); }
    const themeLabel = element("label", "", "Цвет интерфейса"); const theme = element("select", ""); for (const item of data.themes || []) { const option = element("option", "", `${item.label} — ${item.description}`); option.value = item.id; option.selected = item.id === current.theme; theme.append(option); } theme.onchange = () => applyTheme(theme.value);
    panel.append(providerLabelNode, provider, endpointLabel, endpoint, keyLabel, key, modelLabel, modelInput, modelSearch, filters, modelResults, catalogNote, policyLabel, policy, tokenLabel, tokenMode, themeLabel, theme);
    await loadModels();
    const actions = element("div", "settings-actions"); const close = element("button", "ghost", "Закрыть"); const apply = element("button", "primary", "Применить изменения"); close.onclick = () => { applyTheme(state.status.theme || "ember"); panel.classList.add("hidden"); };
    apply.onclick = async () => { try { let latest = current; const providerChanged = provider.value !== current.provider || endpoint.value.trim() !== (current.providerEndpoint || "") || key.value.trim(); if (providerChanged) latest = (await bridge.connectProvider({ provider: provider.value, endpoint: endpoint.value.trim(), token: key.value.trim() })).status; const modelStatus = await bridge.selectModel(modelInput.value.trim(), policy.value); const tokenStatus = await bridge.selectTokenMode(tokenMode.value); const themeResult = await bridge.selectTheme(theme.value); state.status = themeResult.status || tokenStatus || modelStatus || latest; updateStatus(); panel.classList.add("hidden"); } catch (error) { appendEvent({ type: "error", content: error.message }); } };
    actions.append(close, apply); panel.append(actions); panel.classList.remove("hidden");
  } catch (error) { appendEvent({ type: "error", content: error.message }); }
}
async function setWorkspace() { try { const result = await bridge.chooseWorkspace(); if (!result.canceled) { state.status = result.status || result; updateStatus(); appendEvent({ type: "notice", content: `Рабочая область: ${result.workspaceRoot}` }); } } catch (error) { appendEvent({ type: "error", content: error.message }); } }
function populateLoginProviders() { const select = $("#login-provider"); selectOptions(select, PROVIDERS, "huggingface", (item) => item.label); const refresh = () => { const item = providerDefaults(select.value); $("#login-endpoint").value = item.endpoint || ""; $("#login-token-label").textContent = select.value === "huggingface" ? "Hugging Face token (hf_…)" : "API key"; }; select.onchange = refresh; refresh(); }
async function login() { const status = $("#login-status"); status.textContent = "Проверяю ключ и подключаю провайдера…"; try { const result = await bridge.connectProvider({ provider: $("#login-provider").value, endpoint: $("#login-endpoint").value.trim(), token: $("#token").value.trim() }); if (result.needsToken) throw new Error("Введите API key выбранного провайдера."); state.status = result.status || result; $("#login").classList.add("hidden"); $("#workspace").classList.remove("hidden"); updateStatus(); status.textContent = ""; } catch (error) { status.textContent = error.message; } }
async function bootstrap() { populateLoginProviders(); const result = await bridge.bootstrap(); state.status = result.status || result; if (result.needsToken) $("#login").classList.remove("hidden"); else { $("#workspace").classList.remove("hidden"); updateStatus(); } }

$("#login-button").onclick = login; $("#workspace-button").onclick = setWorkspace; $("#settings-button").onclick = openSettings; $("#send").onclick = send; $("#search").oninput = renderTrajectory; document.querySelectorAll(".tab").forEach((tab) => tab.onclick = () => setView(tab.dataset.view)); $("#prompt").addEventListener("keydown", (event) => { if (event.ctrlKey && event.key === "Enter") { event.preventDefault(); send(); } if (event.key === "Escape") bridge.cancel(); }); bridge.onEvent(appendEvent); bootstrap();
