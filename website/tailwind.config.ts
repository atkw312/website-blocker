import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0c0a09",
        surface: "#1c1917",
        "surface-light": "#292524",
        paper: "#f7f4f0",
        muted: "#a8a29e",
      },
    },
  },
  plugins: [],
};

export default config;
