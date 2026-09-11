// Bundled so the app has real typography offline: a grotesque for the instrument chrome and a
// serif for the narration surface, which is the visible half of the two-materials idea.
import '@fontsource-variable/geist'
import '@fontsource-variable/newsreader'
import './styles/index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
