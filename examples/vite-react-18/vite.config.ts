import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function reactInsightBridgePlugin(): Plugin {
  const tokenFile = resolve('.react-insight/bridge.token');
  const url = 'http://127.0.0.1:4081/snapshot';

  return {
    name: 'react-insight-bridge',
    transformIndexHtml() {
      let token = '';
      try {
        if (existsSync(tokenFile)) {
          token = readFileSync(tokenFile, 'utf8').trim();
        }
      } catch {
        // Token not available yet; the bridge client will simply not connect.
      }

      if (!token) return [];

      return [
        {
          tag: 'script',
          attrs: {},
          children: `window.__REACT_INSIGHT_BRIDGE__ = ${JSON.stringify({ url, token })};`,
          injectTo: 'head' as const,
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), reactInsightBridgePlugin()],
});
