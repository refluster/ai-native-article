import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Workforce console palette. See workforce/DESIGN.md.
        'wf-primary':              '#0055c8',
        'wf-on-primary':            '#ffffff',
        'wf-secondary':            '#2a3036',
        'wf-tertiary':             '#954500',
        'wf-on-tertiary':          '#fff5ec',
        'wf-surface':              '#faf9ff',
        'wf-surface-container':    '#f1eef8',
        'wf-surface-container-lo': '#f6f4fb',
        'wf-surface-container-hi': '#e7e2f0',
        'wf-on-surface':           '#0b0b14',
        'wf-on-surface-variant':   '#4f4d57',
        'wf-outline':              '#c8c4d4',
        'wf-outline-variant':      '#ddd9e6',
        'wf-running':              '#1f7a4f',
        'wf-paused':               '#b58200',
        'wf-throwing':             '#954500',
        'wf-archived':             '#6b7280',
      },
      fontFamily: {
        headline: ['Inter', 'sans-serif'],
        body:     ['Inter', 'sans-serif'],
        wfmono:   ['JetBrains Mono', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0px',
        lg:      '0px',
        xl:      '0px',
        '2xl':   '0px',
        full:    '9999px',
        'wf-sm': '4px',
        'wf-md': '8px',
        'wf-lg': '12px',
      },
    },
  },
  plugins: [],
} satisfies Config
