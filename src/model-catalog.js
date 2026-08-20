const MODELS_ENDPOINT = "https://router.huggingface.co/v1/models";
export const MODEL_POLICIES = ["fastest", "cheapest", "preferred"];

export const FALLBACK_MODELS = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", description: "General coding and tool use", tags: ["code", "tools", "reasoning"], contextLength: 131072, supportsTools: true, supportsVision: false },
  { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", label: "Qwen3 Coder 480B", description: "Large coding model", tags: ["code", "tools"], contextLength: 131072, supportsTools: true, supportsVision: false },
  { id: "zai-org/GLM-4.5", label: "GLM-4.5", description: "Reasoning and software engineering", tags: ["code", "tools", "reasoning"], contextLength: 131072, supportsTools: true, supportsVision: false },
  { id: "deepseek-ai/DeepSeek-V3.2", label: "DeepSeek V3.2", description: "General coding and analysis", tags: ["code", "reasoning"], contextLength: 131072, supportsTools: true, supportsVision: false },
  { id: "Qwen/Qwen2.5-VL-72B-Instruct", label: "Qwen2.5 VL 72B", description: "Vision and code review", tags: ["code", "vision"], contextLength: 32768, supportsTools: false, supportsVision: true },
];

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function boolFrom(value) {
  return value === true || value === "true";
}

function inferredTags(id, raw) {
  const text = `${id} ${JSON.stringify(raw || {})}`.toLowerCase();
  const tags = [];
  if (/(coder|code|program|software)/.test(text)) tags.push("code");
  if (/(vision|vl|image|multimodal)/.test(text)) tags.push("vision");
  if (/(tool|function)/.test(text)) tags.push("tools");
  if (/(reason|think|r1)/.test(text)) tags.push("reasoning");
  return [...new Set(tags)];
}

export function normalizeModel(raw) {
  const id = String(raw?.id || raw?.model || raw?.name || "").trim();
  if (!id) return null;
  const capabilities = raw?.capabilities || raw?.features || {};
  const tags = [...new Set([...(Array.isArray(raw?.tags) ? raw.tags.map(String) : []), ...inferredTags(id, raw)])];
  const contextLength = numberOrNull(raw?.context_length ?? raw?.contextLength ?? raw?.max_model_len ?? raw?.max_context_length);
  const maxOutputTokens = numberOrNull(raw?.max_output_tokens ?? raw?.maxOutputTokens);
  const supportsTools = boolFrom(capabilities?.tools ?? capabilities?.tool_calling ?? raw?.supports_tools) || tags.includes("tools");
  const supportsVision = boolFrom(capabilities?.vision ?? raw?.supports_vision) || tags.includes("vision");
  return {
    id,
    label: String(raw?.display_name || raw?.name || id.split("/").at(-1)),
    description: String(raw?.description || "Hugging Face Inference Providers model"),
    provider: raw?.provider || raw?.owned_by || "auto",
    contextLength,
    maxOutputTokens,
    inputPrice: numberOrNull(raw?.pricing?.input ?? raw?.input_price),
    outputPrice: numberOrNull(raw?.pricing?.output ?? raw?.output_price),
    tags,
    supportsTools,
    supportsVision,
    raw,
  };
}

export function catalogFromPayload(payload) {
  const records = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  const normalized = records.map(normalizeModel).filter(Boolean);
  const unique = new Map();
  for (const model of normalized) {
    const existing = unique.get(model.id);
    if (!existing) {
      unique.set(model.id, model);
      continue;
    }
    unique.set(model.id, {
      ...existing,
      label: existing.label === existing.id.split("/").at(-1) ? model.label : existing.label,
      description: existing.description === "Hugging Face Inference Providers model" ? model.description : existing.description,
      provider: existing.provider === "auto" ? model.provider : existing.provider,
      contextLength: Math.max(existing.contextLength || 0, model.contextLength || 0) || null,
      maxOutputTokens: Math.max(existing.maxOutputTokens || 0, model.maxOutputTokens || 0) || null,
      tags: [...new Set([...existing.tags, ...model.tags])],
      supportsTools: existing.supportsTools || model.supportsTools,
      supportsVision: existing.supportsVision || model.supportsVision,
    });
  }
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function fetchModelCatalog(token, { signal } = {}) {
  const response = await fetch(MODELS_ENDPOINT, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!response.ok) throw new Error(`Не удалось загрузить каталог моделей: HTTP ${response.status}.`);
  const catalog = catalogFromPayload(await response.json());
  if (!catalog.length) throw new Error("Hugging Face вернул пустой каталог моделей.");
  return catalog;
}

export function searchModels(catalog, query = "", filters = {}) {
  const needle = query.trim().toLowerCase();
  return catalog.filter((model) => {
    const searchable = `${model.id} ${model.label} ${model.description} ${model.tags.join(" ")}`.toLowerCase();
    if (needle && !searchable.includes(needle)) return false;
    if (filters.code && !model.tags.includes("code")) return false;
    if (filters.tools && !model.supportsTools) return false;
    if (filters.vision && !model.supportsVision) return false;
    return true;
  }).sort((left, right) => {
    const leftScore = (left.tags.includes("code") ? 4 : 0) + (left.supportsTools ? 2 : 0) + (left.contextLength ? 1 : 0);
    const rightScore = (right.tags.includes("code") ? 4 : 0) + (right.supportsTools ? 2 : 0) + (right.contextLength ? 1 : 0);
    return rightScore - leftScore || left.label.localeCompare(right.label);
  });
}

export function formatModelSelection(modelId, policy = "fastest") {
  const id = String(modelId || "").trim();
  if (!id) throw new Error("Идентификатор модели не может быть пустым.");
  if (!MODEL_POLICIES.includes(policy)) return id;
  const base = id.replace(/:(?:fastest|cheapest|preferred)$/i, "");
  return `${base}:${policy}`;
}

export function fallbackCatalog() {
  return FALLBACK_MODELS.map((model) => ({ ...model, provider: "auto", maxOutputTokens: null, inputPrice: null, outputPrice: null, raw: null }));
}
