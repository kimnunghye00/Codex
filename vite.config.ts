import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ROUTE keeps feature screens lazy-loaded, while Firebase is the one large
// shared dependency family used across Auth/Firestore/Storage. Pinning Firebase
// to one vendor chunk prevents a new dynamic edge from pulling the whole SDK
// back into index.js, without fragmenting Capacitor startup into many tiny files.
export default defineConfig({
  plugins: [react()],
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
