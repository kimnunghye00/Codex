import { ArrowLeft, LockKeyhole, LogIn, Phone, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  EmailAuthProvider,
  RecaptchaVerifier,
  linkWithCredential,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { auth } from '../../lib/firebase';

type Mode = 'login' | 'signup-phone' | 'signup-code' | 'signup-password';

type FirebaseLikeError = { code?: string; message?: string };

const normalizeKoreanPhone = (value: string) => {
  const digits = value.trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return `+82${digits.slice(1)}`;
  return `+82${digits}`;
};

const phoneLoginEmail = (phone: string) => {
  const normalized = normalizeKoreanPhone(phone).replace(/\D/g, '');
  return `phone-${normalized}@login.meluni.app`;
};

const messageFor = (error: unknown) => {
  const firebaseError = (typeof error === 'object' && error ? error : {}) as FirebaseLikeError;
  const code = String(firebaseError.code ?? '');
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const messages: Record<string, string> = {
    'auth/invalid-phone-number': '휴대폰 번호를 다시 확인해 주세요.',
    'auth/operation-not-allowed': 'Firebase에서 전화번호 로그인이 활성화되어 있는지 확인해 주세요.',
    'auth/unauthorized-domain': `현재 주소(${host})가 Firebase 승인 도메인에 등록되지 않았어요.`,
    'auth/captcha-check-failed': '보안 확인에 실패했어요. 다시 시도해 주세요.',
    'auth/invalid-app-credential': '보안 확인 정보가 만료됐어요. 다시 시도해 주세요.',
    'auth/missing-recaptcha-token': '보안 확인을 시작하지 못했어요. 다시 시도해 주세요.',
    'auth/network-request-failed': '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
    'auth/too-many-requests': '인증 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    'auth/quota-exceeded': 'SMS 인증 한도를 초과했어요.',
    'auth/invalid-verification-code': '인증번호가 올바르지 않아요.',
    'auth/code-expired': '인증번호가 만료됐어요. 다시 받아주세요.',
    'auth/weak-password': '비밀번호는 6자 이상으로 설정해 주세요.',
    'auth/email-already-in-use': '이미 가입된 휴대폰 번호예요. 로그인해 주세요.',
    'auth/credential-already-in-use': '이미 가입된 휴대폰 번호예요. 로그인해 주세요.',
    'auth/invalid-credential': '아이디 또는 비밀번호가 올바르지 않아요.',
    'auth/user-not-found': '가입된 계정을 찾을 수 없어요.',
    'auth/wrong-password': '비밀번호가 올바르지 않아요.',
    'auth/invalid-email': '이메일 주소를 확인해 주세요.',
  };
  return messages[code] ?? (import.meta.env.DEV && code ? `처리 중 문제가 생겼어요. (${code})` : '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
};

export function Wordmark() {
  return <div className="wordmark"><strong>MELUNI.</strong><span>ME + U</span></div>;
}

export function AuthFlow() {
  const [mode, setMode] = useState<Mode>('login');
  const [identifier, setIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const confirmation = useRef<ConfirmationResult>();
  const verifier = useRef<RecaptchaVerifier>();
  const verifiedPhoneUser = useRef<Awaited<ReturnType<ConfirmationResult['confirm']>>['user']>();

  const clearMessages = () => { setError(''); setNotice(''); };
  const changeMode = (next: Mode) => { clearMessages(); setMode(next); };

  const destroyVerifier = () => {
    try { verifier.current?.clear(); } catch { /* already cleared */ }
    verifier.current = undefined;
    document.getElementById('recaptcha-container')?.replaceChildren();
  };

  const createVerifier = async () => {
    destroyVerifier();
    const next = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    verifier.current = next;
    await next.render();
    return next;
  };

  useEffect(() => () => destroyVerifier(), []);

  const login = async () => {
    clearMessages();
    setBusy(true);
    try {
      const trimmed = identifier.trim();
      const email = trimmed.includes('@') ? trimmed : phoneLoginEmail(trimmed);
      await signInWithEmailAndPassword(auth, email, loginPassword);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const sendSignupCode = async () => {
    clearMessages();
    setBusy(true);
    try {
      const nextVerifier = await createVerifier();
      confirmation.current = await signInWithPhoneNumber(auth, normalizeKoreanPhone(phone), nextVerifier);
      changeMode('signup-code');
      setNotice('인증번호 6자리를 문자로 보냈어요.');
    } catch (cause) {
      console.error('[MELUNI signup SMS]', cause);
      destroyVerifier();
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const verifySignupCode = async () => {
    if (!confirmation.current) return changeMode('signup-phone');
    clearMessages();
    setBusy(true);
    try {
      const result = await confirmation.current.confirm(code);
      verifiedPhoneUser.current = result.user;
      changeMode('signup-password');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const finishSignup = async () => {
    if (!verifiedPhoneUser.current) return changeMode('signup-phone');
    clearMessages();
    if (password.length < 6) return setError('비밀번호는 6자 이상으로 설정해 주세요.');
    if (password !== passwordConfirm) return setError('비밀번호가 서로 달라요.');
    setBusy(true);
    try {
      const credential = EmailAuthProvider.credential(phoneLoginEmail(phone), password);
      await linkWithCredential(verifiedPhoneUser.current, credential);
      // 현재 사용자는 이미 전화번호 인증으로 로그인되어 있으므로 App이 프로필 설정 화면으로 이동한다.
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === 'login') void login();
    if (mode === 'signup-phone') void sendSignupCode();
    if (mode === 'signup-code') void verifySignupCode();
    if (mode === 'signup-password') void finishSignup();
  };

  const loginReady = identifier.trim().length >= 5 && loginPassword.length >= 6;
  const signupPhoneReady = phone.replace(/\D/g, '').length >= 10 && consented;

  return <div className="app-shell auth-shell auth-v2">
    <div className="auth-hero">
      <Wordmark />
      <div className="window-mark"><span /><span /></div>
      <h1>{mode === 'login' ? '다시 만나서 반가워요' : '우리의 공간을 시작해요'}</h1>
      <p>{mode === 'login' ? '휴대폰 번호 또는 이메일로 로그인하세요.' : '휴대폰 본인 인증 후 계정을 만들 수 있어요.'}</p>
    </div>

    <form className="auth-card" onSubmit={submit}>
      {mode !== 'login' && <button className="auth-back" type="button" onClick={() => changeMode(mode === 'signup-phone' ? 'login' : mode === 'signup-code' ? 'signup-phone' : 'signup-code')}><ArrowLeft size={16} /> 이전</button>}

      {mode === 'login' && <>
        <p className="overline">WELCOME BACK</p>
        <h2>로그인</h2>
        <label>휴대폰 번호 또는 이메일<input required autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="01012345678 또는 hello@example.com" /></label>
        <label>비밀번호<input required type="password" autoComplete="current-password" minLength={6} value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="비밀번호를 입력하세요" /></label>
        <button className="primary" type="submit" disabled={!loginReady || busy}><LogIn size={17} />{busy ? '로그인 중...' : '로그인'}</button>
        <div className="auth-divider"><span>아직 계정이 없나요?</span></div>
        <button className="signup-button" type="button" onClick={() => changeMode('signup-phone')}><UserPlus size={17} />회원가입</button>
      </>}

      {mode === 'signup-phone' && <>
        <p className="overline">SIGN UP · 1/3</p>
        <h2>휴대폰 번호를 인증해요</h2>
        <p className="auth-guide">가입할 휴대폰 번호로 인증 문자를 보내드려요.</p>
        <label>휴대폰 번호<input required type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" /></label>
        <label className="auth-consent"><input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} /><span>본인 확인을 위해 전화번호가 Google Firebase로 전송·저장되는 것에 동의해요.</span></label>
        <button className="primary" type="submit" disabled={!signupPhoneReady || busy}><Phone size={17} />{busy ? '전송 중...' : '인증번호 받기'}</button>
      </>}

      {mode === 'signup-code' && <>
        <p className="overline">SIGN UP · 2/3</p>
        <h2>인증번호를 입력해요</h2>
        <p className="auth-guide"><b>{phone}</b> 번호로 받은 6자리 인증번호를 입력하세요.</p>
        <label>인증번호<input autoFocus required type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="6자리 인증번호" /></label>
        <button className="primary" type="submit" disabled={code.length !== 6 || busy}>{busy ? '확인 중...' : '인증번호 확인'}</button>
      </>}

      {mode === 'signup-password' && <>
        <p className="overline">SIGN UP · 3/3</p>
        <h2>로그인 비밀번호를 만들어요</h2>
        <p className="auth-guide">다음부터는 휴대폰 번호와 이 비밀번호로 바로 로그인할 수 있어요.</p>
        <label>비밀번호<input autoFocus required type="password" autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6자 이상 입력하세요" /></label>
        <label>비밀번호 확인<input required type="password" autoComplete="new-password" minLength={6} value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} placeholder="비밀번호를 한 번 더 입력하세요" /></label>
        <button className="primary" type="submit" disabled={password.length < 6 || passwordConfirm.length < 6 || busy}>{busy ? '계정 만드는 중...' : '가입 완료하고 프로필 설정'}</button>
      </>}

      <div id="recaptcha-container" />
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      {notice && <p className="auth-feedback notice">{notice}</p>}
    </form>

    <div className="privacy"><LockKeyhole size={14} /> 로그인 정보는 안전하게 암호화되어 전송돼요</div>
  </div>;
}
