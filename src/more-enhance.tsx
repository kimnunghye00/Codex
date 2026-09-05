import './appearance-stability';
import { createRoot } from 'react-dom/client';
import { MoreServices, applySavedRouteAppIcon } from './components/more/MoreServices';

applySavedRouteAppIcon();

function enhanceMorePage() {
  const scroll = document.querySelector('.more-page .more-scroll');
  if (!scroll || scroll.querySelector(':scope > .route-more-root')) return;
  scroll.replaceChildren();
  const root = document.createElement('div');
  root.className = 'route-more-root';
  scroll.appendChild(root);
  createRoot(root).render(<MoreServices />);
}

enhanceMorePage();
const observer = new MutationObserver(() => enhanceMorePage());
observer.observe(document.documentElement, { childList: true, subtree: true });
