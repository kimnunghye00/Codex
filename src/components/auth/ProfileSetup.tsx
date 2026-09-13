import { Camera, Check, ChevronLeft, ChevronRight, UserRound } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { calculateAge, saveProfile, type Gender, type UserProfile } from '../../utils/profile';
import { syncUserProfile } from '../../lib/coupleData';
import { AuthFlow } from './AuthFlow';

const steps = ['이름', '생년월일', '성별', '프로필 사진'];

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
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const birthDateValid = isValidBirthDate(birthDate);
  const age = useMemo(() => birthDateValid ? calculateAge(birthDate) : 0, [birthDate, birthDateValid]);

  if (user.phoneNumber && !hasPassword) return <AuthFlow />;

  const canContinue = step === 0 ? name.trim().length >= 2
    : step === 1 ? birthDateValid && age > 0
      : step === 2 ? Boolean(gender)
        : true;

  const next = () => {
    setError('');
    if (!canContinue) return setError(step === 1 ? '생년월일 8자리를 정확히 입력해 주세요.' : '필수 정보를 입력해 주세요.');
    if (step < 3) return setStep((current) => current + 1);
    const profile: UserProfile = {
      name: name.trim(),
      birthDate,
      gender: gender as Gender,
      photoDataUrl: photoDataUrl || undefined,
      completedAt: new Date().toISOString(),
    };
    saveProfile(user.uid, profile);
    void syncUserProfile(user.uid, profile).catch((cause) => console.warn('[DANDULI profile cloud sync]', cause));
    onComplete(profile);
  };

  const readPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('이미지 파일을 선택해 주세요.');
    if (file.size > 3 * 1024 * 1024) return setError('프로필 사진은 3MB 이하로 선택해 주세요.');
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoDataUrl(String(reader.result ?? ''));
      setError('');
    };
    reader.readAsDataURL(file);
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
        <input ref={fileRef} hidden type="file" accept="image/*" onChange={(e) => readPhoto(e.target.files?.[0])} />
        <button type="button" className="photo-action" onClick={() => fileRef.current?.click()}>{photoDataUrl ? '다른 사진 선택' : '사진 선택하기'}</button>
        {!photoDataUrl && <small className="skip-note">사진 없이 시작해도 괜찮아요.</small>}
      </section>}

      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      <div className="onboarding-actions">
        {step > 0 ? <button type="button" className="secondary" onClick={() => { setError(''); setStep((current) => current - 1); }}><ChevronLeft size={18} />이전</button> : <span />}
        <button type="button" className="primary" disabled={!canContinue} onClick={next}>{step === 3 ? '프로필 설정 완료' : '다음'}{step < 3 && <ChevronRight size={18} />}</button>
      </div>
    </main>
  </div>;
}
