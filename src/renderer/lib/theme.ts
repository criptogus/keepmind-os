import { createTheme } from '@mantine/core';

// Selective adaptation of PR #10: restrained typography and surfaces. Semantic
// Mantine tokens keep text, borders and focus consistent in both color schemes.
export const theme = createTheme({
  primaryColor: 'dark',
  autoContrast: true,
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  defaultRadius: 'md',
  headings: { fontWeight: '600' },
  components: {
    Button: { defaultProps: { radius: 'md' } },
    Card: { defaultProps: { radius: 'lg' } },
  },
});
