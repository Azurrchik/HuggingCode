import { h } from "react";
import { render } from "ink";
import * as p from "@clack/prompts";
import { getStorageInfo, getProviderToken, saveProviderToken } from "../storage.js";
import { verifyHuggingFaceToken } from "../agent.js";
import { HuggingController } from "../controller.js";
import { getConfig } from "../config.js";
import { normalizeProvider } from "../providers.js";
import { formatUpdateNotice } from "../update-check.js";
import { HuggingCodeApp } from "./App.js";

const TOKEN_URL = "https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained";
function cancelled(value) { if (p.isCancel(value)) { p.cancel("Сеанс завершён."); process.exit(0); } return value; }

async function requestToken(profile) {
  p.intro(`HuggingCode — подключение ${profile.label}`);
  const storage = getStorageInfo();
  const storageNote = storage.persistent ? `Ключ будет сохранён через ${storage.label} и привязан к текущей учётной записи.` : "Системное защищённое хранилище не поддерживается; ключ будет доступен только до закрытия приложения.";
  if (profile.id === "huggingface") p.note(`Создайте fine-grained token с правом “Make calls to Inference Providers”.\n${TOKEN_URL}\n\n${storageNote}`, "Первый запуск");
  else p.note(`Endpoint: ${profile.endpoint}\n\n${storageNote}`, "Первый запуск");
  while (true) {
    const token = cancelled(await p.password({
      message: profile.id === "huggingface" ? "Вставьте токен Hugging Face" : `Вставьте API key ${profile.label}`,
      validate(value) { if (!value?.trim()) return "Ключ не может быть пустым."; if (profile.id === "huggingface" && !value.trim().startsWith("hf_")) return "Токен должен начинаться с hf_."; if (profile.id !== "huggingface" && value.trim().length < 8) return "Ключ выглядит неполным."; },
    }));
    const spinner = p.spinner(); spinner.start(profile.id === "huggingface" ? "Проверяю токен" : "Сохраняю ключ");
    try {
      let account = null; if (profile.id === "huggingface") account = await verifyHuggingFaceToken(token.trim());
      const saved = await saveProviderToken(profile.id, token.trim());
      spinner.stop(saved.persistent ? `${profile.id === "huggingface" ? `Токен принят для ${account}` : "Ключ принят"} и сохранён в ${saved.backend}.` : "Ключ принят только для текущего сеанса.");
      if (saved.warning) p.log.warn(saved.warning); return token.trim();
    } catch (error) {
      spinner.stop("Ключ не сохранён."); p.log.error(error.message);
      const retry = cancelled(await p.confirm({ message: "Попробовать ещё раз?", initialValue: true })); if (!retry) throw new Error("Вход отменён.");
    }
  }
}

export async function startInteractiveTui(options = {}) {
  const config = await getConfig(); const profile = normalizeProvider(config.provider, config.providerEndpoint);
  let token = await getProviderToken(profile.id); if (!token) token = await requestToken(profile);
  const controller = await HuggingController.create({ token, workspaceRoot: options.workspaceRoot || process.cwd(), provider: profile.id, providerEndpoint: profile.endpoint });
  await controller.initialize(); const app = render(h(HuggingCodeApp, { controller }), { exitOnCtrlC: false });
  if (options.updateCheck) void Promise.resolve(options.updateCheck).then((update) => { const content = formatUpdateNotice(update); if (content) controller.emit({ type: "notice", level: "info", content }); });
  await app.waitUntilExit();
}
