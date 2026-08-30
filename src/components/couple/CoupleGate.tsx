import { useEffect, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { getRealCoupleConnection, type RealCoupleConnection } from '../../lib/coupleConnection';
import { loadProfile } from '../../utils/profile';
import { CoupleConnect } from './CoupleConnect';

export function CoupleGate({ user, children }: { user: User; children: ReactNode }) {
  const profile = loadProfile(user.uid);
  const [checking, setChecking] = useState(Boolean(profile));
  const [connection, setConnection] = useState<RealCoupleConnection | null>(null);

  useEffect(() => {
    if (!profile) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    void getRealCoupleConnection(user.uid)
      .then((next) => { if (!cancelled) setConnection(next); })
      .catch(() => { if (!cancelled) setConnection(null); })
      .finally(() => { if (!cancelled) setChecking(false); });

    return () => { cancelled = true; };
  }, [profile?.completedAt, user.uid]);

  if (!profile) return <>{children}</>;
  if (checking) return <div className="app-shell couple-gate-loading"><strong>ROUTE.</strong><span>커플 연결 정보를 확인하고 있어요…</span></div>;
  if (!connection) {
    return <CoupleConnect
      user={user}
      profile={profile}
      onConnected={(next) => setConnection(next)}
    />;
  }

  return <>{children}</>;
}
