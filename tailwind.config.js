/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        shell: "#f5f5f7",
        card: "rgba(255,255,255,0.82)",
        line: "rgba(15,23,42,0.08)",
        ink: "#101828",
        muted: "#667085",
        accent: "#0071e3",
      },
      boxShadow: {
        shell: "0 24px 80px rgba(15, 23, 42, 0.10)",
        panel: "0 18px 44px rgba(15, 23, 42, 0.08)",
      },
      borderRadius: {
        shell: "28px",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
