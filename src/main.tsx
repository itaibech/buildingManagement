import '@mantine/core/styles.css'
import { DirectionProvider, MantineProvider } from '@mantine/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <DirectionProvider initialDirection="rtl">
      <MantineProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </MantineProvider>
    </DirectionProvider>
  </StrictMode>,
)
