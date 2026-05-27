import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Flat ESLint config for @inkwell/shared — core + typescript-eslint
// recommended rules. (The backend lints via `next lint` separately.)
export default tseslint.config(
  { ignores: ["dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
