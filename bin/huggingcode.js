#!/usr/bin/env node
import { Command } from "commander";
import { startInteractiveTui } from "../src/tui/start.js";
import { checkForUpdate } from "../src/update-check.js";

const program = new Command();

program
  .name("huggingcode")
  .description("Интерактивный coding agent с удалёнными моделями Hugging Face")
  .version("1.0.1")
  .option("--cwd <path>", "рабочий каталог проекта")
  .action(async (options) => {
    try {
      const updateCheck = checkForUpdate(program.version());
      await startInteractiveTui({ workspaceRoot: options.cwd, updateCheck });
    } catch (error) {
      console.error(`\nHuggingCode: ${error.message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync();
