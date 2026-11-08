import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactInsight } from 'react-insight';
import { startBridgeClient } from '@react-insight/mcp/browser-client';
import { App } from './App';

const root = document.getElementById('root')!;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ReactInsight enabled={true}>
      <App />
    </ReactInsight>
  </React.StrictMode>
);

const bridgeConfig = (window as any).__REACT_INSIGHT_BRIDGE__;
if (bridgeConfig?.url && bridgeConfig?.token) {
  startBridgeClient({ url: bridgeConfig.url, token: bridgeConfig.token });
}
