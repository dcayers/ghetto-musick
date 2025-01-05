import type { Config } from "tailwindcss";
import { default as tailwindReactAria } from "tailwindcss-react-aria-components";
import { nextui } from "@nextui-org/react";

export default {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [nextui(), tailwindReactAria({ prefix: "rac" })],
} satisfies Config;
