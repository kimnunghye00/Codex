import { CheckCircle2, LogOut, Mail, X } from 'lucide-react';
import { useState } from 'react';
import {
  EmailAuthProvider,
  linkWithCredential,
  reload,
  sendEmailVerification,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../../lib/firebase';

const messageFor = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use') return '이미 다른 계정에서 사용 중인 이메일이에요.';
  if (code === 'auth/requires-recent-login') return '보안을 위해 전화번호로 다시 로그인한 뒤 시도해 주세요.';
  if (code === 'auth/weak-password') return '비밀번호는 6자 이상으로 만들어 주세요.';
  if (code === 'auth/invalid-email') return '이메일 주소를 확인해 주세요.';
  return '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
};

export function AccountSettings({ user, onClose }: { user: User; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const hasEmail = user.providerData.some((provider) => provider.providerId === 'password');

  const linkEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) return setFeedback('비밀번호가 서로 달라요.');
    setBusy(true); setFeedback('');
    try {
      const credential = EmailAuthProvider.credential(email.trim(), password);
      const result = await linkWithCredential(user, credential);
      await sendEmailVerification(result.user);
      setFeedback('인증 메일을 보냈어요. 메일의 링크를 누르면 이메일 로그인이 활성화돼요.');
    } catch (cause) {
      setFeedback(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const refreshVerification = async () => {
    setBusy(true); setFeedback('');
    try {
      await reload(user);
      setFeedback(user.emailVerified ? '이메일 인증이 완료됐어요.' : '아직 이메일 인증이 확인되지 않았어요.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="sheet-backdrop account-backdrop" role="dialog" aria-modal="true" aria-label="계정 설정">
    <div className="account-settings">
      <header><div><small>MY ACCOUNT</small><h2>계정 설정</h2></div><button onClick={onClose} aria-label="닫기"><X /></button></header>
      <div className="account-summary"><span>전화번호</span><strong>{user.phoneNumber ?? '등록되지 않음'}</strong><CheckCircle2 size={18} /></div>
      {hasEmail ? <div className="email-status"><Mail size={18} /><div><span>로그인 이메일</span><strong>{user.email}</strong><small>{user.emailVerified ? '인증 완료' : '인증 대기 중'}</small></div>{!user.emailVerified && <button onClick={() => void refreshVerification()} disabled={busy}>인증 확인</button>}</div> : <form className="link-email-form" onSubmit={(event) => void linkEmail(event)}>
        <h3>이메일 로그인 추가</h3><p>이메일을 인증하면 이메일 로그인과 비밀번호 재설정을 사용할 수 있어요.</p>
        <label>이메일<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="hello@example.com" /></label>
        <label>새 비밀번호<input required type="password" autoComplete="new-password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6자 이상" /></label>
        <label>비밀번호 확인<input required type="password" autoComplete="new-password" minLength={6} value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="한 번 더 입력하세요" /></label>
        <button className="primary" type="submit" disabled={busy || !email.trim() || password.length < 6 || confirm.length < 6}>{busy ? '등록 중...' : '이메일 등록하고 인증받기'}</button>
      </form>}
      {feedback && <p className="account-feedback">{feedback}</p>}
      <button className="logout-button" onClick={() => void signOut(auth)}><LogOut size={17} />로그아웃</button>
    </div>
  </div>;
}
