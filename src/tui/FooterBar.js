import React, { createElement as h } from "react";
import { Box, Text } from "ink";

export function FooterBar({ theme, columns = 100 }) {
  const compact = columns < 78;
  return h(Box, { paddingX: 2, justifyContent: "space-between" },
    h(Text, { color: theme.muted }, compact ? "Ctrl+P палитра · Ctrl+M модели · Esc отмена" : "Ctrl+P палитра · Ctrl+M модели · Ctrl+L очистить · Esc отменить turn"),
    h(Text, { dimColor: true }, compact ? "Ctrl+C выход" : "Enter отправить · Shift+Enter новая строка · Ctrl+C выход"),
  );
}
