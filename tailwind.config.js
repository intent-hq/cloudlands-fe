/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        danger: 'hsl(var(--danger) / <alpha-value>)',
        'danger-background': 'hsl(var(--danger-background) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          foreground: 'hsl(var(--info-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar) / <alpha-value>)',
          foreground: 'hsl(var(--sidebar-foreground) / <alpha-value>)',
          accent: 'hsl(var(--sidebar-accent) / <alpha-value>)',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground) / <alpha-value>)',
          border: 'hsl(var(--sidebar-border) / <alpha-value>)',
        },
      },
      borderColor: {
        DEFAULT: 'hsl(var(--border) / <alpha-value>)',
      },
      borderRadius: {
        lg: 'var(--radius-large)',
        md: 'var(--radius-medium)',
        sm: 'var(--radius-small)',
        full: 'var(--radius-full)',
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-code)'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0px' },
          to: { height: 'var(--radix-accordion-content-height, auto)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height, auto)' },
          to: { height: '0px' },
        },
        'fade-in': {
          from: { opacity: 0, transform: 'scale(0.95)' },
          to: { opacity: 1, transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'subtle-fade-in': {
          from: { opacity: 0.8 },
          to: { opacity: 1 },
        },
        'bounce-dot': {
          '0%, 80%, 100%': { transform: 'translateY(0) scale(0.8)', opacity: 0.4 },
          '40%': { transform: 'translateY(-4px) scale(1)', opacity: 1 },
        },
      },
      animation: {
        'accordion-down': 'accordion-down var(--motion-slow) var(--ease-emphasized-out)',
        'accordion-up': 'accordion-up var(--motion-slow) var(--ease-emphasized-out)',
        'fade-in': 'fade-in var(--motion-fast) var(--ease-standard)',
        shimmer: 'shimmer 2s infinite',
        'subtle-fade-in': 'subtle-fade-in var(--motion-slow) var(--ease-standard)',
        'bounce-dot': 'bounce-dot 1.4s infinite ease-in-out both',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    function ({ addBase, theme }) {
      addBase({
        ':root': {
          '--tw-border-opacity': '1',
        },
        '*, ::before, ::after': {
          borderColor: theme('colors.border'),
        },
      });
    },
  ],
  corePlugins: {
    // Disable the default prose plugin to use our custom configuration
  },
};
