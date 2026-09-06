import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Keep the production entry graph deliberately simple for Capacitor WebView.
// Feature screens are already lazy-loaded in React, so forcing Firebase/React
// into many extra startup chunks only increases the number of files that must
// all load successfully before ROUTE can paint its first screen.
export default defineConfig({
  plugins: [react()],
});
