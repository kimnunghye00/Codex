import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';
import './styles.css';
import './auth-onboarding.css';
import './nickname.css';
import './ai-test.css';
import './chat-typing.css';
import './notifications.css';
import './location.css';
import './home-simple.css';
import './home-dashboard.css';
import './more.css';
import './route-brand.css';

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
