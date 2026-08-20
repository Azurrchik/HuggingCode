import React, { createElement as h } from "react";
import { Box, Text } from "ink";

export function FooterBar({ theme, columns = 100 }) {
  const compact = columns < 78;
  return h(Box, { paddingX: 2, justifyContent: "space-between" },
    h(Text, { color: theme.muted }, compact ? "Ctrl+P палитра · Ctrl+M модели · Ctrl+T цвет" : "Ctrl+P палитра · Ctrl+M модели · Ctrl+T цвет · Ctrl+L очистить"),
    h(Text, { dimColor: true }, compact ? "Ctrl+C выход" : "Enter отправить · Shift+Enter новая строка · Ctrl+C выход"),
  );
}
