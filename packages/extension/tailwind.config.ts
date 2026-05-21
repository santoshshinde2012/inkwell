import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  // The Side Panel is dark-only; the options page is forced dark via the
  // `dark` class on <html> so the existing `dark:` variants activate
  // regardless of the user's system preference. Keeps the two surfaces
  // visually consistent.
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
