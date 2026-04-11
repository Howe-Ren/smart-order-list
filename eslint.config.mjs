// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals"; // <-- ADD THIS IMPORT

export default defineConfig([
  { ignores:["main.js", "src/main_2.0.0.ts", "**/*.mjs"] },
  
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      
      // ADD THIS BLOCK:
      globals: {
        ...globals.browser, // Includes window, document, console, etc.
      }
    },
    rules: {
    },
  },
]);