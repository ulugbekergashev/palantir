import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Ishlab chiqishda panel (3100) so'rovlarni serverga (3200) uzatadi
  server: { proxy: { '/api': 'http://localhost:3200' } },
});
