import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'tertiary':                '#c1000a',
        'tertiary-container':      '#f9362c',
        'outline':                 '#757c81',
        'primary':                 '#5e5e5e',
        'primary-dim':             '#525252',
        'on-primary':              '#f8f8f8',
        'on-surface':              '#2d3338',
        'on-surface-variant':      '#596065',
        'surface':                 '#f9f9fb',
        'surface-container-low':   '#f2f4f6',
        'surface-container-lowest':'#ffffff',
        'surface-container-highest':'#dde3e9',
        'outline-variant':         '#acb3b8',
        'on-tertiary':             '#fff7f6',
        'inverse-surface':         '#0c0e10',
        'on-secondary-fixed':      '#3f3f3f',
        'error':                   '#9f403d',

        // Workforce console tokens (scoped under /workforce/* routes only).
        // Keep these prefixed with wf- so they never collide with the
        // article-site tokens above. Hex values mirror workforce/DESIGN.md.
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
        // Mono stack used by Typeplate / KPI readouts in the workforce console.
        wfmono:   ['JetBrains Mono', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0px',
        lg:      '0px',
        xl:      '0px',
        '2xl':   '0px',
        full:    '9999px',
        // Workforce-only rounding scale. Article site keeps 0px throughout.
        'wf-sm': '4px',
        'wf-md': '8px',
        'wf-lg': '12px',
      },
    },
  },
  plugins: [],
} satisfies Config
