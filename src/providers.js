import { InferenceClient } from "@huggingface/inference";

export const PROVIDER_PRESETS = [
  { id: "huggingface", label: "Hugging Face Inference Providers", kind: "huggingface", endpoint: "https://router.huggingface.co/v1" },
  { id: "openai", label: "OpenAI", kind: "openai-compatible", endpoint: "https://api.openai.com/v1" },
  { id: "openrouter", label: "OpenRouter", kind: "openai-compatible", endpoint: "https://openrouter.ai/api/v1" },
  { id: "deepseek", label: "DeepSeek", kind: "openai-compatible", endpoint: "https://api.deepseek.com/v1" },
  { id: "groq", label: "Groq", kind: "openai-compatible", endpoint: "https://api.groq.com/openai/v1" },
  { id: "together", label: "Together AI", kind: "openai-compatible", endpoint: "https://api.together.xyz/v1" },
  { id: "custom", label: "Другой OpenAI-совместимый API", kind: "openai-compatible", endpoint: "" },
];

function withoutSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function providerPreset(id) {
  return PROVIDER_PRESETS.find((item) => item.id === id) || PROVIDER_PRESETS[0];
}

export function normalizeProvider(id, endpoint = "") {
  const preset = providerPreset(id);
  const resolved = withoutSlash(endpoint || preset.endpoint);
  if (preset.id === "custom" && !/^https:\/\//i.test(resolved)) throw new Error("Для другого провайдера укажите HTTPS URL OpenAI-совместимого API.");
  return { id: preset.id, label: preset.label, kind: preset.kind, endpoint: resolved };
}

function modelBase(model) {
  return String(model || "").replace(/:(?:fastest|cheapest|preferred)$/i, "");
}

function normalizeRequest(request, stream) {
  return {
    model: modelBase(request.model),
    messages: request.messages,
    tools: request.tools?.length ? request.tools : undefined,
    tool_choice: request.tools?.length ? request.tool_choice || "auto" : undefined,
    max_tokens: request.max_tokens,
    temperature: request.temperature,
    ...(request.reasoning_effort ? { reasoning_effort: request.reasoning_effort } : {}),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
}

function providerError(response, payload) {
  const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
  const error = new Error(message);
  error.status = response.status;
  return error;
}

async function requestJson(provider, token, request, signal) {
  const response = await fetch(`${provider.endpoint}/chat/completions`, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(normalizeRequest(request, false)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(response, payload);
  return payload;
}

async function* requestSse(provider, token, request, signal) {
  const response = await fetch(`${provider.endpoint}/chat/completions`, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(normalizeRequest(request, true)),
  });
  if (!response.ok) throw providerError(response, await response.json().catch(() => ({})));
  if (!response.body) throw new Error("Провайдер не вернул streaming body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try { yield JSON.parse(data); } catch { /* Ignore malformed keepalive frames. */ }
      }
    }
    if (done) break;
  }
}

export function createProviderClient({ provider = "huggingface", endpoint = "", token }) {
  const selected = normalizeProvider(provider, endpoint);
  if (selected.id === "huggingface") {
    const client = new InferenceClient(token);
    return {
      provider: selected,
      chatCompletion: (request, options) => client.chatCompletion(request, options),
      chatCompletionStream: (request, options) => client.chatCompletionStream(request, options),
    };
  }
  return {
    provider: selected,
    chatCompletion: (request, { signal } = {}) => requestJson(selected, token, request, signal),
    chatCompletionStream: (request, { signal } = {}) => requestSse(selected, token, request, signal),
  };
}

export function isHuggingFaceProvider(provider) {
  return normalizeProvider(provider).id === "huggingface";
}
