import React, { createElement as h, useState } from "react";
import { Box, Text, useInput } from "ink";
import { THEME_OPTIONS, resolveTheme } from "./theme.js";

export function ThemePicker({ currentTheme, theme, onSelect, onClose }) {
  const initial = Math.max(0, THEME_OPTIONS.findIndex((item) => item.id === resolveTheme(currentTheme).name));
  const [index, setIndex] = useState(initial);
  const selected = THEME_OPTIONS[index];
  const preview = resolveTheme(selected.id).colors;

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.upArrow) return setIndex((value) => Math.max(0, value - 1));
    if (key.downArrow) return setIndex((value) => Math.min(THEME_OPTIONS.length - 1, value + 1));
    if (key.return) onSelect(selected.id);
    if (input && !key.ctrl && !key.meta) {
      const match = THEME_OPTIONS.findIndex((item) => item.id.startsWith(input.toLowerCase()));
      if (match >= 0) setIndex(match);
    }
  });

  return h(Box, { borderStyle: "double", borderColor: theme.accent, flexDirection: "column", paddingX: 1, marginX: 1 },
    h(Text, { color: theme.accent, bold: true }, "Цвет интерфейса"),
    h(Text, { color: theme.muted }, "Выберите тему: она применяется сразу и сохраняется для следующих запусков."),
    h(Box, { flexDirection: "column", marginTop: 1 },
      THEME_OPTIONS.map((item, itemIndex) => {
        const colors = resolveTheme(item.id).colors;
        const active = itemIndex === index;
        return h(Box, { key: item.id, flexDirection: "column", paddingX: 1 },
          h(Text, { color: active ? colors.accent : theme.muted, bold: active }, `${active ? "›" : " "} ${item.label}  `, h(Text, { dimColor: true }, item.id)),
          active ? h(Text, { color: colors.info }, `   ${item.description}`) : null,
        );
      }),
    ),
    h(Box, { borderStyle: "round", borderColor: preview.border, paddingX: 1, marginTop: 1 },
      h(Text, { color: preview.accent, bold: true }, "HuggingCode"),
      h(Text, { color: preview.muted }, "  preview  "),
      h(Text, { color: preview.success }, "готово"),
      h(Text, { color: preview.warning }, " · внимание"),
      h(Text, { color: preview.info }, " · информация"),
    ),
    h(Text, { dimColor: true }, "↑/↓ выбор · Enter применить · первая буква перейти · Esc закрыть"),
  );
}
