import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { SITE_BASE_PATH } from './src/config/site'

export default defineConfig({
  plugins: [react()],
  base: SITE_BASE_PATH,
})
