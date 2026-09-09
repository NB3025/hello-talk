import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProvider } from './store/StoreProvider';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 를 찾을 수 없습니다.');

createRoot(root).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
