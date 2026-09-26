import { Camera, Check, ChevronLeft, ChevronRight, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { calculateAge, saveProfile, type Gender, type UserProfile } from '../../utils/profile';
import { syncUserProfile } from '../../lib/coupleData';
import { prepareProfilePhoto } from '../../utils/profileImage';
import { AuthFlow } from './AuthFlow';

const steps = ['이름', '생년월일', '성별', '프로필 사진'];
const draftKey = (uid: string) => `danduli-profile-draft:${uid}`;

function loadDraft(uid: string) {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(uid)) || '{}') as Record<string, unknown>;
    return {
      name: typeof draft.name === 'string' ? draft.name : '',
      birthDate: typeof draft.birthDate === 'string' ? draft.birthDate : '',
      gender: draft.gender === 'male' || draft.gender === 'female' || draft.gender === 'other' ? draft.gender : '' as Gender | '',
      photoDataUrl: typeof draft.photoDataUrl === 'string' && draft.photoDataUrl.startsWith('data:image/') ? draft.photoDataUrl : '',
    };
  } catch { return { name: '', birthDate: '', gender: '' as Gender | '', photoDataUrl: '' }; }
}

const normalizeBirthDate = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length < 5) return digits;
  if (digits.length < 7) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
};

const isValidBirthDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date <= today;
};

export function ProfileSetup({ user, onComplete }: { user: User; onComplete: (profile: UserProfile) => void }) {
  const hasPassword = user.providerData.some((provider) => provider.providerId === 'password');
  const [draft] = useState(() => loadDraft(user.uid));
  const [step, setStep] = useState(0);
  const [name, setName] = useState(draft.name);
  const [birthDate, setBirthDate] = useState(draft.birthDate);
  const [gender, setGender] = useState<Gender | ''>(draft.gender);
  const [photoDataUrl, setPhotoDataUrl] = useState(draft.photoDataUrl);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const birthDateValid = isValidBirthDate(birthDate);
  const age = useMemo(() => birthDateValid ? calculateAge(birthDate) : 0, [birthDate, birthDateValid]);

  useEffect(() => {
    try { localStorage.setItem(draftKey(user.uid), JSON.stringify({ name, birthDate, gender, photoDataUrl })); }
    catch { /* Keep the form available even when this device blocks storage. */ }
  }, [user.uid, name, birthDate, gender, photoDataUrl]);

  if (user.phoneNumber && !hasPassword) return <AuthFlow />;

  const canContinue = step === 0 ? name.trim().length >= 2
    : step === 1 ? birthDateValid && age > 0
      : step === 2 ? Boolean(gender)
        : true;

  const next = async () => {
    setError('');
    if (busy || photoBusy) return;
    if (!canContinue) return setError(step === 1 ? '생년월일 8자리를 정확히 입력해 주세요.' : '필수 정보를 입력해 주세요.');
    if (step < 3) return setStep((current) => current + 1);
    const profile: UserProfile = {
      name: name.trim(),
      birthDate,
      gender: gender as Gender,
      photoDataUrl: photoDataUrl || undefined,
      completedAt: new Date().toISOString(),
    };
    setBusy(true);
    try {
      await syncUserProfile(user.uid, profile);
      try { saveProfile(user.uid, profile); }
      catch (cause) { console.warn('[DANDULI profile cache]', cause); }
      try { localStorage.removeItem(draftKey(user.uid)); }
      catch { /* Cloud profile is already saved. */ }
      onComplete(profile);
    } catch (cause) {
      console.warn('[DANDULI profile cloud sync]', cause);
      setError('프로필을 서버에 저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };

  const readPhoto = async (file?: File) => {
    if (!file) return;
    setPhotoBusy(true);
    try {
      setPhotoDataUrl(await prepareProfilePhoto(file));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'image-only' ? '이미지 파일을 선택해 주세요.'
        : cause instanceof Error && cause.message === 'image-too-large' ? '프로필 사진은 12MB 이하로 선택해 주세요.'
          : '사진을 처리하지 못했어요. 다른 사진으로 다시 시도해 주세요.');
    } finally { setPhotoBusy(false); }
  };

  return <div className="app-shell onboarding-shell">
    <header className="onboarding-header">
      <div className="wordmark"><strong>단둘이</strong></div>
      <span>{step + 1} / 4</span>
    </header>

    <div className="onboarding-progress" aria-label="프로필 설정 진행률">
      {steps.map((label, index) => <div key={label} className={index <= step ? 'active' : ''}><i /> <span>{label}</span></div>)}
    </div>

    <main className="onboarding-card">
      {step === 0 && <section>
        <p className="overline">PROFILE SETUP</p>
        <h1>어떻게 불러드릴까요?</h1>
        <p className="onboarding-copy">단둘이에서 사용할 이름을 입력해 주세요.</p>
        <label>이름<input autoFocus type="text" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="이름을 입력하세요" /></label>
      </section>}

      {step === 1 && <section>
        <p className="overline">BIRTHDAY</p>
        <h1>생년월일을 알려주세요</h1>
        <p className="onboarding-copy">숫자 8자리로 입력해 주세요. 나이는 자동 계산돼요.</p>
        <label>생년월일<input autoFocus type="text" inputMode="numeric" autoComplete="bday" maxLength={10} value={birthDate} onChange={(e) => setBirthDate(normalizeBirthDate(e.target.value))} placeholder="예: 1998-12-25" /></label>
        {birthDateValid && <div className="age-preview"><span>현재 나이</span><strong>만 {age}세</strong></div>}
      </section>}

      {step === 2 && <section>
        <p className="overline">GENDER</p>
        <h1>성별을 선택해 주세요</h1>
        <p className="onboarding-copy">프로필에 표시할 성별을 선택할 수 있어요.</p>
        <div className="gender-options">
          {([['male', '남성'], ['female', '여성'], ['other', '기타']] as const).map(([value, label]) => <button type="button" key={value} className={gender === value ? 'selected' : ''} onClick={() => setGender(value)}><span>{label}</span>{gender === value && <Check size={18} />}</button>)}
        </div>
      </section>}

      {step === 3 && <section>
        <p className="overline">PROFILE PHOTO</p>
        <h1>마지막으로 사진을 설정해요</h1>
        <p className="onboarding-copy">사진은 선택 사항이에요. 나중에 계정 설정에서도 바꿀 수 있어요.</p>
        <button type="button" className="photo-picker" onClick={() => fileRef.current?.click()}>
          {photoDataUrl ? <img src={photoDataUrl} alt="선택한 프로필" /> : <span><UserRound size={38} /><Camera size={17} /></span>}
        </button>
        <input ref={fileRef} hidden type="file" accept="image/*" onChange={(e) => void readPhoto(e.target.files?.[0])} />
        <button type="button" className="photo-action" onClick={() => fileRef.current?.click()}>{photoDataUrl ? '다른 사진 선택' : '사진 선택하기'}</button>
        {!photoDataUrl && <small className="skip-note">사진 없이 시작해도 괜찮아요.</small>}
      </section>}

      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      <div className="onboarding-actions">
        {step > 0 ? <button type="button" className="secondary" onClick={() => { setError(''); setStep((current) => current - 1); }}><ChevronLeft size={18} />이전</button> : <span />}
        <button type="button" className="primary" disabled={!canContinue || busy || photoBusy} onClick={() => void next()}>{busy ? '서버에 저장 중...' : photoBusy ? '사진 처리 중...' : step === 3 ? '프로필 설정 완료' : '다음'}{step < 3 && <ChevronRight size={18} />}</button>
      </div>
    </main>
  </div>;
}
