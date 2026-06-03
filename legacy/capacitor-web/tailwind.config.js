/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          teal: '#7DD3C0',
          gold: '#D4AF37',
          blue: '#9BB5FF',
        },
        dark: {
          primary: '#0B0E14',
          secondary: '#1C1F2E',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      animation: {
        'bounce': 'bounce 3s infinite',
        'pulse': 'pulse 2.5s infinite',
      }
    },
  },
  plugins: [],
}

