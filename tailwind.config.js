/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#1a1a1f',
        'panel-2': '#22232a',
        'panel-3': '#2a2b34',
        accent: '#7c5cff',
        'accent-2': '#4ec9ff',
        border: '#2f3038',
      },
    },
  },
  plugins: [],
};
