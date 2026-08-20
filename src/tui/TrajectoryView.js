import React, { createElement as h } from "react";
import { Box, Text } from "ink";
import { cleanTerminalText } from "./transcript.js";

const KIND = {
  user: { label: "USER", color: "accent", marker: "●" },
  status: { label: "STEP", color: "muted", marker: "○" },
  activity: { label: "ACTIVITY", color: "info", marker: "◈" },
  tool: { label: "TOOL", color: "info", marker: "↳" },
  "tool-result": { label: "RESULT", color: "success", marker: "✓" },
  verification: { label: "VERIFY", color: "success", marker: "✓" },
  assistant: { label: "ASSISTANT", color: "accent", marker: "●" },
  "assistant-live": { label: "ASSISTANT", color: "accent", marker: "◌" },
  notice: { label: "INFO", color: "info", marker: "i" },
  warning: { label: "WARN", color: "warning", marker: "!" },
  error: { label: "ERROR", color: "danger", marker: "×" },
};

function time(value) {
  return new Date(value || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function preview(value, limit = 260) {
  const text = cleanTerminalText(value).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function TrajectoryView({ rows, theme, filter = "", maxRows = 50 }) {
  const needle = String(filter || "").trim().toLowerCase();
  const relevant = rows.filter((row) => ["user", "status", "activity", "tool", "tool-result", "verification", "assistant", "assistant-live", "notice", "warning", "error"].includes(row.kind));
  const filtered = relevant.filter((row) => !needle || `${row.kind} ${row.tool || ""} ${row.content}`.toLowerCase().includes(needle));
  const visible = filtered.slice(-Math.max(1, maxRows));

  return h(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1 },
    h(Box, { borderStyle: "round", borderColor: theme.border, paddingX: 1, justifyContent: "space-between" },
      h(Text, { color: theme.accent, bold: true }, "Trajectory"),
      h(Text, { color: theme.muted }, `${filtered.length} событий${needle ? ` · фильтр: ${filter}` : ""}`),
    ),
    h(Text, { color: theme.muted }, "Показываются наблюдаемые шаги, команды, изменения и результаты. Скрытые рассуждения и системные инструкции не выводятся."),
    h(Box, { flexDirection: "column", marginTop: 1 },
      visible.map((row) => {
        const meta = KIND[row.kind] || KIND.notice;
        const color = theme[meta.color] || theme.accent;
        const label = row.tool ? `${meta.label} · ${row.tool}` : meta.label;
        return h(Box, { key: row.id, flexDirection: "column", borderStyle: "single", borderLeft: true, borderRight: false, borderTop: false, borderBottom: false, borderColor: color, paddingLeft: 1, marginBottom: 1 },
          h(Box, null,
            h(Text, { color, bold: true }, `${meta.marker} ${label}`),
            h(Text, { color: theme.muted }, `  ${time(row.createdAt)}`),
          ),
          h(Text, { color: row.kind === "activity" ? theme.muted : undefined, dimColor: row.kind === "activity" }, preview(row.content) || "…"),
        );
      }),
      !visible.length ? h(Text, { color: theme.muted }, "Пока нет событий для отображения.") : null,
    ),
  );
}
