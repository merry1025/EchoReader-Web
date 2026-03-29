import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',  // <-- 确保这里是 '/' 或者 './'，千万不要是 '/echoreader/'
})