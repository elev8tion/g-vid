import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true, // Fail if 5175 is taken instead of silently picking another
    host: true,       // Expose on network (optional but useful for testing on other devices)
  },
  preview: {
    port: 4175,
    strictPort: true,
  },
})
