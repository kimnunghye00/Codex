import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'firebase-vendor',
              test: /[\\/]node_modules[\\/](?:firebase|@firebase)[\\/]/,
              maxSize: 280_000,
              priority: 40,
            },
            {
              name: 'capacitor-vendor',
              test: /[\\/]node_modules[\\/]@capacitor[\\/]/,
              maxSize: 180_000,
              priority: 30,
            },
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: 'icons-vendor',
              test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
