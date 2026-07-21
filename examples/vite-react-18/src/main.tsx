import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactInsight } from 'react-insight';
import { App } from './App';

const root = document.getElementById('root')!;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ReactInsight enabled={true}>
      <App />
    </ReactInsight>
  </React.StrictMode>
);
