import React, { createElement as h } from "react";
import { render } from "ink";
import * as p from "@clack/prompts";
import { getStoredToken, saveToken } from "../storage.js";
import { verifyHuggingFaceToken } from "../agent.js";
import { HuggingController } from "../controller.js";
import { HuggingCodeApp } from "./App.js";

const TOKEN_URL = "https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained";

function cancelled(value) {
  if (p.isCancel(value)) {
    p.cancel("Сеанс завершён.");
    process.exit(0);
  }
  return value;
}

async function requestToken() {
  p.intro("HuggingCode — подключение Hugging Face");
  p.note(`Создайте fine-grained token с правом “Make calls to Inference Providers”.\n${TOKEN_URL}\n\nТокен будет зашифрован Windows DPAPI и привязан к вашей учётной записи.`, "Первый запуск");
  while (true) {
    const token = cancelled(await p.password({
      message: "Вставьте токен Hugging Face",
      validate(value) {
        if (!value?.trim()) return "Токен не может быть пустым.";
        if (!value.trim().startsWith("hf_")) return "Токен должен начинаться с hf_.";
      },
    }));
    const spinner = p.spinner();
    spinner.start("Проверяю токен");
    try {
      const account = await verifyHuggingFaceToken(token.trim());
      await saveToken(token.trim());
      spinner.stop(`Токен принят для ${account}.`);
      return token.trim();
    } catch (error) {
      spinner.stop("Токен не сохранён.");
      p.log.error(error.message);
      const retry = cancelled(await p.confirm({ message: "Попробовать ещё раз?", initialValue: true }));
      if (!retry) throw new Error("Вход отменён.");
    }
  }
}

export async function startInteractiveTui(options = {}) {
  let token = await getStoredToken();
  if (!token) token = await requestToken();
  const controller = await HuggingController.create({ token, workspaceRoot: options.workspaceRoot || process.cwd() });
  await controller.initialize();
  const app = render(h(HuggingCodeApp, { controller }), { exitOnCtrlC: false });
  await app.waitUntilExit();
}
