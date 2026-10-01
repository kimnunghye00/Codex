import { useState } from 'react';
import { PageSettingToggle, PageSettingsSheet } from '../navigation/PageSettingsSheet';
import { DEFAULT_HOME_PREFERENCES, type HomePagePreferences } from '../../utils/pagePreferences';

export function HomeSettings({ preferences, onPreferences, relationshipStartDate, connected, onSaveStartDate, onClose, storageNotice }: {
  preferences: HomePagePreferences; onPreferences: (next: HomePagePreferences) => void;
  relationshipStartDate?: string; connected: boolean; onSaveStartDate: (date: string) => Promise<void>;
  onClose: () => void; storageNotice: string;
}) {
  const [date, setDate] = useState(relationshipStartDate ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const save = async () => {
    if (saving || !connected || !date || date > today) return;
    setSaving(true); setFeedback('');
    try { await onSaveStartDate(date); setFeedback('우리의 시작일을 저장했어요. 두 사람에게 함께 적용돼요.'); }
    catch { setFeedback('저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  };
  return <PageSettingsSheet title="홈 설정" onClose={onClose}>
    <p>홈에 표시할 요약을 선택해요. 표시 설정은 이 계정의 현재 기기에 저장돼요.</p>
    {([['anniversaries', '다가오는 기념일', '100일, 주년 등 연인 기념일'], ['schedules', '우리 일정', '다가오는 두 사람의 일정'], ['memories', '우리의 추억', '최근 사진과 추억 미리보기']] as const).map(([key, label, description]) =>
      <PageSettingToggle key={key} label={label} description={description} checked={preferences[key]} onChange={() => onPreferences({ ...preferences, [key]: !preferences[key] })} />)}
    <label className="page-setting-field"><b>우리의 시작일</b><input type="date" value={date} max={today} disabled={!connected || saving} onChange={(event) => setDate(event.target.value)} /></label>
    <p>{connected ? '시작일은 두 사람의 사귄 일수와 기념일에 함께 적용돼요.' : '더보기의 계정 설정에서 상대방을 먼저 연결해 주세요.'}</p>
    <button type="button" className="primary" disabled={!connected || saving || !date || date > today} onClick={() => void save()}>{saving ? '저장 중…' : '시작일 저장'}</button>
    {feedback && <p role="status">{feedback}</p>}{storageNotice && <p role="status">{storageNotice}</p>}
    <button type="button" className="page-setting-link" onClick={() => onPreferences({ ...DEFAULT_HOME_PREFERENCES })}>홈 표시 기본값으로 복원</button>
  </PageSettingsSheet>;
}
