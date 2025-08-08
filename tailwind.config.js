// tailwind.config.js
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",   // if you use src/
    "./*.{js,jsx,ts,tsx}",           // also scan any root-level .js/.jsx
    "./public/index.html",           // if you have static html here
  ],
  theme: { extend: {} },
  plugins: [],
}
