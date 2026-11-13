import { createTheme, defaultVariantColorsResolver } from '@mantine/core';
import { BRAND_LIME } from '../../shared/brand';

export const theme = createTheme({
  primaryColor: 'lime',
  primaryShade: 6,
  autoContrast: true,
  colors: {
    lime: ['#f8ffe9', '#efffd0', '#e6ffaf', '#dcff8d', '#d3ff6c', '#caff50', BRAND_LIME, '#b6f52b', '#8bbd1b', '#52720f'],
    dark: ['#e8e8e8', '#b8b8b8', '#999999', '#666666', '#424242', '#303030', '#242424', '#171717', '#111111', '#080808'],
    gray: ['#fafafa', '#f5f5f5', '#eeeeee', '#dedede', '#bdbdbd', '#999999', '#737373', '#525252', '#333333', '#171717'],
  },
  variantColorResolver: input => {
    const result = defaultVariantColorsResolver(input);
    if ((input.color ?? input.theme.primaryColor) === 'lime' && ['light', 'subtle', 'outline', 'transparent'].includes(input.variant)) {
      return { ...result, ...(input.variant === 'light' ? { background: 'light-dark(#f5ffe1, #202020)', hover: 'light-dark(#eaffbe, #292929)' } : {}), color: 'var(--mantine-color-text)', hoverColor: 'var(--mantine-color-text)' };
    }
    return result;
  },
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  defaultRadius: 'md',
  headings: { fontWeight: '600' },
  components: {
    Button: { defaultProps: { radius: 'md' } },
    Card: { defaultProps: { radius: 'lg' } },
  },
});
