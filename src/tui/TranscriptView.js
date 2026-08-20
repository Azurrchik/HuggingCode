import React, { createElement as h } from "react";
import { Box, Text } from "ink";
import { transcriptPreview } from "./transcript.js";

const META = {
  user: { label: "ВЫ", marker: "❯", color: "accent" },
  assistant: { label: "HUGGINGCODE", marker: "●", color: "accent" },
  "assistant-live": { label: "HUGGINGCODE", marker: "◌", color: "accent" },
  activity: { label: "ХОД РАБОТЫ", marker: "◈", color: "info" },
  tool: { label: "ИНСТРУМЕНТ", marker: "↳", color: "info" },
  "tool-result": { label: "РЕЗУЛЬТАТ", marker: "✓", color: "success" },
  verification: { label: "ПРОВЕРКА", marker: "✓", color: "success" },
  status: { label: "СТАТУС", marker: "·", color: "muted" },
  notice: { label: "ИНФО", marker: "i", color: "info" },
  warning: { label: "ПРЕДУПРЕЖДЕНИЕ", marker: "!", color: "warning" },
  error: { label: "ОШИБКА", marker: "×", color: "danger" },
};

function colorFor(meta, theme) {
  return theme[meta.color] || theme.accent;
}

function oneLine(value, limit = 90) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function editPreview(row) {
  const args = row.details;
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  if (row.tool === "write_file") {
    const allLines = String(args.content ?? "").split(/\r?\n/).filter(Boolean);
    const lines = allLines.slice(0, 5);
    return [`${args.path || "файл"}`, `+ запись ${allLines.length} строк`, ...lines.map((line) => `+ ${oneLine(line)}`), allLines.length > lines.length ? `… ещё ${allLines.length - lines.length} строк в файле` : "", args.reason ? `# причина: ${oneLine(args.reason)}` : ""].filter(Boolean).join("\n");
  }
  if (row.tool === "replace_in_file") {
    return [`${args.path || "файл"}`, `- ${oneLine(args.old_string)}`, `+ ${oneLine(args.new_string)}`, args.replace_all ? "# все совпадения" : ""].filter(Boolean).join("\n");
  }
  if (row.tool === "delete_file") return `${args.path || "файл"}\n× удалить файл`;
  if (row.tool === "run_command") return [`> ${oneLine(args.command, 180)}`, args.reason ? `# причина: ${oneLine(args.reason)}` : ""].filter(Boolean).join("\n");
  if (args.path || args.query || args.reason) return [args.path ? `путь: ${args.path}` : "", args.query ? `запрос: ${oneLine(args.query)}` : "", args.reason ? `# причина: ${oneLine(args.reason)}` : ""].filter(Boolean).join("\n");
  return null;
}

function ToolCard({ row, theme, result = false }) {
  const content = transcriptPreview(row, result ? 8 : 6);
  const preview = result ? null : editPreview(row);
  const color = result ? theme.success : theme.info;
  const tool = row.tool || (result ? "Инструмент завершён" : "Инструмент запущен");
  return h(Box, { borderStyle: "round", borderColor: color, flexDirection: "column", paddingX: 1, marginBottom: 1 },
    h(Box, { justifyContent: "space-between" },
      h(Text, { color, bold: true }, `${result ? "✓" : "↳"} ${tool}`),
      h(Text, { dimColor: true }, result ? "готово" : "работает"),
    ),
    preview ? h(Text, { color: theme.muted }, preview) : content ? h(Text, { color: theme.muted }, content) : null,
  );
}

function MessageCard({ row, theme }) {
  const meta = META[row.kind] || META.notice;
  const content = transcriptPreview(row, row.kind === "assistant" || row.kind === "assistant-live" ? Number.POSITIVE_INFINITY : row.kind === "activity" ? 5 : 10);
  const color = colorFor(meta, theme);
  const user = row.kind === "user";
  const activity = row.kind === "activity";
  return h(Box, { flexDirection: "column", marginBottom: 1, paddingLeft: user ? 1 : 0 },
    h(Box, null,
      h(Text, { color, bold: true }, `${meta.marker} ${meta.label}`),
      row.kind === "assistant-live" ? h(Text, { color: theme.warning }, "  потоковый ответ") : null,
      activity ? h(Text, { color: theme.muted }, "  действия и результаты ниже") : null,
    ),
    h(Box, { paddingLeft: 2, borderLeft: true, borderColor: user ? theme.accent : activity ? theme.border : color },
      h(Text, { color: activity ? theme.muted : undefined, dimColor: activity }, content || "…"),
    ),
  );
}

export function TranscriptView({ rows, theme, maxRows = 50 }) {
  const visible = rows.slice(-Math.max(1, maxRows));
  return h(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1 },
    visible.map((row) => {
      if (row.kind === "tool") return h(ToolCard, { key: row.id, row, theme });
      if (row.kind === "tool-result" || row.kind === "verification") return h(ToolCard, { key: row.id, row, theme, result: true });
      return h(MessageCard, { key: row.id, row, theme });
    }),
  );
}
