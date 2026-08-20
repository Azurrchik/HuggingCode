import React, { createElement as h } from "react";
import { Box, Text } from "ink";
import { contextColor } from "./theme.js";

function shortModel(model) {
  const value = String(model || "не выбрана");
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function formatCount(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function StatusBar({ status, theme }) {
  const context = status.context || {};
  const percent = context.threshold ? Math.min(100, Math.round((context.estimatedTokens / context.threshold) * 100)) : null;
  const contextTone = contextColor(context.estimatedTokens, context.threshold, theme);
  const modeTone = status.mode === "full" ? theme.danger : status.mode === "plan" ? theme.info : status.mode === "manual" ? theme.warning : status.mode === "safe-auto" ? theme.success : theme.accent;
  const state = status.busy ? "работает" : status.queueCount ? `в очереди: ${status.queueCount}` : "готов";

  return h(Box, {
    borderStyle: "single", borderLeft: false, borderRight: false, borderBottom: false,
    borderColor: theme.border, paddingX: 1, flexDirection: "column",
  },
  h(Box, { justifyContent: "space-between", flexWrap: "wrap" },
    h(Box, null,
      h(Text, { color: theme.accent, bold: true }, shortModel(status.model)),
      h(Text, { dimColor: true }, ` · reasoning ${status.effort}`),
      h(Text, { dimColor: true }, " · "),
      h(Text, { color: modeTone, bold: true }, status.mode),
      h(Text, { dimColor: true }, " · "),
      h(Text, { color: status.busy ? theme.warning : status.mode === "full" ? theme.danger : theme.success, bold: status.mode === "full" }, state),
    ),
    h(Box, null,
      h(Text, { dimColor: true }, "контекст "),
      h(Text, { color: contextTone, bold: true }, percent === null ? "?" : `${percent}%`),
      h(Text, { dimColor: true }, ` · токены ${formatCount(status.usage?.totalTokens)}`),
    ),
  ),
  h(Box, null,
      h(Text, { dimColor: true }, `${status.mode === "full" ? "АВТОНОМНЫЙ · " : ""}${status.workspace || "workspace не определён"}`),
    status.goal ? h(Text, { color: theme.info }, ` · цель: ${status.goal}`) : null,
  ));
}
