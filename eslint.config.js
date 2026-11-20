import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Two separate jobs, on purpose:
//   - `bun run lint`  (this file) — correctness: unused imports, bad hook
//     dependencies, refresh-safety. Fast to read, safe to gate CI on.
//   - `bun run format` (Prettier, .prettierrc) — layout only.
// Formatting used to run inside ESLint through eslint-plugin-prettier, which
// made a single quote style or a line 101 characters long a build-breaking
// error in ~4k places across files nobody was editing. Formatting is opt-in
// now and the two tools can't disagree again.
export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", "node_modules", "public"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Vendored shadcn primitives export their variant tables next to the
    // component, and the provider modules export their hook beside the
    // provider. Both cost only a Fast Refresh boundary while editing; the
    // alternative is splitting working files purely for the dev server.
    files: ["src/components/ui/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
