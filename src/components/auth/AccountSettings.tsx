import { Camera, CheckCircle2, LogOut, Mail, UserRound, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  EmailAuthProvider,
  linkWithCredential,
  reload,
  sendEmailVerification,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { calculateAge, saveProfile, type Gender, type UserProfile } from '../../utils/profile';

const messageFor = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use') return '이미 다른 계정에서 사용 중인 이메일이에요.';
  if (code === 'auth/requires-recent-login') return '보안을 위해 다시 로그인한 뒤 시도해 주세요.';
  if (code === 'auth/weak-password') return '비밀번호는 6자 이상으로 만들어 주세요.';
  if (code === 'auth/invalid-email') return '이메일 주소를 확인해 주세요.';
  return '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
};

export function AccountSettings({
  user,
  profile,
  onProfileChange,
  onClose,
}: {
  user: User;
  profile: UserProfile;
  onProfileChange: (profile: UserProfile) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [name, setName] = useState(profile.name);
  const [birthDate, setBirthDate] = useState(profile.birthDate);
  const [gender, setGender] = useState<Gender>(profile.gender);
  const [photoDataUrl, setPhotoDataUrl] = useState(profile.photoDataUrl ?? '');
  const [profileFeedback, setProfileFeedback] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const age = useMemo(() => birthDate ? calculateAge(birthDate) : 0, [birthDate]);
  const hasEmail = user.providerData.some((provider) => provider.providerId === 'password');
  const loginEmail = user.email?.endsWith('@login.meluni.app') ? null : user.email;

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

  const readPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setProfileFeedback('이미지 파일을 선택해 주세요.');
    if (file.size > 3 * 1024 * 1024) return setProfileFeedback('프로필 사진은 3MB 이하로 선택해 주세요.');
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoDataUrl(String(reader.result ?? ''));
      setProfileFeedback('');
    };
    reader.readAsDataURL(file);
  };

  const saveEditedProfile = () => {
    setProfileFeedback('');
    if (name.trim().length < 2) return setProfileFeedback('이름을 2자 이상 입력해 주세요.');
    if (!birthDate || age <= 0) return setProfileFeedback('생년월일을 확인해 주세요.');
    const next: UserProfile = {
      ...profile,
      name: name.trim(),
      birthDate,
      gender,
      photoDataUrl: photoDataUrl || undefined,
    };
    saveProfile(user.uid, next);
    onProfileChange(next);
    setProfileFeedback('프로필을 저장했어요.');
    setProfileOpen(false);
  };

  return <div className="sheet-backdrop account-backdrop" role="dialog" aria-modal="true" aria-label="계정 설정">
    <div className="account-settings profile-enabled-settings">
      <header><div><small>MY ACCOUNT</small><h2>계정 설정</h2></div><button onClick={onClose} aria-label="닫기"><X /></button></header>

      <section className="settings-profile-card">
        <button className="settings-profile-summary" type="button" onClick={() => setProfileOpen((open) => !open)}>
          <span className="settings-profile-avatar">{photoDataUrl ? <img src={photoDataUrl} alt="프로필" /> : <UserRound size={24} />}</span>
          <span className="settings-profile-copy"><small>내 프로필</small><strong>{profile.name}</strong><em>{profile.birthDate} · 만 {calculateAge(profile.birthDate)}세</em></span>
          <span className="settings-edit-label">{profileOpen ? '닫기' : '수정'}</span>
        </button>

        {profileOpen && <div className="settings-profile-editor">
          <div className="settings-photo-row">
            <button type="button" className="settings-photo-picker" onClick={() => fileRef.current?.click()}>
              {photoDataUrl ? <img src={photoDataUrl} alt="선택한 프로필" /> : <UserRound size={28} />}
              <span><Camera size={13} /></span>
            </button>
            <div><strong>프로필 사진</strong><button type="button" onClick={() => fileRef.current?.click()}>사진 변경</button>{photoDataUrl && <button type="button" onClick={() => setPhotoDataUrl('')}>사진 삭제</button>}</div>
            <input ref={fileRef} hidden type="file" accept="image/*" onChange={(event) => readPhoto(event.target.files?.[0])} />
          </div>

          <label>이름<input type="text" maxLength={20} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>생년월일<input type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
          {birthDate && <div className="settings-age"><span>현재 나이</span><strong>만 {age}세</strong></div>}
          <div className="settings-gender"><span>성별</span><div>{([['male', '남성'], ['female', '여성'], ['other', '기타']] as const).map(([value, label]) => <button type="button" key={value} className={gender === value ? 'selected' : ''} onClick={() => setGender(value)}>{label}</button>)}</div></div>
          {profileFeedback && <p className="account-feedback">{profileFeedback}</p>}
          <button className="primary settings-save-profile" type="button" onClick={saveEditedProfile}>프로필 저장</button>
        </div>}
      </section>

      <div className="account-summary"><span>전화번호</span><strong>{user.phoneNumber ?? '등록되지 않음'}</strong><CheckCircle2 size={18} /></div>
      {hasEmail && loginEmail ? <div className="email-status"><Mail size={18} /><div><span>로그인 이메일</span><strong>{loginEmail}</strong><small>{user.emailVerified ? '인증 완료' : '인증 대기 중'}</small></div>{!user.emailVerified && <button onClick={() => void refreshVerification()} disabled={busy}>인증 확인</button>}</div> : <form className="link-email-form" onSubmit={(event) => void linkEmail(event)}>
        <h3>이메일 로그인 추가</h3><p>이메일을 인증하면 휴대폰 번호뿐 아니라 이메일로도 로그인할 수 있어요.</p>
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
