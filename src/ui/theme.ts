import { Badge, Button, Card, createTheme, type CSSVariablesResolver, Paper, PasswordInput, TextInput, type MantineColorsTuple } from '@mantine/core'

// Doc tokens sit at index 6; lighter shades mix toward white, darker toward black.
const enamel: MantineColorsTuple = ['#EDF1F7', '#D7DFED', '#B3C3DD', '#8FA7CE', '#6B8ABE', '#456CAD', '#1F4E9C', '#1B4386', '#173972', '#132F5E']
const signal: MantineColorsTuple = ['#FDF7EE', '#FBECD9', '#F7DBB8', '#F4CB97', '#F0BA75', '#ECA852', '#E8962E', '#C88128', '#A96E22', '#8B5A1C']
const debt: MantineColorsTuple = ['#FAEFEE', '#F4DBD9', '#EABBB7', '#E19B96', '#D77B74', '#CC5950', '#C2372C', '#A72F26', '#8E2820', '#74211A']
const paid: MantineColorsTuple = ['#EEF6F2', '#D9EAE1', '#B7D7C7', '#96C5AD', '#74B292', '#509E76', '#2C8A5A', '#26774D', '#206542', '#1A5336']
const stone: MantineColorsTuple = ['#F3F4F5', '#E4E6E8', '#CDD0D4', '#B5BAC0', '#9DA3AB', '#848C96', '#6B7480', '#5C646E', '#4E555D', '#40464D']

export const INK = '#1B2330'
export const CARD_BORDER = 'rgba(107, 116, 128, 0.15)'
const HEADING_FONT = '"Secular One", Assistant, system-ui, sans-serif'
const touch = { minHeight: 44 }

export const theme = createTheme({
  colors: { enamel, signal, debt, paid, stone },
  primaryColor: 'enamel',
  primaryShade: 6,
  black: INK,
  autoContrast: true,
  fontFamily: 'Assistant, system-ui, sans-serif',
  fontSizes: { xs: '0.8125rem', sm: '0.875rem', md: '1rem', lg: '1.125rem', xl: '1.375rem' },
  lineHeights: { xs: '1.5', sm: '1.55', md: '1.55', lg: '1.55', xl: '1.5' },
  headings: {
    fontFamily: HEADING_FONT,
    fontWeight: '400',
    sizes: {
      h1: { fontSize: '2.25rem', lineHeight: '1.2' },
      h2: { fontSize: '1.75rem', lineHeight: '1.2' },
      h3: { fontSize: '1.375rem', lineHeight: '1.2' },
      h4: { fontSize: '1.125rem', lineHeight: '1.2' },
    },
  },
  radius: { xs: '4px', sm: '6px', md: '10px', lg: '12px', xl: '16px' },
  defaultRadius: 'md',
  focusRing: 'auto',
  components: {
    Card: Card.extend({ defaultProps: { radius: 'lg', withBorder: true, shadow: 'none', padding: 'lg' }, styles: { root: { borderColor: CARD_BORDER } } }),
    Paper: Paper.extend({ styles: { root: { borderColor: CARD_BORDER } } }),
    Button: Button.extend({ defaultProps: { radius: 'md', size: 'md' }, styles: { root: { ...touch, fontWeight: 600 } } }),
    TextInput: TextInput.extend({ defaultProps: { radius: 'md', size: 'md' }, styles: { input: touch } }),
    PasswordInput: PasswordInput.extend({ defaultProps: { radius: 'md', size: 'md' }, styles: { input: touch } }),
    Badge: Badge.extend({ defaultProps: { radius: 'sm', variant: 'light', size: 'lg' }, styles: { root: { textTransform: 'none', fontWeight: 600 } } }),
  },
})

// stone.7 for secondary text keeps it AA on plaster as well as on white.
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: { '--mantine-color-dimmed': '#5C646E', '--mantine-color-text': INK },
  dark: {},
})
