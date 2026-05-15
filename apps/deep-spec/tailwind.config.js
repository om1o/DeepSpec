/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ds: {
          bg: "#0A0A0A",
          card: "#171717",
          border: "#262626",
          primary: "#3B82F6",
          success: "#10B981",
          warning: "#F59E0B",
          danger: "#EF4444",
          text: "#F5F5F5",
          muted: "#A1A1AA",
          "bg-light": "#FAFAFA",
          "card-light": "#FFFFFF",
          "border-light": "#E5E7EB",
          "primary-light": "#2563EB",
          "warning-light": "#D97706",
          "danger-light": "#DC2626",
          "text-light": "#111827",
          "muted-light": "#6B7280",
        },
      },
    },
  },
  plugins: [],
};
