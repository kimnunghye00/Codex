import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { getRealCoupleConnection, type RealCoupleConnection } from '../../lib/coupleConnection';
import { calculateAge } from '../../utils/profile';

export function PartnerProfileCard() {
  const [connection, setConnection] = useState<RealCoupleConnection | null>(null);
  const uid = auth.currentUser?.uid ?? '';

  useEffect(() => {
    if (!uid) return;
    void getRealCoupleConnection(uid).then(setConnection).catch(() => setConnection(null));
  }, [uid]);

  const profile = connection?.partnerProfile;
  if (!profile) return null;

  const gender = profile.gender === 'male' ? '남성' : profile.gender === 'female' ? '여성' : '기타';
  return <section className="settings-profile-card route-partner-profile-card">
    <div className="settings-profile-summary route-partner-profile-summary">
      <span className="settings-profile-avatar">{profile.photoDataUrl ? <img src={profile.photoDataUrl} alt="상대방 프로필" /> : <UserRound size={24} />}</span>
      <span className="settings-profile-copy"><small>상대방 기본 프로필</small><strong>{profile.name}</strong><em>{profile.birthDate ? `${profile.birthDate} · 만 ${calculateAge(profile.birthDate)}세` : '생년월일 미등록'}</em></span>
    </div>
    <div className="route-partner-profile-detail">
      <div><span>별명</span><strong>{profile.nickname || '등록되지 않음'}</strong></div>
      <div><span>성별</span><strong>{gender}</strong></div>
    </div>
  </section>;
}
