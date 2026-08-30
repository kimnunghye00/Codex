import { Check, Copy, HeartHandshake, Link2, RefreshCw, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { UserProfile } from '../../utils/profile';
import {
  connectWithInviteCode,
  createCoupleInvite,
  getRealCoupleConnection,
  type RealCoupleConnection,
} from '../../lib/coupleConnection';

type CoupleConnectProps = {
  user: User;
  profile: UserProfile;
  onConnected: (connection: RealCoupleConnection) => void;
};

function messageFor(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    'already-connected': '이미 다른 계정과 연결되어 있어요.',
    'owner-already-connected': '초대 코드를 만든 계정이 이미 다른 계정과 연결되어 있어요.',
    'invalid-code': '초대 코드 형식을 다시 확인해 주세요.',
    'invite-not-found': '존재하지 않는 초대 코드예요.',
    'invite-used': '이미 사용된 초대 코드예요.',
    'invite-expired': '초대 코드가 만료됐어요. 새 코드를 만들어 주세요.',
    'self-invite': '내가 만든 초대 코드는 내 계정에서 사용할 수 없어요.',
  };
  return messages[code] ?? '연결 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}

export function CoupleConnect({ user, profile, onConnected }: CoupleConnectProps) {
  const [mode, setMode] = useState<'choose' | 'invite' | 'join'>('choose');
  const [inviteCode, setInviteCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => {
      void getRealCoupleConnection(user.uid).then((connection) => {
        if (connection) onConnected(connection);
      }).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [onConnected, user.uid]);

  const makeInvite = async () => {
    setBusy(true);
    setError('');
    try {
      const invite = await createCoupleInvite(user.uid, profile.name);
      setInviteCode(invite.code);
      setMode('invite');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!inviteCode) return;
    await navigator.clipboard?.writeText(inviteCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const shareCode = async () => {
    if (!inviteCode) return;
    const text = `ROUTE에서 나와 연결해요. 초대 코드: ${inviteCode}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'ROUTE 커플 초대', text }); return; } catch { /* cancelled */ }
    }
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const join = async () => {
    setBusy(true);
    setError('');
    try {
      await connectWithInviteCode(user.uid, profile.name, joinCode);
      const connection = await getRealCoupleConnection(user.uid);
      if (!connection) throw new Error('connection-refresh-failed');
      onConnected(connection);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  return <div className="app-shell couple-connect-shell">
    <header className="couple-connect-brand"><strong>ROUTE.</strong><small>COUPLE CONNECT</small></header>

    <main className="couple-connect-card">
      <div className="couple-connect-symbol"><HeartHandshake size={30} /></div>
      <p className="overline">TOGETHER ON ROUTE</p>
      <h1>{mode === 'choose' ? '상대방과 연결할까요?' : mode === 'invite' ? '상대방을 초대해요' : '초대 코드를 입력해요'}</h1>
      <p className="couple-connect-copy">
        {mode === 'choose' && '두 계정을 연결하면 채팅, 추억, 기념일과 위치 기록을 둘만의 공간에서 함께 사용할 수 있어요.'}
        {mode === 'invite' && '상대방이 ROUTE에 가입한 뒤 아래 코드를 입력하면 두 계정이 연결돼요.'}
        {mode === 'join' && '상대방에게 받은 ROUTE 초대 코드를 입력해 주세요.'}
      </p>

      {mode === 'choose' && <div className="couple-connect-options">
        <button type="button" className="couple-connect-option primary-option" onClick={makeInvite} disabled={busy}>
          <span><Share2 size={20} /></span><div><strong>상대방 초대하기</strong><small>내 초대 코드를 만들어 공유해요</small></div>
        </button>
        <button type="button" className="couple-connect-option" onClick={() => { setError(''); setMode('join'); }}>
          <span><Link2 size={20} /></span><div><strong>초대 코드 입력</strong><small>상대방이 만든 코드로 연결해요</small></div>
        </button>
      </div>}

      {mode === 'invite' && <>
        <div className="couple-invite-code"><small>나의 초대 코드</small><strong>{inviteCode}</strong><em>7일 동안 사용할 수 있어요</em></div>
        <div className="couple-code-actions">
          <button type="button" onClick={copyCode}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? '복사됨' : '코드 복사'}</button>
          <button type="button" onClick={shareCode}><Share2 size={17} />공유하기</button>
        </div>
        <p className="couple-waiting"><RefreshCw size={14} /> 상대방이 연결하면 이 화면이 자동으로 넘어가요.</p>
      </>}

      {mode === 'join' && <>
        <label className="couple-code-input">초대 코드
          <input autoFocus value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ROUTE-XXXXXX" maxLength={12} autoCapitalize="characters" />
        </label>
        <button className="couple-connect-submit" type="button" disabled={busy || joinCode.trim().length < 10} onClick={join}>{busy ? '연결 중...' : '상대방과 연결하기'}</button>
      </>}

      {error && <p className="couple-connect-error" role="alert">{error}</p>}

      {mode !== 'choose' && <div className="couple-connect-footer">
        <button type="button" onClick={() => { setError(''); setMode('choose'); }}>이전</button>
      </div>}
    </main>
  </div>;
}
