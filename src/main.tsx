import '@mantine/core/styles.css'
import './ui/fonts'
import './ui/global.css'
import { DirectionProvider, MantineProvider } from '@mantine/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import App from './App'
import { cssVariablesResolver, theme } from './ui/theme'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <DirectionProvider initialDirection="rtl">
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver}>
        <HashRouter>
          <App />
        </HashRouter>
      </MantineProvider>
    </DirectionProvider>
  </StrictMode>,
)
