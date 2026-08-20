import React, { createElement as h } from "react";
import { Box, Text } from "ink";
import { contextColor } from "./theme.js";

function baseName(value) {
  const items = String(value || "workspace").split(/[\\/]/).filter(Boolean);
  return items.at(-1) || "workspace";
}

function shortModel(value) {
  const id = String(value || "модель");
  return id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
}

export function HeaderBar({ status, theme, columns = 100 }) {
  const context = status.context || {};
  const percent = context.threshold ? Math.min(100, Math.round((context.estimatedTokens / context.threshold) * 100)) : null;
  const modeColor = status.mode === "full" ? theme.danger : status.mode === "safe-auto" ? theme.success : status.mode === "plan" ? theme.info : theme.warning;
  const compact = columns < 78;

  return h(Box, { borderStyle: "round", borderColor: status.mode === "full" ? theme.danger : theme.accent, paddingX: 1, marginX: 1, justifyContent: "space-between" },
    h(Box, null,
      h(Text, { color: theme.accent, bold: true }, "HuggingCode"),
      !compact ? h(Text, { dimColor: true }, `  ${baseName(status.workspace)}`) : null,
    ),
    h(Box, null,
      !compact ? h(Text, { color: theme.muted }, `${shortModel(status.model)}  `) : null,
      h(Text, { color: modeColor, bold: true }, status.mode === "full" ? "FULL MODE" : status.mode),
      h(Text, { dimColor: true }, "  ctx "),
      h(Text, { color: contextColor(context.estimatedTokens, context.threshold, theme), bold: true }, percent === null ? "?" : `${percent}%`),
    ),
  );
}
