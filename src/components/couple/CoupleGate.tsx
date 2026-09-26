import { useEffect, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { getRealCoupleConnection, type RealCoupleConnection } from '../../lib/coupleConnection';
import { loadProfile } from '../../utils/profile';
import { CoupleConnect } from './CoupleConnect';

export function CoupleGate({ user, children }: { user: User; children: ReactNode }) {
  const profile = loadProfile(user.uid);
  if (!profile) return <>{children}</>;
  return <ConnectedCoupleGate key={`${user.uid}:${profile.completedAt}`} user={user} profile={profile}>{children}</ConnectedCoupleGate>;
}

function ConnectedCoupleGate({ user, profile, children }: { user: User; profile: NonNullable<ReturnType<typeof loadProfile>>; children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [connection, setConnection] = useState<RealCoupleConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getRealCoupleConnection(user.uid)
      .then((next) => { if (!cancelled) setConnection(next); })
      .catch(() => { if (!cancelled) setConnection(null); })
      .finally(() => { if (!cancelled) setChecking(false); });

    return () => { cancelled = true; };
  }, [user.uid]);

  if (checking) return <div className="app-shell couple-gate-loading"><strong>단둘이</strong><span>커플 연결 정보를 확인하고 있어요…</span></div>;
  if (!connection) {
    return <CoupleConnect
      user={user}
      profile={profile}
      onConnected={(next) => setConnection(next)}
    />;
  }

  return <>{children}</>;
}
