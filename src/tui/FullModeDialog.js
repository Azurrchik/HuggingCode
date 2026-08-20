import React, { createElement as h, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export function FullModeDialog({ phrase, workspace, theme, onConfirm, onCancel }) {
  const [value, setValue] = useState("");
  const valid = value.trim() === phrase;
  useInput((input, key) => {
    if (key.escape) onCancel();
  });

  return h(Box, { borderStyle: "double", borderColor: theme.danger, flexDirection: "column", paddingX: 1, marginX: 1 },
    h(Text, { color: theme.danger, bold: true }, "FULL MODE — автономные действия в проекте"),
    h(Text, null, "Агент перестанет спрашивать перед изменением или удалением обычных файлов и перед запуском неадминистративных команд в выбранном workspace:"),
    h(Text, { color: theme.warning, bold: true }, workspace),
    h(Text, { dimColor: true }, "Жёсткие границы остаются: нет доступа за пределами workspace и нет чтения или записи секретных файлов."),
    h(Box, { borderStyle: "round", borderColor: valid ? theme.success : theme.warning, paddingX: 1, marginTop: 1 },
      h(Text, { color: theme.muted }, "Введите точно: "),
      h(Text, { color: theme.danger, bold: true }, phrase),
    ),
    h(Box, { marginTop: 1 },
      h(TextInput, { value, onChange: setValue, onSubmit: () => { if (valid) onConfirm(value); }, placeholder: "Фраза подтверждения" }),
    ),
    valid ? h(Text, { color: theme.success }, "Нажмите Enter, чтобы включить full mode только для этой сессии.") : h(Text, { dimColor: true }, "Esc — отмена. Full mode никогда не сохраняется в настройках."),
  );
}
