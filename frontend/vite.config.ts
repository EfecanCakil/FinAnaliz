import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Geliştirme sırasında /api istekleri yerel FastAPI servisine yönlendirilir.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8765' } },
})
