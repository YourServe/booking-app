/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    'bg-blue-600/80',
    'border-blue-400',
    'bg-yellow-500/80',
    'border-yellow-300',
    'bg-green-600/80',
    'border-green-400',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
