/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        niwot: {
          bg: "#0b0714",
          panel: "#140b26",
          purple: "#7a3cff",
          accent: "#b388ff"
        }
      }
    }
  },
  plugins: []
};
