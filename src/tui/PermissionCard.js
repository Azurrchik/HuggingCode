import React, { createElement as h } from "react";
import { Box, Text, useInput } from "ink";
import { cleanTerminalText } from "./transcript.js";

function preview(value, limit = 5000) {
  const text = cleanTerminalText(value);
  return text.length > limit ? `${text.slice(0, limit)}\n… preview сокращён` : text;
}

export function PermissionCard({ request, theme, onDecide }) {
  useInput((input, key) => {
    const char = input.toLowerCase();
    if (char === "y") onDecide("allow");
    if (char === "n" || key.escape || key.return) onDecide("deny");
  });

  const action = request.type === "write" ? "Изменение файла" : request.type === "delete" ? "Удаление файла" : "Запуск команды";
  const target = request.path || request.command || "неизвестное действие";
  const body = request.type === "command" ? request.command : request.content;

  return h(Box, { flexDirection: "column", borderStyle: "double", borderColor: theme.warning, paddingX: 1, marginX: 1 },
    h(Text, { color: theme.warning, bold: true }, `Подтверждение: ${action}`),
    h(Text, { color: theme.info }, target),
    request.reason ? h(Text, { dimColor: true }, `Причина: ${request.reason}`) : null,
    body ? h(Box, { marginTop: 1, flexDirection: "column" },
      h(Text, { dimColor: true }, request.type === "command" ? "Команда:" : "Preview:"),
      h(Text, null, preview(body)),
    ) : null,
    h(Box, { marginTop: 1 },
      h(Text, null,
        h(Text, { color: theme.success, bold: true }, "Y"), " разрешить один раз · ",
        h(Text, { color: theme.danger, bold: true }, "N"), " запретить · ",
        h(Text, { dimColor: true }, "Esc"), " закрыть",
      ),
    ),
  );
}
