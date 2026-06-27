import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Workforce console palette — "Cognitive Network". See workforce/DESIGN.md.
        // Indigo Ink primary, Sage secondary, Pale Copper accent on a Cool
        // Mist canvas. Token NAMES are stable across the reskin so the whole
        // console re-themes from this map; only the values changed.
        'wf-primary':              '#0f1b46', // Indigo Ink — authoritative anchor
        'wf-on-primary':            '#ffffff',
        'wf-secondary':            '#50634f', // Sage — balanced/organizational
        'wf-tertiary':             '#6b3b16', // Pale Copper — sparing accent (white-text safe)
        'wf-on-tertiary':          '#ffffff',
        'wf-surface':              '#f8fafb', // Cool Mist canvas
        'wf-surface-container':    '#eceeef',
        'wf-surface-container-lo': '#f2f4f5',
        'wf-surface-container-hi': '#e6e8e9',
        'wf-on-surface':           '#191c1d',
        'wf-on-surface-variant':   '#45464f',
        'wf-outline':              '#767680',
        'wf-outline-variant':      '#c6c5d0',
        'wf-running':              '#1f7a4f',
        'wf-paused':               '#b58200',
        'wf-throwing':             '#9a3b12',
        'wf-archived':             '#6b7280',
      },
      fontFamily: {
        headline: ['Geist', 'Inter', 'sans-serif'],
        body:     ['Geist', 'Inter', 'sans-serif'],
        wfmono:   ['JetBrains Mono', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        // The article system is 0px; the workforce "Cognitive Network" is a
        // Rounded language (0.5rem base, large containers up to 1.5rem). The
        // prefixed wf-* scale carries the rounding so lint:tokens (which
        // forbids bare rounded-md/lg/xl) stays green.
        DEFAULT: '0px',
        lg:      '0px',
        xl:      '0px',
        '2xl':   '0px',
        full:    '9999px',
        'wf-sm': '6px',
        'wf-md': '10px',
        'wf-lg': '16px',
        'wf-xl': '24px',
      },
    },
  },
  plugins: [],
} satisfies Config
