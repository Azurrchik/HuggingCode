const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export function cleanTerminalText(value) {
  return String(value ?? "").replace(CONTROL, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function makeRow(kind, content = "", extra = {}) {
  return {
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    content: cleanTerminalText(content),
    createdAt: Date.now(),
    ...extra,
  };
}

export function createTranscript() {
  return [];
}

export function appendTranscript(rows, event) {
  const current = Array.isArray(rows) ? rows : [];
  switch (event?.type) {
    case "user":
      return [...current, makeRow("user", event.content)];
    case "turn_started":
      return [...current, makeRow("status", event.content || "Агент начал работу.", { turnId: event.turnId })];
    case "text_delta": {
      const last = current.at(-1);
      if (last?.kind === "assistant-live" && last.turnId === event.turnId) {
        return [...current.slice(0, -1), { ...last, content: `${last.content}${cleanTerminalText(event.content)}` }];
      }
      return [...current, makeRow("assistant-live", event.content, { turnId: event.turnId })];
    }
    case "thinking_delta": {
      const last = current.at(-1);
      if (last?.kind === "thinking" && last.turnId === event.turnId) {
        return [...current.slice(0, -1), { ...last, content: `${last.content}${cleanTerminalText(event.content)}` }];
      }
      return [...current, makeRow("thinking", event.content, { turnId: event.turnId })];
    }
    case "assistant_final": {
      const last = current.at(-1);
      if (last?.kind === "assistant-live" && last.turnId === event.turnId) {
        return [...current.slice(0, -1), { ...last, kind: "assistant", content: event.content || last.content }];
      }
      return [...current, makeRow("assistant", event.content, { turnId: event.turnId })];
    }
    case "tool_started":
      return [...current, makeRow("tool", event.content || event.tool || "Инструмент", { turnId: event.turnId, details: event.details })];
    case "tool_result":
      return [...current, makeRow("tool-result", event.content || "Инструмент завершён.", { turnId: event.turnId, details: event.details })];
    case "verification":
      return [...current, makeRow("verification", event.content, { turnId: event.turnId, details: event.details })];
    case "notice":
      return [...current, makeRow(event.level === "error" ? "error" : event.level === "warn" ? "warning" : "notice", event.content)];
    case "turn_cancelled":
      return [...current, makeRow("warning", "Запрос отменён пользователем.", { turnId: event.turnId })];
    case "error":
      return [...current, makeRow("error", event.content || "Неизвестная ошибка.", { turnId: event.turnId })];
    default:
      return current;
  }
}

export function transcriptPreview(row, maxLines = 7) {
  const lines = cleanTerminalText(row?.content).split(/\r?\n/);
  const preview = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? `${preview}\n… (${lines.length - maxLines} строк скрыто)` : preview;
}
