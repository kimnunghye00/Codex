import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';
import './styles.css';
import './auth-onboarding.css';
import './nickname.css';
import './ai-test.css';
import './chat-typing.css';

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
