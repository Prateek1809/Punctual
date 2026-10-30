/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        'soft-bg': 'var(--soft-bg)',
        'soft-shadow': 'var(--soft-shadow)',
        'soft-light': 'var(--soft-light)',
        'soft-blue': 'var(--soft-blue)',
        'soft-green': 'var(--soft-green)',
        'soft-orange': 'var(--soft-orange)',
        'soft-text': 'var(--soft-text)',
        'soft-muted': 'var(--soft-muted)',
        'soft-green-text': 'var(--soft-green-text)',
        'soft-orange-text': 'var(--soft-orange-text)',
      },
      boxShadow: {
        'soft-surface': '-6px -6px 15px var(--soft-light), 6px 6px 15px var(--soft-shadow)',
        'soft-surface-sm': '-3px -3px 8px var(--soft-light), 3px 3px 8px var(--soft-shadow)',
        'soft-surface-lg': '-8px -8px 20px var(--soft-light), 8px 8px 20px var(--soft-shadow)',
        'soft-well': 'inset 4px 4px 10px var(--soft-shadow), inset -4px -4px 10px var(--soft-light)',
        'soft-well-sm': 'inset 2px 2px 6px var(--soft-shadow), inset -2px -2px 6px var(--soft-light)',
        'soft-btn': '-4px -4px 10px var(--soft-light), 4px 4px 10px var(--soft-shadow)',
        'soft-btn-hover': '-6px -6px 14px var(--soft-light), 6px 6px 14px var(--soft-shadow)',
        'soft-btn-active': 'inset 3px 3px 8px var(--soft-shadow), inset -3px -3px 8px var(--soft-light)',
      },
      borderRadius: {
        'soft': 'var(--soft-radius)',
      },
      transitionDuration: {
        'soft': '250ms',
      }
    },
  },
  plugins: [],
}