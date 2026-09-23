import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.tmp/**",
    ],
  },

  js.configs.recommended,

  {
    files: ["**/*.cjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.mjs", "server/src/**/*.js"],
    languageOptions: { globals: globals.nodeBuiltin },
  },

  ...tseslint.configs.recommended,

  {
    files: ["client/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
    },
  },
);