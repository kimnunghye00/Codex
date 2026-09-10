import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Keep Firebase service families independent so the login screen only pays for
// Auth. Firestore and Storage stay in their feature chunks until ROUTE actually
// needs database or media work. This is especially important on Web, where a
// single firebase-vendor chunk previously forced unrelated SDKs into startup.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'firebase-auth',
              test: /node_modules[\\/](?:@firebase[\\/]auth|firebase[\\/]auth(?:[\\/]|$))/,
              priority: 50,
            },
            {
              name: 'firebase-firestore',
              test: /node_modules[\\/](?:@firebase[\\/]firestore|firebase[\\/]firestore(?:[\\/]|$))/,
              priority: 50,
            },
            {
              name: 'firebase-storage',
              test: /node_modules[\\/](?:@firebase[\\/]storage|firebase[\\/]storage(?:[\\/]|$))/,
              priority: 50,
            },
            {
              name: 'firebase-core',
              test: /node_modules[\\/](?:@firebase[\\/](?:app|component|logger|util)|firebase[\\/]app(?:[\\/]|$))/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
