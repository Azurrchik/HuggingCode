import React, { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { appendTranscript, createTranscript } from "./transcript.js";
import { resolveTheme } from "./theme.js";
import { TranscriptView } from "./TranscriptView.js";
import { PromptInput } from "./PromptInput.js";
import { StatusBar } from "./StatusBar.js";
import { PermissionCard } from "./PermissionCard.js";

export function HuggingCodeApp({ controller }) {
  const { exit } = useApp();
  const { rows: terminalRows } = useWindowSize();
  const [rows, setRows] = useState(createTranscript);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState([]);
  const queueRef = useRef([]);
  const [approval, setApproval] = useState(null);
  const [goal, setGoal] = useState("");
  const { colors: theme } = useMemo(() => resolveTheme(controller.config.theme), [controller.config.theme]);

  useEffect(() => controller.subscribe((event) => {
    if (event.type === "approval_requested") setApproval(event.action);
    setRows((current) => appendTranscript(current, event));
  }), [controller]);

  const execute = useCallback(async (text) => {
    setBusy(true);
    await controller.submit(text);
    setBusy(false);
    const next = queueRef.current.shift();
    setQueue([...queueRef.current]);
    if (next) void execute(next);
  }, [controller]);

  const submit = useCallback((text) => {
    setInput("");
    setHistory((current) => current.at(-1) === text ? current : [...current, text].slice(-100));
    if (text === "/exit" || text === "/quit") {
      controller.close();
      exit();
      return;
    }
    if (text.startsWith("/goal ")) {
      setGoal(text.slice(6).trim());
    }
    if (busy) {
      queueRef.current.push(text);
      setQueue([...queueRef.current]);
      setRows((current) => appendTranscript(current, { type: "notice", level: "info", content: "Сообщение добавлено в очередь." }));
      return;
    }
    void execute(text);
  }, [busy, controller, execute, exit]);

  const cancel = useCallback(() => {
    if (approval) {
      controller.resolveApproval("deny");
      setApproval(null);
      return;
    }
    if (busy && controller.cancel()) return;
    if (input) setInput("");
  }, [approval, busy, controller, input]);

  useInput((value, key) => {
    if ((key.ctrl && value.toLowerCase() === "c") || (key.ctrl && value.toLowerCase() === "d")) {
      controller.close();
      exit();
    }
  }, { isActive: !approval });

  const maxRows = Math.max(8, terminalRows - 10);
  const status = controller.getStatus({ busy, queueCount: queue.length, goal });

  return h(Box, { flexDirection: "column", width: "100%" },
    h(Box, { borderStyle: "round", borderColor: theme.accent, paddingX: 1, marginX: 1 },
      h(Text, { color: theme.accent, bold: true }, "HuggingCode"),
      h(Text, { dimColor: true }, " · Hugging Face interactive coding agent"),
    ),
    h(TranscriptView, { rows, theme, maxRows }),
    approval ? h(PermissionCard, { request: approval, theme, onDecide: (decision) => { controller.resolveApproval(decision); setApproval(null); } }) : null,
    h(StatusBar, { status, theme }),
    h(PromptInput, { value: input, onChange: setInput, onSubmit: submit, history, pending: queue.length, theme, onCancel: cancel, disabled: Boolean(approval) }),
  );
}
