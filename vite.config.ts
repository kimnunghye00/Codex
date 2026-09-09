import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// ROUTE keeps feature screens lazy-loaded, while Firebase is the one large
// shared dependency family used across Auth/Firestore/Storage. Tailwind runs as
// a Vite plugin so Web and Capacitor builds compile the exact same utility
// classes instead of maintaining separate platform-specific layout styles.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'firebase-vendor',
              test: /node_modules[\\/](?:@firebase|firebase)[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
