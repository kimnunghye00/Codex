import { ArrowLeft, KeyRound, LockKeyhole, LogIn, Phone, ShieldCheck, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  deleteUser,
  EmailAuthProvider,
  RecaptchaVerifier,
  linkWithCredential,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
  updatePassword,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { auth } from '../../lib/firebase';

type Mode =
  | 'login'
  | 'signup-phone'
  | 'signup-code'
  | 'signup-password'
  | 'reset-phone'
  | 'reset-code';
type FirebaseLikeError = { code?: string; message?: string };

export const SIGNUP_PENDING_KEY = 'meluni-signup-pending';
const RECOVERY_NOTICE_KEY = 'route-auth-recovery-notice';

const normalizeKoreanPhone = (value: string) => {
  const digits = value.trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return `+82${digits.slice(1)}`;
  return `+82${digits}`;
};

// Firebase Auth does not provide a phone-number + password credential.
// ROUTE keeps this generated address strictly as an internal credential key so
// users can sign in with their verified phone number and password. It is never
// accepted from the UI, displayed to users, or used as a contact email.
const phoneLoginEmail = (phone: string) => {
  const normalized = normalizeKoreanPhone(phone).replace(/\D/g, '');
  return `phone-${normalized}@login.meluni.app`;
};

const takeRecoveryNotice = () => {
  try {
    const value = sessionStorage.getItem(RECOVERY_NOTICE_KEY) ?? '';
    if (value) sessionStorage.removeItem(RECOVERY_NOTICE_KEY);
    return value;
  } catch {
    return '';
  }
};

const messageFor = (error: unknown) => {
  const firebaseError = (typeof error === 'object' && error ? error : {}) as FirebaseLikeError;
  const code = String(firebaseError.code ?? '');
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const messages: Record<string, string> = {
    'auth/invalid-phone-number': '휴대폰 번호를 다시 확인해 주세요.',
    'auth/operation-not-allowed': 'Firebase에서 전화번호 로그인이 활성화되어 있는지 확인해 주세요.',
    'auth/unauthorized-domain': `현재 주소(${host})가 Firebase 승인 도메인에 등록되지 않았어요.`,
    'auth/captcha-check-failed': '보안 확인에 실패했어요. 화면의 reCAPTCHA를 다시 완료해 주세요.',
    'auth/invalid-app-credential': '보안 확인 정보가 만료됐어요. reCAPTCHA를 다시 완료해 주세요.',
    'auth/missing-recaptcha-token': '보안 확인을 시작하지 못했어요. reCAPTCHA를 완료한 뒤 다시 시도해 주세요.',
    'auth/network-request-failed': '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
    'auth/too-many-requests': '인증 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    'auth/quota-exceeded': 'SMS 인증 한도를 초과했어요.',
    'auth/invalid-verification-code': '인증번호가 올바르지 않아요.',
    'auth/invalid-verification-id': '인증 정보가 만료됐어요. 인증번호를 다시 받아주세요.',
    'auth/code-expired': '인증번호가 만료됐어요. 다시 받아주세요.',
    'auth/session-expired': '인증 시간이 만료됐어요. 인증번호를 다시 받아주세요.',
    'auth/weak-password': '비밀번호는 6자 이상으로 설정해 주세요.',
    'auth/email-already-in-use': '이미 가입된 휴대폰 번호예요.',
    'auth/credential-already-in-use': '이미 가입된 휴대폰 번호예요.',
    'auth/invalid-credential': '휴대폰 번호 또는 비밀번호가 올바르지 않아요.',
    'auth/user-not-found': '가입된 계정을 찾을 수 없어요.',
    'auth/user-disabled': '사용이 중지된 계정이에요.',
    'auth/wrong-password': '비밀번호가 올바르지 않아요.',
    'auth/invalid-email': '휴대폰 번호를 다시 확인해 주세요.',
    'auth/requires-recent-login': '보안을 위해 휴대폰 인증을 다시 진행해 주세요.',
  };
  if (messages[code]) return `${messages[code]}${import.meta.env.DEV && code ? ` (${code})` : ''}`;
  if (code) return `처리 중 문제가 생겼어요. (${code})`;
  const rawMessage = String(firebaseError.message ?? '').trim();
  return rawMessage ? `처리 중 문제가 생겼어요. (${rawMessage})` : '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
};

export function Wordmark() {
  return <div className="wordmark"><strong>ROUTE.</strong></div>;
}

export function AuthFlow() {
  const signupPending = localStorage.getItem(SIGNUP_PENDING_KEY) === '1';
  const pendingPhoneUser = signupPending && auth.currentUser?.phoneNumber ? auth.currentUser : undefined;
  const [mode, setMode] = useState<Mode>(pendingPhoneUser ? 'signup-password' : 'login');
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [phone, setPhone] = useState(pendingPhoneUser?.phoneNumber ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [consented, setConsented] = useState(false);
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState('');
  const [recoveryConsented, setRecoveryConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(() => takeRecoveryNotice());
  const confirmation = useRef<ConfirmationResult | undefined>(undefined);
  const verifier = useRef<RecaptchaVerifier | undefined>(undefined);
  const verifiedPhoneUser = useRef<User | undefined>(pendingPhoneUser);

  const clearMessages = () => { setError(''); setNotice(''); };
  const changeMode = (next: Mode) => {
    clearMessages();
    if (next === 'login') {
      localStorage.removeItem(SIGNUP_PENDING_KEY);
      setRecoveryCode('');
    }
    setMode(next);
  };

  const destroyVerifier = () => {
    try { verifier.current?.clear(); } catch { /* already cleared */ }
    verifier.current = undefined;
    document.getElementById('recaptcha-container')?.replaceChildren();
  };

  const createVerifier = async () => {
    destroyVerifier();
    const next = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'normal',
      theme: 'light',
    });
    verifier.current = next;
    await next.render();
    return next;
  };

  useEffect(() => () => destroyVerifier(), []);

  const login = async () => {
    clearMessages();
    if (loginPhone.replace(/\D/g, '').length < 10) {
      setError('휴대폰 번호를 다시 확인해 주세요.');
      return;
    }
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, phoneLoginEmail(loginPhone), loginPassword);
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
      setNotice('아래 보안 확인을 완료하면 인증번호가 전송돼요.');
      confirmation.current = await signInWithPhoneNumber(auth, normalizeKoreanPhone(phone), nextVerifier);
      changeMode('signup-code');
      setNotice('인증번호 6자리를 문자로 보냈어요.');
    } catch (cause) {
      console.error('[ROUTE signup SMS]', cause);
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
      localStorage.setItem(SIGNUP_PENDING_KEY, '1');
      const result = await confirmation.current.confirm(code);
      verifiedPhoneUser.current = result.user;
      setPhone(result.user.phoneNumber ?? phone);
      changeMode('signup-password');
    } catch (cause) {
      localStorage.removeItem(SIGNUP_PENDING_KEY);
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const finishSignup = async () => {
    const user = verifiedPhoneUser.current ?? auth.currentUser ?? undefined;
    if (!user) return changeMode('signup-phone');
    clearMessages();
    if (password.length < 6) return setError('비밀번호는 6자 이상으로 설정해 주세요.');
    if (password !== passwordConfirm) return setError('비밀번호가 서로 달라요.');
    setBusy(true);
    try {
      const hasPasswordLogin = user.providerData.some((provider) => provider.providerId === 'password');
      if (hasPasswordLogin) {
        await updatePassword(user, password);
      } else {
        const credential = EmailAuthProvider.credential(phoneLoginEmail(phone), password);
        await linkWithCredential(user, credential);
      }

      localStorage.removeItem(`meluni-profile:${user.uid}`);
      localStorage.removeItem(SIGNUP_PENDING_KEY);
      window.location.reload();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const sendRecoveryCode = async () => {
    clearMessages();
    if (recoveryPassword.length < 6) return setError('새 비밀번호는 6자 이상으로 설정해 주세요.');
    if (recoveryPassword !== recoveryPasswordConfirm) return setError('새 비밀번호가 서로 달라요.');
    setBusy(true);
    try {
      const nextVerifier = await createVerifier();
      confirmation.current = await signInWithPhoneNumber(auth, normalizeKoreanPhone(recoveryPhone), nextVerifier);
      setRecoveryCode('');
      changeMode('reset-code');
      setNotice('인증번호 6자리를 문자로 보냈어요.');
    } catch (cause) {
      console.error('[ROUTE password recovery SMS]', cause);
      destroyVerifier();
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeIncompleteRecoveryUser = async (user: User) => {
    try {
      await deleteUser(user);
    } catch {
      try { await signOut(auth); } catch { /* noop */ }
    }
  };

  const verifyRecoveryCode = async () => {
    if (!confirmation.current) return changeMode('reset-phone');
    clearMessages();
    setBusy(true);
    try {
      const result = await confirmation.current.confirm(recoveryCode);
      const hasPasswordLogin = result.user.providerData.some((provider) => provider.providerId === 'password');
      if (!hasPasswordLogin) {
        await removeIncompleteRecoveryUser(result.user);
        setMode('reset-phone');
        setError('가입이 완료된 계정을 찾을 수 없어요. 휴대폰 번호를 다시 확인해 주세요.');
        return;
      }

      await updatePassword(result.user, recoveryPassword);
      const successMessage = '비밀번호를 새로 설정했어요. 새 비밀번호로 로그인해 주세요.';
      sessionStorage.setItem(RECOVERY_NOTICE_KEY, successMessage);
      await signOut(auth);
      setMode('login');
      setRecoveryCode('');
      setLoginPassword('');
      setNotice(successMessage);
    } catch (cause) {
      if (auth.currentUser) {
        try { await signOut(auth); } catch { /* noop */ }
      }
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    if (mode === 'signup-phone') return changeMode('login');
    if (mode === 'signup-code') return changeMode('signup-phone');
    if (mode === 'reset-phone') return changeMode('login');
    if (mode === 'reset-code') return changeMode('reset-phone');
    changeMode('login');
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === 'login') void login();
    if (mode === 'signup-phone') void sendSignupCode();
    if (mode === 'signup-code') void verifySignupCode();
    if (mode === 'signup-password') void finishSignup();
    if (mode === 'reset-phone') void sendRecoveryCode();
    if (mode === 'reset-code') void verifyRecoveryCode();
  };

  const loginReady = loginPhone.replace(/\D/g, '').length >= 10 && loginPassword.length >= 6;
  const signupPhoneReady = phone.replace(/\D/g, '').length >= 10 && consented;
  const recoveryPhoneReady = recoveryPhone.replace(/\D/g, '').length >= 10 && recoveryConsented;
  const resetReady = recoveryPhoneReady && recoveryPassword.length >= 6 && recoveryPasswordConfirm.length >= 6;
  const recoveryMode = mode.startsWith('reset');
  const heroTitle = mode === 'login'
    ? '다시 만나서 반가워요'
    : mode.startsWith('reset')
      ? '비밀번호를 다시 설정해요'
      : '우리의 공간을 시작해요';
  const heroDescription = mode === 'login'
    ? '휴대폰 번호로 로그인하세요.'
    : mode.startsWith('reset')
      ? '가입한 휴대폰 번호를 인증하고 새 비밀번호를 설정하세요.'
      : '휴대폰 본인 인증 후 계정을 만들 수 있어요.';

  return <div className="app-shell auth-shell auth-v2">
    <div className="auth-hero">
      <Wordmark />
      <div className="window-mark"><span /><span /></div>
      <h1>{heroTitle}</h1>
      <p>{heroDescription}</p>
    </div>

    <form className="auth-card" onSubmit={submit}>
      {mode !== 'login' && mode !== 'signup-password' && <button className="auth-back" type="button" onClick={goBack}><ArrowLeft size={16} /> 이전</button>}

      {mode === 'login' && <>
        <p className="overline">WELCOME BACK</p>
        <h2>로그인</h2>
        <label>휴대폰 번호<input required type="tel" inputMode="tel" autoComplete="tel" value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)} placeholder="01012345678" /></label>
        <label>비밀번호<input required type="password" autoComplete="current-password" minLength={6} value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="비밀번호를 입력하세요" /></label>
        <div className="auth-help-links" aria-label="비밀번호 찾기">
          <button type="button" onClick={() => { setRecoveryPhone(loginPhone); setRecoveryPassword(''); setRecoveryPasswordConfirm(''); setRecoveryConsented(false); changeMode('reset-phone'); }}><KeyRound size={14} />비밀번호 찾기</button>
        </div>
        <button className="primary" type="submit" disabled={!loginReady || busy}><LogIn size={17} />{busy ? '로그인 중...' : '로그인'}</button>
        <div className="auth-divider"><span>아직 계정이 없나요?</span></div>
        <button className="signup-button" type="button" onClick={() => changeMode('signup-phone')}><UserPlus size={17} />회원가입</button>
      </>}

      {mode === 'reset-phone' && <>
        <p className="overline">PASSWORD RESET</p>
        <h2>비밀번호 찾기</h2>
        <p className="auth-guide">가입한 휴대폰 번호를 인증하면 기존 비밀번호 대신 새 비밀번호를 바로 설정할 수 있어요.</p>
        <label>가입한 휴대폰 번호<input required type="tel" inputMode="tel" autoComplete="tel" value={recoveryPhone} onChange={(e) => setRecoveryPhone(e.target.value)} placeholder="01012345678" /></label>
        <label>새 비밀번호<input required type="password" autoComplete="new-password" minLength={6} value={recoveryPassword} onChange={(e) => setRecoveryPassword(e.target.value)} placeholder="6자 이상 입력하세요" /></label>
        <label>새 비밀번호 확인<input required type="password" autoComplete="new-password" minLength={6} value={recoveryPasswordConfirm} onChange={(e) => setRecoveryPasswordConfirm(e.target.value)} placeholder="한 번 더 입력하세요" /></label>
        <label className="auth-consent"><input type="checkbox" checked={recoveryConsented} onChange={(e) => setRecoveryConsented(e.target.checked)} /><span>본인 확인을 위해 전화번호가 Google Firebase로 전송되는 것에 동의해요.</span></label>
        <button className="primary" type="submit" disabled={!resetReady || busy}><ShieldCheck size={17} />{busy ? '인증 준비 중...' : '인증번호 받고 재설정'}</button>
      </>}

      {mode === 'reset-code' && <>
        <p className="overline">PASSWORD RESET</p>
        <h2>마지막으로 본인 인증</h2>
        <p className="auth-guide"><b>{recoveryPhone}</b> 번호로 받은 6자리 인증번호가 맞으면 새 비밀번호로 변경돼요.</p>
        <label>인증번호<input autoFocus required type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, ''))} placeholder="6자리 인증번호" /></label>
        <button className="primary" type="submit" disabled={recoveryCode.length !== 6 || busy}>{busy ? '비밀번호 변경 중...' : '인증하고 비밀번호 변경'}</button>
      </>}

      {mode === 'signup-phone' && <>
        <p className="overline">SIGN UP · 1/3</p>
        <h2>휴대폰 번호를 인증해요</h2>
        <p className="auth-guide">가입할 휴대폰 번호로 인증 문자를 보내드려요.</p>
        <label>휴대폰 번호<input required type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" /></label>
        <label className="auth-consent"><input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} /><span>본인 확인을 위해 전화번호가 Google Firebase로 전송·저장되는 것에 동의해요.</span></label>
        <button className="primary" type="submit" disabled={!signupPhoneReady || busy}><Phone size={17} />{busy ? '보안 확인 준비 중...' : '인증번호 받기'}</button>
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

      <div id="recaptcha-container" className="route-recaptcha" />
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      {notice && <p className="auth-feedback notice">{notice}</p>}
    </form>

    <div className="privacy"><LockKeyhole size={14} /> {recoveryMode ? '본인 인증 정보는 계정 확인 목적으로만 사용돼요' : '로그인 정보는 안전하게 암호화되어 전송돼요'}</div>
  </div>;
}
