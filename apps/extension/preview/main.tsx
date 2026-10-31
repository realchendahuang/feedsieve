import './mock-browser';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../entrypoints/popup/App';
import '../entrypoints/popup/popup.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
