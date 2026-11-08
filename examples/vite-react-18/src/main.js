import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactInsight } from 'react-insight';
import { startBridgeClient } from '@react-insight/mcp/browser-client';
import { App } from './App';
const root = document.getElementById('root');
ReactDOM.createRoot(root).render(_jsx(React.StrictMode, { children: _jsx(ReactInsight, { enabled: true, children: _jsx(App, {}) }) }));
const bridgeConfig = window.__REACT_INSIGHT_BRIDGE__;
if (bridgeConfig?.url && bridgeConfig?.token) {
    startBridgeClient({ url: bridgeConfig.url, token: bridgeConfig.token });
}
