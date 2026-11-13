import { createTheme, type MantineThemeOverride } from '@mantine/core';

/**
 * KeepMind OS visual theme — restrained monochrome with warm neutrals,
 * generous radius, soft layered shadows and Inter throughout.
 */
export const theme: MantineThemeOverride = createTheme({
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  primaryColor: 'dark',
  defaultRadius: 'md',
  headings: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontWeight: '650',
  },
  colors: {
    // Slightly warm monochrome scale — replaces Mantine's pure-gray 'dark'.
    // Mantine requires exactly 10 shades per color tuple.
    dark: [
      '#f7f6f3', '#eeece7', '#d9d6cf', '#b8b4aa',
      '#8f8b80', '#6e6a61', '#55524a', '#3d3b35',
      '#2a2925', '#1c1b18',
    ],
  },
  shadows: {
    xs: '0 1px 2px rgba(20, 19, 16, 0.05)',
    sm: '0 2px 8px rgba(20, 19, 16, 0.06), 0 1px 2px rgba(20, 19, 16, 0.04)',
    md: '0 6px 20px rgba(20, 19, 16, 0.08), 0 2px 6px rgba(20, 19, 16, 0.05)',
    lg: '0 16px 40px rgba(20, 19, 16, 0.12), 0 4px 12px rgba(20, 19, 16, 0.06)',
    xl: '0 24px 64px rgba(20, 19, 16, 0.16), 0 8px 20px rgba(20, 19, 16, 0.08)',
  },
  components: {
    Card: {
      defaultProps: { shadow: 'xs', radius: 'lg' },
      styles: {
        root: {
          borderColor: 'var(--mantine-color-gray-2)',
          transition: 'box-shadow 180ms cubic-bezier(0.2, 0.8, 0.2, 1), border-color 180ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        },
      },
    },
    Paper: {
      defaultProps: { radius: 'lg' },
    },
    Button: {
      defaultProps: { radius: 'md' },
      styles: {
        root: {
          fontWeight: 550,
          transition: 'transform 120ms cubic-bezier(0.34, 1.4, 0.5, 1), box-shadow 140ms ease, background-color 140ms ease',
        },
      },
    },
    Badge: {
      defaultProps: { radius: 'sm' },
    },
    Modal: {
      styles: {
        content: { boxShadow: 'var(--mantine-shadow-xl)' },
      },
    },
    Menu: {
      styles: {
        dropdown: { boxShadow: 'var(--mantine-shadow-md)' },
      },
    },
    Tooltip: {
      defaultProps: { withArrow: true },
    },
    Input: {
      styles: {
        input: {
          transition: 'border-color 140ms ease, box-shadow 140ms ease',
        },
      },
    },
  },
});
