import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './ui/fonts'
import './ui/global.css'
import { DirectionProvider, MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import App from './App'
import { AppNotifications } from './ui/AppNotifications'
import { cssVariablesResolver, theme } from './ui/theme'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <DirectionProvider initialDirection="rtl">
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver}>
        <AppNotifications />
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <App />
          </HashRouter>
        </QueryClientProvider>
      </MantineProvider>
    </DirectionProvider>
  </StrictMode>,
)
