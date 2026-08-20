import React, { createElement as h } from "react";
import { Box, Text } from "ink";
import { transcriptPreview } from "./transcript.js";

const META = {
  user: { label: "you", marker: "›", color: "accent" },
  assistant: { label: "huggingcode", marker: "•", color: "accent" },
  "assistant-live": { label: "huggingcode", marker: "…", color: "accent" },
  thinking: { label: "reasoning", marker: "·", color: "muted" },
  tool: { label: "tool", marker: "›", color: "info" },
  "tool-result": { label: "tool", marker: "✓", color: "success" },
  verification: { label: "verify", marker: "✓", color: "success" },
  status: { label: "status", marker: "·", color: "muted" },
  notice: { label: "notice", marker: "i", color: "info" },
  warning: { label: "warning", marker: "!", color: "warning" },
  error: { label: "error", marker: "×", color: "danger" },
};

function colorFor(meta, theme) {
  return theme[meta.color] || theme.accent;
}

export function TranscriptView({ rows, theme, maxRows = 50 }) {
  const visible = rows.slice(-Math.max(1, maxRows));
  return h(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1 }, visible.map((row) => h(TranscriptRow, { key: row.id, row, theme })));
}

export function TranscriptRow({ row, theme }) {
  const meta = META[row.kind] || META.notice;
  const content = transcriptPreview(row, row.kind === "assistant" || row.kind === "assistant-live" ? 14 : 8);
  const color = colorFor(meta, theme);
  return h(Box, { flexDirection: "column", marginBottom: 1 },
    h(Box, null,
      h(Text, { color, bold: true }, `${meta.marker} ${meta.label}`),
      row.kind === "assistant-live" ? h(Text, { color: theme.muted }, " streaming") : null,
    ),
    h(Box, { paddingLeft: 2, flexDirection: "column" },
      h(Text, { color: row.kind === "thinking" ? theme.muted : undefined, dimColor: row.kind === "thinking" }, content || "…"),
    ),
  );
}
