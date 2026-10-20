// Renderer bootstrap: index.html loads this module as the Electron host page.
// The package's public API lives in index.ts, this file is not part of it.
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
