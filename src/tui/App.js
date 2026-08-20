import React, { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, useApp, useInput, useWindowSize } from "ink";
import { appendTranscript, createTranscript } from "./transcript.js";
import { resolveTheme } from "./theme.js";
import { TranscriptView } from "./TranscriptView.js";
import { PromptInput } from "./PromptInput.js";
import { StatusBar } from "./StatusBar.js";
import { PermissionCard } from "./PermissionCard.js";
import { ModelPicker } from "./ModelPicker.js";
import { CommandPalette } from "./CommandPalette.js";
import { FullModeDialog } from "./FullModeDialog.js";
import { HeaderBar } from "./HeaderBar.js";
import { FooterBar } from "./FooterBar.js";

export function HuggingCodeApp({ controller }) {
  const { exit } = useApp();
  const { rows: terminalRows, columns: terminalColumns } = useWindowSize();
  const [rows, setRows] = useState(createTranscript);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState([]);
  const queueRef = useRef([]);
  const [approval, setApproval] = useState(null);
  const [modelPicker, setModelPicker] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [fullModeRequest, setFullModeRequest] = useState(null);
  const [goal, setGoal] = useState("");
  const { colors: theme } = useMemo(() => resolveTheme(controller.config.theme), [controller.config.theme]);
  const overlayOpen = Boolean(approval || modelPicker || paletteOpen || fullModeRequest);

  useEffect(() => controller.subscribe((event) => {
    if (event.type === "approval_requested") setApproval(event.action);
    if (event.type === "model_picker_requested") setModelPicker(event);
    if (event.type === "full_mode_requested") setFullModeRequest(event);
    if (!["approval_requested", "model_picker_requested", "full_mode_requested"].includes(event.type)) {
      setRows((current) => appendTranscript(current, event));
    }
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
    const value = text.trim();
    if (!value) return;
    setInput("");
    setHistory((current) => current.at(-1) === value ? current : [...current, value].slice(-100));
    if (value === "/exit" || value === "/quit") {
      controller.close();
      exit();
      return;
    }
    if (value.startsWith("/goal ")) setGoal(value.slice(6).trim());
    if (busy) {
      queueRef.current.push(value);
      setQueue([...queueRef.current]);
      setRows((current) => appendTranscript(current, { type: "notice", level: "info", content: "Сообщение добавлено в очередь." }));
      return;
    }
    void execute(value);
  }, [busy, controller, execute, exit]);

  const cancel = useCallback(() => {
    if (approval) {
      controller.resolveApproval("deny");
      setApproval(null);
      return;
    }
    if (fullModeRequest) {
      controller.cancelFullModeActivation();
      setFullModeRequest(null);
      return;
    }
    if (modelPicker) return setModelPicker(null);
    if (paletteOpen) return setPaletteOpen(false);
    if (busy && controller.cancel()) return;
    if (input) setInput("");
  }, [approval, busy, controller, fullModeRequest, input, modelPicker, paletteOpen]);

  useInput((value, key) => {
    if ((key.ctrl && value.toLowerCase() === "c") || (key.ctrl && value.toLowerCase() === "d")) {
      controller.close();
      exit();
      return;
    }
    if (overlayOpen) return;
    if (key.ctrl && value.toLowerCase() === "m") {
      void execute("/model");
      return;
    }
    if (key.ctrl && value.toLowerCase() === "p") {
      setPaletteOpen(true);
      return;
    }
    if (key.ctrl && value.toLowerCase() === "l") {
      setRows(createTranscript());
    }
  }, { isActive: true });

  const chooseModel = useCallback(async (modelId, policy) => {
    setModelPicker(null);
    try {
      await controller.selectModel(modelId, policy);
    } catch (error) {
      setRows((current) => appendTranscript(current, { type: "error", content: error.message }));
    }
  }, [controller]);

  const maxRows = Math.max(7, terminalRows - (terminalColumns < 70 ? 13 : 12));
  const status = controller.getStatus({ busy, queueCount: queue.length, goal });

  return h(Box, { flexDirection: "column", width: "100%" },
    h(HeaderBar, { status, theme, columns: terminalColumns }),
    h(TranscriptView, { rows, theme, maxRows }),
    approval ? h(PermissionCard, { request: approval, theme, onDecide: (decision) => { controller.resolveApproval(decision); setApproval(null); } }) : null,
    modelPicker ? h(ModelPicker, { models: modelPicker.models, source: modelPicker.source, currentModel: modelPicker.currentModel, theme, onSelect: chooseModel, onClose: () => setModelPicker(null) }) : null,
    paletteOpen ? h(CommandPalette, { theme, onExecute: (command) => { setPaletteOpen(false); submit(command); }, onClose: () => setPaletteOpen(false) }) : null,
    fullModeRequest ? h(FullModeDialog, { phrase: fullModeRequest.phrase, workspace: fullModeRequest.workspace, theme, onConfirm: (phrase) => { if (controller.confirmFullMode(phrase)) setFullModeRequest(null); }, onCancel: () => { controller.cancelFullModeActivation(); setFullModeRequest(null); } }) : null,
    h(StatusBar, { status, theme }),
    h(PromptInput, { value: input, onChange: setInput, onSubmit: submit, history, pending: queue.length, theme, onCancel: cancel, disabled: overlayOpen }),
    h(FooterBar, { theme, columns: terminalColumns }),
  );
}
