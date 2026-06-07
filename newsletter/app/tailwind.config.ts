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
      },
      fontFamily: {
        headline: ['Inter', 'sans-serif'],
        body:     ['Inter', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '0px',
        lg:      '0px',
        xl:      '0px',
        '2xl':   '0px',
        full:    '9999px',
      },
    },
  },
  plugins: [],
} satisfies Config
