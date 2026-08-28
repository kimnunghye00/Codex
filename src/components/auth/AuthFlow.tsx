import { ArrowLeft, LockKeyhole, Mail, Phone } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  RecaptchaVerifier,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from 'firebase/auth';
import { auth } from '../../lib/firebase';

type Mode = 'phone' | 'code' | 'email' | 'reset';

const errorMessage = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    'auth/invalid-phone-number': '휴대전화 번호를 다시 확인해 주세요.',
    'auth/operation-not-allowed': '현재 국가에서는 SMS 인증이 허용되지 않았어요. Firebase의 SMS 리전 설정을 확인해 주세요.',
    'auth/unauthorized-domain': '현재 실행 중인 주소가 Firebase에 승인되지 않았어요. 승인된 앱 주소에서 다시 시도해 주세요.',
    'auth/captcha-check-failed': '보안 확인에 실패했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    'auth/invalid-app-credential': 'SMS 보안 확인이 만료됐어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    'auth/missing-recaptcha-token': 'SMS 보안 확인을 시작하지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    'auth/billing-not-enabled': '실제 SMS를 보내려면 Firebase 결제 설정이 필요해요.',
    'auth/too-many-requests': '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    'auth/quota-exceeded': '오늘 사용할 수 있는 SMS 인증 횟수를 초과했어요.',
    'auth/invalid-verification-code': '인증번호가 올바르지 않아요.',
    'auth/code-expired': '인증번호가 만료됐어요. 다시 받아주세요.',
    'auth/invalid-email': '이메일 주소를 확인해 주세요.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않아요.',
    'auth/user-disabled': '사용이 중지된 계정이에요.',
  };
  const fallback = '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
  return messages[code] ?? (import.meta.env.DEV && code ? `${fallback} (${code})` : fallback);
};

const normalizeKoreanPhone = (value: string) => {
  const digits = value.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return `+82${digits.slice(1)}`;
  return `+82${digits}`;
};

export function Wordmark() {
  return <div className="wordmark"><strong>MELUNI.</strong><span>ME + U</span></div>;
}

export function AuthFlow() {
  const [mode, setMode] = useState<Mode>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const confirmation = useRef<ConfirmationResult | undefined>(undefined);
  const verifier = useRef<RecaptchaVerifier | undefined>(undefined);

  const resetMessages = () => { setError(''); setNotice(''); };
  const changeMode = (next: Mode) => { resetMessages(); setMode(next); };

  const sendCode = async () => {
    resetMessages();
    setBusy(true);
    try {
      verifier.current?.clear();
      verifier.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      confirmation.current = await signInWithPhoneNumber(auth, normalizeKoreanPhone(phone), verifier.current);
      setMode('code');
      setNotice('인증번호 6자리를 문자로 보냈어요.');
    } catch (cause) {
      verifier.current?.clear();
      verifier.current = undefined;
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!confirmation.current) return changeMode('phone');
    resetMessages();
    setBusy(true);
    try {
      await confirmation.current.confirm(code);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const emailLogin = async () => {
    resetMessages();
    setBusy(true);
    try {
      const result = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (!result.user.emailVerified) {
        await signOut(auth);
        setError('먼저 받은 메일에서 이메일 인증을 완료해 주세요.');
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    resetMessages();
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice('비밀번호 재설정 메일을 보냈어요. 받은편지함을 확인해 주세요.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === 'phone') void sendCode();
    if (mode === 'code') void verifyCode();
    if (mode === 'email') void emailLogin();
    if (mode === 'reset') void resetPassword();
  };

  const phoneReady = phone.replace(/\D/g, '').length >= 10 && consented;
  const title = mode === 'code' ? '인증번호를 입력해요' : mode === 'email' ? '이메일로 로그인' : mode === 'reset' ? '비밀번호를 다시 설정해요' : '전화번호로 시작해요';

  return (
    <div className="app-shell auth-shell">
      <div className="auth-hero"><Wordmark /><div className="window-mark"><span /><span /></div><h1>우리 둘의 이야기가<br />머무는 작은 공간</h1><p>대화하고, 기억하고,<br />둘만의 시간을 이어가요.</p></div>
      <form className="auth-card" onSubmit={submit}>
        {(mode === 'code' || mode === 'email' || mode === 'reset') && <button className="auth-back" type="button" onClick={() => changeMode(mode === 'reset' ? 'email' : 'phone')}><ArrowLeft size={16} /> 이전</button>}
        <p className="overline">WELCOME TO MELUNI</p><h2>{title}</h2>
        {mode === 'phone' && <>
          <label>휴대전화 번호<input required type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="01012345678" /></label>
          <label className="auth-consent"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /><span>본인 확인을 위해 전화번호가 Google Firebase로 전송·저장되는 것에 동의해요.</span></label>
          <button className="primary" type="submit" disabled={!phoneReady || busy}><Phone size={16} />{busy ? '전송 중...' : 'SMS 인증번호 받기'}</button>
          <div className="auth-divider"><span>또는</span></div>
          <button className="auth-method" type="button" onClick={() => changeMode('email')}><Mail size={17} />이메일로 로그인</button>
        </>}
        {mode === 'code' && <>
          <p className="auth-guide"><b>{phone}</b> 번호로 보낸 인증번호를 입력하세요.</p>
          <label>인증번호<input required type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="6자리 인증번호" /></label>
          <button className="primary" type="submit" disabled={code.length !== 6 || busy}>{busy ? '확인 중...' : '인증하고 시작하기'}</button>
          <button className="text-button" type="button" onClick={() => changeMode('phone')}>번호를 다시 입력할게요</button>
        </>}
        {mode === 'email' && <>
          <label>이메일<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="hello@example.com" /></label>
          <label>비밀번호<input required type="password" autoComplete="current-password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6자 이상 입력하세요" /></label>
          <button className="primary" type="submit" disabled={!email.trim() || password.length < 6 || busy}>{busy ? '로그인 중...' : '이메일로 로그인'}</button>
          <button className="text-button" type="button" onClick={() => changeMode('reset')}>비밀번호를 잊었어요</button>
        </>}
        {mode === 'reset' && <>
          <label>등록한 이메일<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="hello@example.com" /></label>
          <button className="primary" type="submit" disabled={!email.trim() || busy}>{busy ? '전송 중...' : '재설정 메일 보내기'}</button>
        </>}
        <div id="recaptcha-container" />
        {error && <p className="auth-feedback error" role="alert">{error}</p>}
        {notice && <p className="auth-feedback notice">{notice}</p>}
      </form>
      <div className="privacy"><LockKeyhole size={14} /> 인증 정보는 안전하게 암호화되어 전송돼요</div>
    </div>
  );
}
