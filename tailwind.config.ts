import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#3b82f6",
          "primary-dark": "#0058be",
          success: "#10b981",
          warning: "#f59e0b",
          neutral: "#64748b",
          surface: "#f8f9ff",
          card: "#ffffff",
          darkBg: "#131313",
          darkCard: "#201f1f"
        },
        // Язык V1 (макеты 1.1.0, stage2/tokens.css): мята — тебе должны, персик — ты должен,
        // кобальт — только одна главная кнопка, лаванда — проект.
        v1: {
          bg: "var(--v1-bg)",
          card: "var(--v1-card)",
          fill: "var(--v1-fill)",
          ink: "var(--v1-ink)",
          ink2: "var(--v1-ink-2)",
          muted: "var(--v1-muted)",
          accent: "var(--v1-accent)",
          "accent-press": "var(--v1-accent-press)",
          "accent-soft": "var(--v1-accent-soft)",
          "accent-ink": "var(--v1-accent-ink)",
          plus: "var(--v1-plus)",
          minus: "var(--v1-minus)",
          lav: "var(--v1-lav)",
          "lav-soft": "var(--v1-lav-soft)",
          trip: "var(--v1-trip)",
          sand: "var(--v1-sand)",
          warn: "var(--v1-warn)",
          danger: "var(--v1-danger)",
          ok: "var(--v1-ok)"
        }
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        v1: ["Onest", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"]
      },
      borderRadius: {
        lg: "16px",
        md: "12px",
        sm: "8px",
        tile: "28px",
        card: "24px",
        row: "18px",
        btn: "16px",
        chip: "14px"
      }
    },
  },
  plugins: [],
};
export default config;
