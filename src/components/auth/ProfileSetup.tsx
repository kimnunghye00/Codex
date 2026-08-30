import { Camera, Check, ChevronLeft, ChevronRight, UserRound } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { calculateAge, saveProfile, type Gender, type UserProfile } from '../../utils/profile';

const steps = ['이름', '생년월일', '성별', '프로필 사진'];

export function ProfileSetup({ user, onComplete }: { user: User; onComplete: (profile: UserProfile) => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const age = useMemo(() => birthDate ? calculateAge(birthDate) : 0, [birthDate]);

  const canContinue = step === 0 ? name.trim().length >= 2
    : step === 1 ? Boolean(birthDate) && age > 0
      : step === 2 ? Boolean(gender)
        : true;

  const next = () => {
    setError('');
    if (!canContinue) return setError('필수 정보를 입력해 주세요.');
    if (step < 3) return setStep((current) => current + 1);
    const profile: UserProfile = {
      name: name.trim(),
      birthDate,
      gender: gender as Gender,
      photoDataUrl: photoDataUrl || undefined,
      completedAt: new Date().toISOString(),
    };
    saveProfile(user.uid, profile);
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
      <div className="wordmark"><strong>MELUNI.</strong><span>ME + U</span></div>
      <span>{step + 1} / 4</span>
    </header>

    <div className="onboarding-progress" aria-label="프로필 설정 진행률">
      {steps.map((label, index) => <div key={label} className={index <= step ? 'active' : ''}><i /> <span>{label}</span></div>)}
    </div>

    <main className="onboarding-card">
      {step === 0 && <section>
        <p className="overline">PROFILE SETUP</p>
        <h1>어떻게 불러드릴까요?</h1>
        <p className="onboarding-copy">MELUNI에서 사용할 이름을 입력해 주세요.</p>
        <label>이름<input autoFocus type="text" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="이름을 입력하세요" /></label>
      </section>}

      {step === 1 && <section>
        <p className="overline">BIRTHDAY</p>
        <h1>생년월일을 알려주세요</h1>
        <p className="onboarding-copy">나이는 생년월일을 기준으로 자동 계산돼요.</p>
        <label>생년월일<input type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirthDate(e.target.value)} /></label>
        {birthDate && <div className="age-preview"><span>현재 나이</span><strong>만 {age}세</strong></div>}
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
