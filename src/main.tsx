import './lib/legacyStorage';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { telegramLaunch } from './lib/telegramLaunch';

// Telegram'dan ochilgan bo'lsa — avval parolsiz kirish (kirish sahifasi bir lahza ham ko'rinmasin)
void telegramLaunch().finally(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
));
