import React, { createElement as h, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

const COMMANDS = [
  ["help", "справка"], ["models", "каталог HF моделей"], ["model", "выбрать модель"], ["effort", "reasoning effort"], ["theme", "сменить тему"], ["mode", "сменить режим"],
  ["context", "состояние контекста"], ["compact", "сжать контекст"], ["undo", "откатить правки агента"],
  ["verify", "lint, typecheck и test"], ["sessions", "поиск сессий"], ["resume", "восстановить сессию"],
  ["branch", "ветка сессии"], ["rename", "переименовать сессию"], ["export", "экспорт Markdown"],
  ["skills", "список навыков"], ["skill", "запустить навык"], ["attach", "вложить текстовый файл"],
  ["subtask", "локальная подзадача"], ["tasks", "статус подзадач"], ["stop", "остановить подзадачу"],
  ["status", "состояние"], ["doctor", "диагностика"], ["clear", "очистить контекст"], ["logout", "удалить токен"], ["exit", "выйти"],
];

export function PromptInput({ value, onChange, onSubmit, disabled = false, pending = 0, history = [], theme, onCancel }) {
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(null);
  const draft = useRef("");
  const query = value.startsWith("/") ? value.slice(1).toLowerCase() : "";
  const suggestions = useMemo(() => query ? COMMANDS.filter(([command]) => command.startsWith(query)) : [], [query]);

  useEffect(() => setSuggestionIndex(0), [value]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (suggestions.length && key.upArrow) {
      setSuggestionIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (suggestions.length && key.downArrow) {
      setSuggestionIndex((index) => Math.min(suggestions.length - 1, index + 1));
      return;
    }
    if (suggestions.length && key.tab) {
      const selected = suggestions[suggestionIndex];
      if (selected) onChange(`/${selected[0]} `);
      return;
    }
    if (!suggestions.length && (key.upArrow || key.downArrow)) {
      if (!history.length) return;
      let next;
      if (key.upArrow) {
        const index = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
        if (historyIndex === null) draft.current = value;
        setHistoryIndex(index);
        next = history[index];
      } else if (historyIndex === null) {
        next = value;
      } else {
        const index = historyIndex + 1;
        if (index >= history.length) {
          setHistoryIndex(null);
          next = draft.current;
        } else {
          setHistoryIndex(index);
          next = history[index];
        }
      }
      if (next !== undefined) onChange(next);
    }
  }, { isActive: !disabled });

  const submit = (input) => {
    const text = input.trim();
    if (!text) return;
    setHistoryIndex(null);
    draft.current = "";
    onSubmit(text);
  };

  return h(Box, { flexDirection: "column", paddingX: 1, paddingBottom: 1 },
    h(Box, { borderStyle: "round", borderColor: disabled ? theme.warning : theme.accent, paddingX: 1 },
      h(Text, { color: theme.accent, bold: true }, "› "),
      h(TextInput, { value, onChange, onSubmit: submit, placeholder: "Опишите задачу или введите / для команд", focus: !disabled }),
      pending > 0 ? h(Text, { color: theme.info }, ` · очередь: ${pending}`) : null,
    ),
    suggestions.length > 0 ? h(Box, { marginLeft: 2, flexDirection: "column" },
      suggestions.slice(0, 6).map(([command, label], index) => h(Text, { key: command, color: index === suggestionIndex ? theme.accent : theme.muted },
        `${index === suggestionIndex ? "›" : " "} /${command} `,
        h(Text, { dimColor: true }, `— ${label}`),
      )),
      h(Text, { dimColor: true }, "Tab — дополнить · ↑/↓ — выбрать · Esc — отменить"),
    ) : null,
    disabled ? h(Text, { color: theme.muted }, "  Введите следующее сообщение: оно будет поставлено в очередь.") : null,
  );
}
