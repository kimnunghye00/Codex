import { createRoot } from 'react-dom/client';
import { PartnerProfileCard } from './components/auth/PartnerProfileCard';

function enhanceProfileSettings() {
  const settings = document.querySelector('.profile-enabled-settings');
  const myProfile = settings?.querySelector('.settings-profile-card');
  if (!settings || !myProfile || settings.querySelector('.route-partner-profile-root')) return;

  const root = document.createElement('div');
  root.className = 'route-partner-profile-root';
  myProfile.insertAdjacentElement('afterend', root);
  createRoot(root).render(<PartnerProfileCard />);
}

enhanceProfileSettings();
const observer = new MutationObserver(enhanceProfileSettings);
observer.observe(document.documentElement, { childList: true, subtree: true });
