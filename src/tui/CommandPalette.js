import React, { createElement as h, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

const COMMANDS = [
  { command: "/model", label: "Выбрать модель", detail: "Открыть живой каталог Hugging Face" },
  { command: "/mode", label: "Изменить режим доступа", detail: "manual, accept-edits, plan, safe-auto или full" },
  { command: "/context", label: "Проверить контекст", detail: "Сообщения и оценка токенов" },
  { command: "/compact", label: "Сжать контекст", detail: "Подготовить краткое резюме" },
  { command: "/undo", label: "Откатить правки", detail: "Восстановить последний checkpoint" },
  { command: "/verify", label: "Запустить проверки", detail: "Найти и выполнить lint, test, build" },
  { command: "/sessions", label: "Открыть сессии", detail: "Найти сохранённые разговоры" },
  { command: "/skills", label: "Открыть навыки", detail: "Показать Markdown-навыки проекта" },
  { command: "/doctor", label: "Запустить диагностику", detail: "Платформа, хранилище, контекст и workspace" },
  { command: "/help", label: "Показать команды", detail: "Полная справка терминала" },
];

export function CommandPalette({ theme, onExecute, onClose }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const visible = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return COMMANDS.filter((item) => !needle || `${item.command} ${item.label} ${item.detail}`.toLowerCase().includes(needle));
  }, [query]);
  const selected = visible[Math.min(index, Math.max(0, visible.length - 1))];

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.upArrow) return setIndex((current) => Math.max(0, current - 1));
    if (key.downArrow) return setIndex((current) => Math.min(Math.max(0, visible.length - 1), current + 1));
  });

  const submit = () => {
    if (selected) onExecute(selected.command);
  };

  return h(Box, { borderStyle: "double", borderColor: theme.accent, flexDirection: "column", paddingX: 1, marginX: 1 },
    h(Text, { color: theme.accent, bold: true }, "Палитра команд"),
    h(Box, { borderStyle: "round", borderColor: theme.border, paddingX: 1, marginTop: 1 },
      h(Text, { color: theme.muted }, "⌘  "),
      h(TextInput, { value: query, onChange: (value) => { setQuery(value); setIndex(0); }, onSubmit: submit, placeholder: "Найти действие" }),
    ),
    h(Box, { flexDirection: "column", marginTop: 1 },
      visible.map((item, itemIndex) => h(Box, { key: item.command, flexDirection: "column", paddingX: 1 },
        h(Text, { color: itemIndex === index ? theme.accent : undefined, bold: itemIndex === index }, `${itemIndex === index ? "›" : " "} ${item.label}  `, h(Text, { dimColor: true }, item.command)),
        itemIndex === index ? h(Text, { color: theme.muted }, `   ${item.detail}`) : null,
      )),
      !visible.length ? h(Text, { color: theme.warning }, "Совпадений не найдено.") : null,
    ),
    h(Text, { dimColor: true }, "↑/↓ выбор · Enter выполнить · Esc закрыть"),
  );
}
