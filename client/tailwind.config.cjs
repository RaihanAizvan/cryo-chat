/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: "#0a0a0c",
          raised: "#111114",
          sunken: "#060607",
          border: "#1f1f24",
          border2: "#2a2a31",
        },
        accent: {
          DEFAULT: "#6d8bff",
        },
        ink: {
          DEFAULT: "#e8e8ec",
          muted: "#9797a3",
          faint: "#6a6a76",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Inter",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        bubble: "18px",
      },
      maxWidth: {
        composer: "42rem",
      },
    },
  },
  plugins: [],
};
