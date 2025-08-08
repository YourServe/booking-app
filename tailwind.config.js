// tailwind.config.js
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./*.{js,jsx,ts,tsx}",      // also scan any root-level React files
    "./public/index.html",      // if you have static HTML here
  ],
  theme: { extend: {} },
  plugins: [],
}
