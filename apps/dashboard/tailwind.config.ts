import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#182338',
        steel: '#64748b',
        sand: '#f4efe7',
        ember: '#4f46e5',
        moss: '#7a8f57',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(24, 35, 56, 0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
