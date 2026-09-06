import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreServices, applySavedRouteAppIcon } from './components/more/MoreServices';
import { PartnerProfileCard } from './components/auth/PartnerProfileCard';

type Hosts = {
  more: HTMLElement | null;
  partner: HTMLElement | null;
};

function createMoreHost(scroll: HTMLElement) {
  let host = scroll.querySelector<HTMLElement>(':scope > .route-more-root');
  if (host) return host;

  scroll.replaceChildren();
  host = document.createElement('div');
  host.className = 'route-more-root';
  scroll.appendChild(host);
  return host;
}

function createPartnerHost(settings: HTMLElement) {
  let host = settings.querySelector<HTMLElement>('.route-partner-profile-root');
  if (host) return host;

  const myProfile = settings.querySelector<HTMLElement>('.settings-profile-card');
  if (!myProfile) return null;

  host = document.createElement('div');
  host.className = 'route-partner-profile-root';
  myProfile.insertAdjacentElement('afterend', host);
  return host;
}

export function RouteEnhancementLayer() {
  const [hosts, setHosts] = useState<Hosts>({ more: null, partner: null });

  useEffect(() => {
    applySavedRouteAppIcon();

    let frame = 0;
    const scan = () => {
      frame = 0;

      const moreScroll = document.querySelector<HTMLElement>('.more-page .more-scroll');
      const settings = document.querySelector<HTMLElement>('.profile-enabled-settings');
      const more = moreScroll ? createMoreHost(moreScroll) : null;
      const partner = settings ? createPartnerHost(settings) : null;

      setHosts((current) => current.more === more && current.partner === partner
        ? current
        : { more, partner });
    };

    const scheduleScan = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(scan);
    };

    const handleClick = () => scheduleScan();
    const handleBack = () => scheduleScan();

    document.addEventListener('click', handleClick, true);
    window.addEventListener('route-native-back', handleBack);
    scheduleScan();

    return () => {
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('route-native-back', handleBack);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <>
    {hosts.more?.isConnected ? createPortal(<MoreServices />, hosts.more) : null}
    {hosts.partner?.isConnected ? createPortal(<PartnerProfileCard />, hosts.partner) : null}
  </>;
}
