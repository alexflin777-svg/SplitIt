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
        }
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"]
      },
      borderRadius: {
        lg: "16px",
        md: "12px",
        sm: "8px"
      }
    },
  },
  plugins: [],
};
export default config;
