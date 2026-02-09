import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const base = '/iPVMS-EDU-BI/'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'html-base-url',
      transformIndexHtml(html) {
        return html.replace(/%BASE_URL%/g, base)
      },
    },
  ],
  base,
})

