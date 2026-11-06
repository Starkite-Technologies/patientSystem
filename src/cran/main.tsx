import React from 'react';
import ReactDOM from 'react-dom/client';
import { CranApp } from './CranApp';

// CRAN Tech Challenge demo entry (selected by vite.config.ts when VITE_CRAN_DEMO=true).
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><CranApp /></React.StrictMode>);
