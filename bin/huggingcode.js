#!/usr/bin/env node
import { Command } from "commander";
import { startInteractiveTui } from "../src/tui/start.js";

const program = new Command();

program
  .name("huggingcode")
  .description("Интерактивный coding agent с удалёнными моделями Hugging Face")
  .version("0.4.0")
  .option("--cwd <path>", "рабочий каталог проекта")
  .action(async (options) => {
    try {
      await startInteractiveTui({ workspaceRoot: options.cwd });
    } catch (error) {
      console.error(`\nHuggingCode: ${error.message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync();
