import React, { createElement as h, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { commandSuggestions } from "../command-catalog.js";

const COMMANDS = commandSuggestions();

function printable(input, key) {
  return input && !key.ctrl && !key.meta && !key.escape && !key.return && !key.tab;
}

export function PromptInput({ value, onChange, onSubmit, disabled = false, pending = 0, history = [], theme, onCancel }) {
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(null);
  const draft = useRef("");
  const query = value.startsWith("/") && !value.includes("\n") ? value.slice(1).toLowerCase() : "";
  const suggestions = useMemo(() => query ? COMMANDS.filter(([command]) => command.startsWith(query)).slice(0, 6) : [], [query]);

  useEffect(() => setSuggestionIndex(0), [query]);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    setHistoryIndex(null);
    draft.current = "";
    onSubmit(text);
  };

  useInput((input, key) => {
    if (disabled) return;
    if (key.escape) return onCancel?.();
    if (key.return) {
      if (key.shift) return onChange(`${value}\n`);
      return submit();
    }
    if (suggestions.length && key.upArrow) return setSuggestionIndex((index) => Math.max(0, index - 1));
    if (suggestions.length && key.downArrow) return setSuggestionIndex((index) => Math.min(suggestions.length - 1, index + 1));
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
      return;
    }
    if (key.backspace || key.delete) return onChange(value.slice(0, -1));
    if (printable(input, key)) onChange(`${value}${input}`);
  }, { isActive: !disabled });

  const lines = value.split("\n");
  return h(Box, { flexDirection: "column", paddingX: 1, paddingBottom: 1 },
    h(Box, { borderStyle: "round", borderColor: disabled ? theme.warning : theme.accent, paddingX: 1, flexDirection: "column" },
      h(Box, null,
        h(Text, { color: theme.accent, bold: true }, "❯ "),
        h(Text, { color: value ? undefined : theme.muted }, value ? "" : "Опишите задачу, введите / для команд или Ctrl+P для палитры"),
        pending > 0 ? h(Text, { color: theme.info }, `  queue ${pending}`) : null,
      ),
      value ? h(Box, { flexDirection: "column", paddingLeft: 2 }, lines.map((line, index) => h(Text, { key: `${index}-${line}` }, index === lines.length - 1 ? `${line}▍` : line || " "))) : null,
    ),
    suggestions.length > 0 ? h(Box, { marginLeft: 2, flexDirection: "column" },
      suggestions.map(([command, label], index) => h(Text, { key: command, color: index === suggestionIndex ? theme.accent : theme.muted },
        `${index === suggestionIndex ? "›" : " "} /${command} `,
        h(Text, { dimColor: true }, `— ${label}`),
      )),
    ) : null,
    h(Box, { marginLeft: 1 },
      h(Text, { dimColor: true }, "Enter отправить · Shift+Enter строка · ↑/↓ история · Tab дополнить · Ctrl+M модели · Ctrl+P палитра · Esc отменить"),
    ),
    disabled ? h(Text, { color: theme.warning }, "  Открыто окно выбора. Esc закрывает или отменяет его.") : null,
  );
}
