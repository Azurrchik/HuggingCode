#!/usr/bin/env node
import { Command } from "commander";
import { startInteractive } from "../src/ui.js";

const program = new Command();

program
  .name("huggingcode")
  .description("Локальный coding agent с удалёнными моделями Hugging Face")
  .version("0.1.0")
  .action(async () => {
    try {
      await startInteractive();
    } catch (error) {
      console.error(`\nHuggingCode: ${error.message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync();
