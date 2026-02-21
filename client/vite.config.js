import { defineConfig } from 'vite';

export default defineConfig({
  // Tell Vite where the frontend source code lives
  root: 'src/client',
  
  // Tell Vite to build the project into a 'dist' folder at the root
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  
  // Optional: Server settings (e.g., if you want to use a specific port)
  server: {
    port: 3000,
    open: true // Opens browser automatically
  }
});