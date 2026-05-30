/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Grok.com-native palette (calm, minimalist, high-contrast)
        bg: '#0a0a0a',
        surface: '#171717',
        'surface-hover': '#1f1f1f',
        border: '#262626',
        'text-secondary': '#a1a1aa',
        'text-tertiary': '#71717a',
        accent: '#3b82f6',
        'accent-hover': '#2563eb',
      },
      fontFamily: {
        sans: ['Geist Variable', 'Geist', 'Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
