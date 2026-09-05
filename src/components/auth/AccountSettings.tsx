import { Bot, Camera, CheckCircle2, Heart, Link2, LogOut, Mail, Sparkles, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EmailAuthProvider,
  linkWithCredential,
  reload,
  sendEmailVerification,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { connectAiTestPartner, loadLocalAiPartner, syncUserProfile } from '../../lib/coupleData';
import { getRealCoupleConnection, type RealCoupleConnection } from '../../lib/coupleConnection';
import { savePartnerNickname } from '../../lib/coupleShared';
import { CoupleConnect } from '../couple/CoupleConnect';
import { CoupleDisconnectControl } from './CoupleDisconnectControl';
import {
  calculateAge,
  displayName,
  nicknameChangeState,
  saveProfile,
  setPartnerNickname,
  setSelfNickname,
  type Gender,
  type UserProfile,
} from '../../utils/profile';

const messageFor = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use') return '이미 다른 계정에서 사용 중인 이메일이에요.';
  if (code === 'auth/requires-recent-login') return '보안을 위해 다시 로그인한 뒤 시도해 주세요.';
  if (code === 'auth/weak-password') return '비밀번호는 6자 이상으로 만들어 주세요.';
  if (code === 'auth/invalid-email') return '이메일 주소를 확인해 주세요.';
  return '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
};

function aiNicknameFor(name: string) {
  const clean = name.trim();
  if (!clean) return '내사람';
  const last = clean.length >= 2 ? clean.slice(-2) : clean;
  const candidates = [`${last}야`, `${last}콩`, `${last}링`, '내사람'];
  return candidates[new Date().getDate() % candidates.length].slice(0, 12);
}

export function AccountSettings({ user, profile, onProfileChange, onClose }: {
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
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [nickname, setNickname] = useState(profile.nickname ?? profile.name);
  const [nicknameFeedback, setNicknameFeedback] = useState('');
  const [name, setName] = useState(profile.name);
  const [birthDate, setBirthDate] = useState(profile.birthDate);
  const [gender, setGender] = useState<Gender>(profile.gender);
  const [photoDataUrl, setPhotoDataUrl] = useState(profile.photoDataUrl ?? '');
  const [profileFeedback, setProfileFeedback] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFeedback, setAiFeedback] = useState('');
  const [aiPartner, setAiPartner] = useState(() => loadLocalAiPartner(user.uid));
  const [coupleConnectOpen, setCoupleConnectOpen] = useState(false);
  const [realConnection, setRealConnection] = useState<RealCoupleConnection | null>(null);
  const [partnerNickname, setPartnerNicknameValue] = useState('');
  const [partnerNicknameFeedback, setPartnerNicknameFeedback] = useState('');
  const [partnerNicknameBusy, setPartnerNicknameBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const age = useMemo(() => birthDate ? calculateAge(birthDate) : 0, [birthDate]);
  const nicknameState = nicknameChangeState(profile);
  const hasEmail = user.providerData.some((provider) => provider.providerId === 'password');
  const loginEmail = user.email?.endsWith('@login.meluni.app') ? null : user.email;

  useEffect(() => {
    let cancelled = false;
    const check = () => void getRealCoupleConnection(user.uid).then((next) => {
      if (cancelled) return;
      setRealConnection(next);
      if (next?.partnerProfile?.nickname) setPartnerNicknameValue(next.partnerProfile.nickname);
    }).catch(() => { if (!cancelled) setRealConnection(null); });
    check();
    const timer = window.setInterval(check, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [user.uid]);

  const syncProfile = (next: UserProfile) => {
    saveProfile(user.uid, next);
    onProfileChange(next);
    void syncUserProfile(user.uid, next).catch((cause) => console.warn('[ROUTE profile cloud sync]', cause));
  };

  const linkEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) return setFeedback('비밀번호가 서로 달라요.');
    setBusy(true); setFeedback('');
    try {
      const credential = EmailAuthProvider.credential(email.trim(), password);
      const result = await linkWithCredential(user, credential);
      await sendEmailVerification(result.user);
      setFeedback('인증 메일을 보냈어요. 메일의 링크를 누르면 이메일 로그인이 활성화돼요.');
    } catch (cause) { setFeedback(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const refreshVerification = async () => {
    setBusy(true); setFeedback('');
    try {
      await reload(user);
      setFeedback(user.emailVerified ? '이메일 인증이 완료됐어요.' : '아직 이메일 인증이 확인되지 않았어요.');
    } finally { setBusy(false); }
  };

  const readPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setProfileFeedback('이미지 파일을 선택해 주세요.');
    if (file.size > 3 * 1024 * 1024) return setProfileFeedback('프로필 사진은 3MB 이하로 선택해 주세요.');
    const reader = new FileReader();
    reader.onload = () => { setPhotoDataUrl(String(reader.result ?? '')); setProfileFeedback(''); };
    reader.readAsDataURL(file);
  };

  const saveEditedProfile = () => {
    setProfileFeedback('');
    if (name.trim().length < 2) return setProfileFeedback('이름을 2자 이상 입력해 주세요.');
    if (!birthDate || age <= 0) return setProfileFeedback('생년월일을 확인해 주세요.');
    const next: UserProfile = { ...profile, name: name.trim(), birthDate, gender, photoDataUrl: photoDataUrl || undefined };
    syncProfile(next);
    setProfileFeedback('프로필을 저장했어요.');
    setProfileOpen(false);
  };

  const saveNickname = () => {
    setNicknameFeedback('');
    const trimmed = nickname.trim();
    if (trimmed.length < 1 || trimmed.length > 12) return setNicknameFeedback('별명은 1~12자로 입력해 주세요.');
    if (!nicknameState.canChange) return setNicknameFeedback(`내가 직접 바꾸는 별명은 ${nicknameState.daysLeft}일 뒤에 다시 변경할 수 있어요.`);
    try {
      const next = setSelfNickname(profile, trimmed);
      syncProfile(next);
      setNicknameFeedback('별명을 바꿨어요. 다음 직접 변경은 30일 뒤에 가능해요.');
      setNicknameOpen(false);
    } catch {
      setNicknameFeedback('아직 별명을 직접 바꿀 수 있는 기간이 아니에요.');
    }
  };

  const saveRealPartnerNickname = async () => {
    const value = partnerNickname.trim();
    if (!realConnection) return setPartnerNicknameFeedback('먼저 실제 상대방 계정을 연결해 주세요.');
    if (value.length < 1 || value.length > 12) return setPartnerNicknameFeedback('상대방 별명은 1~12자로 입력해 주세요.');
    setPartnerNicknameBusy(true); setPartnerNicknameFeedback('');
    try {
      await savePartnerNickname(realConnection.coupleId, realConnection.partnerUid, value);
      setPartnerNicknameFeedback(`${realConnection.partnerProfile?.name || '상대방'}님의 별명을 “${value}”로 저장했어요. 두 사람 화면에 함께 반영돼요.`);
    } catch (cause) {
      console.error('[ROUTE partner nickname]', cause);
      setPartnerNicknameFeedback('상대방 별명을 저장하지 못했어요.');
    } finally { setPartnerNicknameBusy(false); }
  };

  const connectAi = async () => {
    if (aiBusy) return;
    setAiBusy(true); setAiFeedback('AI 테스트 파트너를 연결하고 있어요.');
    try {
      const result = await connectAiTestPartner(user.uid, displayName(profile));
      setAiPartner(result.localPartner);
      setAiFeedback(result.cloudSynced ? 'AI 테스트 파트너가 연결됐어요. Firestore 동기화도 완료됐어요.' : 'AI 테스트 파트너는 연결됐어요.');
    } catch (cause) {
      console.error('[ROUTE AI partner connect]', cause);
      setAiFeedback('AI 테스트 파트너 연결 중 문제가 생겼어요.');
    } finally { setAiBusy(false); }
  };

  const letAiChooseNickname = () => {
    if (!aiPartner?.connected) return setAiFeedback('먼저 AI 테스트 파트너를 연결해 주세요.');
    const chosen = aiNicknameFor(profile.name);
    const next = setPartnerNickname(profile, chosen);
    syncProfile(next);
    setNickname(chosen);
    setAiFeedback(`ROUTE가 "${chosen}"라고 별명을 지어줬어요.`);
  };

  const nicknameSource = profile.nicknameSetBy === 'partner' ? '상대방이 지어준 별명' : profile.nicknameSetBy === 'self' ? '내가 바꾼 별명' : '아직 상대방이 지어준 별명이 없어요';

  return <>
    <div className="sheet-backdrop account-backdrop" role="dialog" aria-modal="true" aria-label="계정 설정">
      <div className="account-settings profile-enabled-settings">
        <header><div><small>MY ACCOUNT</small><h2>계정 설정</h2></div><button onClick={onClose} aria-label="닫기"><X /></button></header>

        <section className="nickname-card">
          <div className="nickname-heading"><span><Heart size={17} /></span><div><small>내가 표시되는 이름</small><strong>{displayName(profile)}</strong><em>{nicknameSource}</em></div></div>
          <p>기본 이름은 가입할 때 입력한 이름이에요. 필요하면 내가 직접 별명을 바꿀 수 있어요.</p>
          {!nicknameOpen ? <button type="button" className="nickname-edit-button" disabled={!nicknameState.canChange} onClick={() => { setNickname(profile.nickname ?? profile.name); setNicknameFeedback(''); setNicknameOpen(true); }}>{nicknameState.canChange ? '내 별명 바꾸기' : `${nicknameState.daysLeft}일 뒤 변경 가능`}</button> : <div className="nickname-editor"><label>새 별명<input autoFocus type="text" maxLength={12} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="1~12자" /></label>{nicknameFeedback && <p className="account-feedback">{nicknameFeedback}</p>}<div><button type="button" onClick={() => setNicknameOpen(false)}>취소</button><button type="button" className="primary" onClick={saveNickname}>별명 저장</button></div></div>}
        </section>

        <section className="settings-profile-card">
          <button className="settings-profile-summary" type="button" onClick={() => setProfileOpen((open) => !open)}><span className="settings-profile-avatar">{photoDataUrl ? <img src={photoDataUrl} alt="프로필" /> : <UserRound size={24} />}</span><span className="settings-profile-copy"><small>내 기본 프로필</small><strong>{profile.name}</strong><em>{profile.birthDate} · 만 {calculateAge(profile.birthDate)}세</em></span><span className="settings-edit-label">{profileOpen ? '닫기' : '수정'}</span></button>
          {profileOpen && <div className="settings-profile-editor"><div className="settings-photo-row"><button type="button" className="settings-photo-picker" onClick={() => fileRef.current?.click()}>{photoDataUrl ? <img src={photoDataUrl} alt="선택한 프로필" /> : <UserRound size={28} />}<span><Camera size={13} /></span></button><div><strong>프로필 사진</strong><button type="button" onClick={() => fileRef.current?.click()}>사진 변경</button>{photoDataUrl && <button type="button" onClick={() => setPhotoDataUrl('')}>사진 삭제</button>}</div><input ref={fileRef} hidden type="file" accept="image/*" onChange={(event) => readPhoto(event.target.files?.[0])} /></div><label>이름<input type="text" maxLength={20} value={name} onChange={(event) => setName(event.target.value)} /></label><label>생년월일<input type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>{birthDate && <div className="settings-age"><span>현재 나이</span><strong>만 {age}세</strong></div>}<div className="settings-gender"><span>성별</span><div>{([['male', '남성'], ['female', '여성'], ['other', '기타']] as const).map(([value, label]) => <button type="button" key={value} className={gender === value ? 'selected' : ''} onClick={() => setGender(value)}>{label}</button>)}</div></div>{profileFeedback && <p className="account-feedback">{profileFeedback}</p>}<button className="primary settings-save-profile" type="button" onClick={saveEditedProfile}>프로필 저장</button></div>}
        </section>

        <div className="account-summary"><span>전화번호</span><strong>{user.phoneNumber ?? '등록되지 않음'}</strong><CheckCircle2 size={18} /></div>

        <section className="ai-test-card real-couple-connect-card">
          <div><Link2 size={20} /><span><strong>{realConnection ? '상대방 프로필 및 연결' : '상대방과 연결하기'}</strong><small>{realConnection ? `${realConnection.partnerProfile?.name || '상대방'}님과 실제 계정이 연결되어 있어요.` : '초대 코드를 만들거나 상대방에게 받은 코드를 입력해 실제 계정을 연결해요.'}</small></span></div>
          {!realConnection && <button type="button" className="nickname-edit-button" onClick={() => setCoupleConnectOpen(true)}>상대방 연결 설정 열기</button>}
          {realConnection && <CoupleDisconnectControl uid={user.uid} connection={realConnection} onDisconnected={() => {
            setRealConnection(null);
            setPartnerNicknameValue('');
            setPartnerNicknameFeedback('');
            setFeedback('상대방과의 연결을 끊었어요. 공유 기록은 더 이상 접근하지 못할 수 있어요.');
          }} />}
        </section>

        {realConnection && <section className="nickname-card partner-nickname-card">
          <div className="nickname-heading"><span><Heart size={17} /></span><div><small>내가 상대방에게 지어주는 이름</small><strong>{realConnection.partnerProfile?.name || '상대방'}</strong><em>기본은 상대방의 실제 이름으로 표시돼요</em></div></div>
          <p>별명을 저장하면 홈과 채팅에서 상대방의 이름 대신 이 별명이 표시돼요.</p>
          <div className="nickname-editor"><label>상대방 별명<input type="text" maxLength={12} value={partnerNickname} onChange={(e) => setPartnerNicknameValue(e.target.value)} placeholder={realConnection.partnerProfile?.name || '1~12자'} /></label>{partnerNicknameFeedback && <p className="account-feedback">{partnerNicknameFeedback}</p>}<div><button type="button" className="primary" disabled={partnerNicknameBusy} onClick={() => void saveRealPartnerNickname()}>{partnerNicknameBusy ? '저장 중...' : '상대방 별명 저장'}</button></div></div>
        </section>}

        {hasEmail && loginEmail ? <div className="email-status"><Mail size={18} /><div><span>로그인 이메일</span><strong>{loginEmail}</strong><small>{user.emailVerified ? '인증 완료' : '인증 대기 중'}</small></div>{!user.emailVerified && <button onClick={() => void refreshVerification()} disabled={busy}>인증 확인</button>}</div> : <form className="link-email-form" onSubmit={(event) => void linkEmail(event)}><h3>이메일 로그인 추가</h3><p>이메일을 인증하면 휴대폰 번호뿐 아니라 이메일로도 로그인할 수 있어요.</p><label>이메일<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="hello@example.com" /></label><label>새 비밀번호<input required type="password" autoComplete="new-password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6자 이상" /></label><label>비밀번호 확인<input required type="password" autoComplete="new-password" minLength={6} value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="한 번 더 입력하세요" /></label><button className="primary" type="submit" disabled={busy || !email.trim() || password.length < 6 || confirm.length < 6}>{busy ? '등록 중...' : '이메일 등록하고 인증받기'}</button></form>}

        <section className="ai-test-card"><div><Bot size={20} /><span><strong>AI 테스트 파트너</strong><small>실제 상대방 기능과 별개로 테스트할 때만 사용해요.</small></span></div><button type="button" className="nickname-edit-button" disabled={aiBusy || Boolean(aiPartner?.connected) || Boolean(realConnection)} onClick={() => void connectAi()}>{aiBusy ? '연결 중...' : aiPartner?.connected ? 'AI 파트너 연결됨' : 'AI 테스트 파트너 연결'}</button>{aiPartner?.connected && !realConnection && <button type="button" className="nickname-edit-button ai-nickname-button" onClick={letAiChooseNickname}><Sparkles size={15} />AI가 내 별명 지어주기</button>}{aiFeedback && <p className="account-feedback">{aiFeedback}</p>}</section>

        {feedback && <p className="account-feedback">{feedback}</p>}
        <button className="logout-button" onClick={() => void signOut(auth)}><LogOut size={17} />로그아웃</button>
      </div>
    </div>

    {coupleConnectOpen && <div className="sheet-backdrop account-backdrop couple-connect-settings-backdrop" role="dialog" aria-modal="true" aria-label="상대방 연결 설정"><button className="standard-close-button couple-settings-close" type="button" aria-label="닫기" onClick={() => setCoupleConnectOpen(false)}><X /></button><CoupleConnect user={user} profile={profile} onConnected={(next) => { setRealConnection(next); setCoupleConnectOpen(false); setFeedback('상대방 계정과 연결됐어요.'); }} /></div>}
  </>;
}
