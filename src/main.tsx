import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './dialog.css';
import { applyTextSize, readTextSize } from './lib/textSize';

applyTextSize(readTextSize());
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
