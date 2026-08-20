import React, { createElement as h, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { MODEL_POLICIES, searchModels } from "../model-catalog.js";

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${Math.round(number / 1_000)}k`;
  return String(number);
}

export function ModelPicker({ models, source, currentModel, theme, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [policyIndex, setPolicyIndex] = useState(0);
  const [filters, setFilters] = useState({ code: true, tools: false, vision: false });
  const visible = useMemo(() => searchModels(models, query, filters).slice(0, 12), [models, query, filters]);
  const selected = visible[Math.min(index, Math.max(0, visible.length - 1))] || null;
  const policy = MODEL_POLICIES[policyIndex];

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.upArrow) return setIndex((current) => Math.max(0, current - 1));
    if (key.downArrow) return setIndex((current) => Math.min(Math.max(0, visible.length - 1), current + 1));
    if (key.leftArrow) return setPolicyIndex((current) => (current + MODEL_POLICIES.length - 1) % MODEL_POLICIES.length);
    if (key.rightArrow || key.tab) return setPolicyIndex((current) => (current + 1) % MODEL_POLICIES.length);
    if (input.toLowerCase() === "c" && !query) return setFilters((current) => ({ ...current, code: !current.code }));
    if (input.toLowerCase() === "t" && !query) return setFilters((current) => ({ ...current, tools: !current.tools }));
    if (input.toLowerCase() === "v" && !query) return setFilters((current) => ({ ...current, vision: !current.vision }));
    if (key.return && key.ctrl && query.trim()) return onSelect(query.trim(), policy);
  });

  const submit = () => {
    if (selected) onSelect(selected.id, policy);
    else if (query.trim()) onSelect(query.trim(), policy);
  };

  return h(Box, { borderStyle: "double", borderColor: theme.accent, flexDirection: "column", paddingX: 1, marginX: 1 },
    h(Box, { justifyContent: "space-between" },
      h(Text, { color: theme.accent, bold: true }, "Выбор модели Hugging Face"),
      h(Text, { dimColor: true }, `${source === "live" ? "живой каталог" : "офлайн fallback"} · моделей: ${models.length}`),
    ),
    h(Box, { borderStyle: "round", borderColor: theme.border, paddingX: 1, marginTop: 1 },
      h(Text, { color: theme.muted }, "Поиск  "),
      h(TextInput, { value: query, onChange: (value) => { setQuery(value); setIndex(0); }, onSubmit: submit, placeholder: "ID модели, провайдер или возможность" }),
    ),
    h(Box, { marginTop: 1 },
      h(Text, { color: filters.code ? theme.accent : theme.muted }, `[C] код ${filters.code ? "да" : "нет"}`),
      h(Text, { dimColor: true }, "  "),
      h(Text, { color: filters.tools ? theme.accent : theme.muted }, `[T] tools ${filters.tools ? "да" : "нет"}`),
      h(Text, { dimColor: true }, "  "),
      h(Text, { color: filters.vision ? theme.accent : theme.muted }, `[V] vision ${filters.vision ? "да" : "нет"}`),
      h(Text, { dimColor: true }, "  ·  Стратегия провайдера: "),
      h(Text, { color: theme.warning, bold: true }, policy),
    ),
    h(Box, { flexDirection: "column", marginTop: 1 },
      visible.length ? visible.map((model, itemIndex) => h(Box, { key: model.id, flexDirection: "column", paddingX: 1 },
        h(Text, { color: itemIndex === index ? theme.accent : undefined, bold: itemIndex === index }, `${itemIndex === index ? "›" : " "} ${model.label} `, h(Text, { dimColor: true }, `(${model.id})`)),
        itemIndex === index ? h(Text, { color: theme.muted }, `   ${model.tags.join(" · ") || "chat"} · контекст ${compactNumber(model.contextLength)} · ${model.provider}`) : null,
      )) : h(Text, { color: theme.warning }, "Моделей не найдено. Ctrl+Enter использует введённый ID напрямую."),
    ),
    selected ? h(Box, { borderStyle: "single", borderColor: theme.border, flexDirection: "column", paddingX: 1, marginTop: 1 },
      h(Text, { color: theme.info, bold: true }, selected.id),
      h(Text, { dimColor: true }, selected.description),
      h(Text, { dimColor: true }, `tools: ${selected.supportsTools ? "да" : "неизвестно"} · vision: ${selected.supportsVision ? "да" : "нет"} · макс. вывод: ${compactNumber(selected.maxOutputTokens)}`),
    ) : null,
    h(Text, { dimColor: true }, "↑/↓ выбор · ←/→ стратегия · Enter выбрать · Ctrl+Enter введённый ID · Esc закрыть"),
    h(Text, { color: theme.muted }, `Текущая: ${currentModel}`),
  );
}
