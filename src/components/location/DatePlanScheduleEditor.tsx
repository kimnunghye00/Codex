import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarClock, Plus, Trash2 } from 'lucide-react';
import type { DatePlanCandidate, DatePlanTimeBlock } from '../../lib/datePlanFoundation';
import { EMPTY_DATE_PLAN_SCHEDULE, readDatePlanSchedule, saveDatePlanSchedule, subscribeDatePlanSchedule } from '../../lib/datePlanSchedule';
import {
  calculateDatePlanTimeline, durationAsHoursMinutes, durationFromHoursMinutes,
  MAX_DATE_PLAN_BLOCKS, moveDatePlanBlock, normalizeTimeBlocks, type DatePlanSchedule,
} from '../../lib/datePlanTime';

type Kind = DatePlanTimeBlock['kind'];
const KINDS: Record<Kind, string> = { activity: '활동', meal: '식사', other: '기타' };
const copy = (schedule: DatePlanSchedule): DatePlanSchedule => ({
  ...schedule, blocks: schedule.blocks.map((block) => ({ ...block, backupCandidateIds: [...block.backupCandidateIds] })),
});

export function DatePlanScheduleEditor({ coupleId, planId, uid, candidates }: {
  coupleId: string; planId: string; uid: string; candidates: DatePlanCandidate[];
}) {
  const [draft, setDraft] = useState<DatePlanSchedule>(() => copy(EMPTY_DATE_PLAN_SCHEDULE));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [candidateToAdd, setCandidateToAdd] = useState('');
  const [customName, setCustomName] = useState('');
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  const currentRevision = useRef(0);
  const changedCandidateIds = candidates.map((item) => item.id);
  const candidateIdsKey = changedCandidateIds.join('\u0001');
  const timeline = useMemo(() => calculateDatePlanTimeline(draft.startTime, draft.blocks), [draft]);
  const candidateById = useMemo(() => new Map(candidates.map((item) => [item.id, item])), [candidates]);

  useEffect(() => {
    dirtyRef.current = false; savingRef.current = false; conflictRef.current = false;
    currentRevision.current = 0;
    setDraft(copy(EMPTY_DATE_PLAN_SCHEDULE)); setLoading(true); setSaving(false);
    setDirty(false); setConflict(false); setError(''); setStatus('');
    return subscribeDatePlanSchedule(coupleId, planId, (remote) => {
      currentRevision.current = remote.revision;
      if (savingRef.current) return;
      if (dirtyRef.current) {
        if (remote.revision !== localRevision.current) {
          conflictRef.current = true; setConflict(true);
          setError('상대방이 이 시간표를 변경했어요. 내 미저장 내용은 유지했으며 자동으로 덮어쓰지 않았어요.');
        }
        return;
      }
      localRevision.current = remote.revision;
      setDraft(copy(remote)); setLoading(false); setError('');
      setStatus(remote.revision ? '두 사람에게 공유된 초안' : '시간표를 만들어 주세요');
    }, () => { setLoading(false); setError('공동 시간표를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'); });
  }, [coupleId, planId]);

  const localRevision = useRef(0);
  const edit = (update: (current: DatePlanSchedule) => DatePlanSchedule) => {
    if (loading || saving || conflict) return;
    setDraft((current) => update(current));
    dirtyRef.current = true; setDirty(true); setStatus('자동 저장 대기 중…'); setError('');
  };
  const setBlock = (id: string, update: (current: DatePlanTimeBlock) => DatePlanTimeBlock) =>
    edit((current) => ({ ...current, blocks: current.blocks.map((block) => block.id === id ? update(block) : block) }));

  useEffect(() => {
    if (!dirty || loading || saving || conflict) return;
    const timer = window.setTimeout(() => {
      if (savingRef.current || conflictRef.current) return;
      savingRef.current = true; setSaving(true); setStatus('자동 저장 중…');
      void saveDatePlanSchedule(
        coupleId, planId, uid, draft.revision, draft.startTime, draft.blocks, candidateIdsKey ? candidateIdsKey.split('\u0001') : [],
      ).then((revision) => {
        localRevision.current = revision;
        dirtyRef.current = false; setDirty(false);
        setDraft((current) => ({ ...current, revision }));
        setStatus('자동 저장 완료 · 두 사람에게 공유됨'); setError('');
      }).catch((reason: unknown) => {
        const message = String((reason as Error)?.message ?? '');
        if (message.includes('date-plan-schedule-conflict')) {
          conflictRef.current = true; setConflict(true);
          setError('상대방이 먼저 시간표를 저장했어요. 내 변경은 보존했으며 아래에서 최신 초안을 불러올 수 있어요.');
        } else {
          setError(message.includes('삭제된 장소') ? message : '시간표를 저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
        }
        setStatus('저장되지 않은 변경 있음');
      }).finally(() => { savingRef.current = false; setSaving(false); });
    }, 950);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, loading, saving, conflict, coupleId, planId, uid, candidateIdsKey]);

  const reload = async () => {
    if ((dirty || conflict) && !window.confirm('미저장 변경을 버리고 상대방의 최신 시간표를 불러올까요?')) return;
    setLoading(true); setError('');
    try {
      const remote = await readDatePlanSchedule(coupleId, planId);
      localRevision.current = remote.revision; currentRevision.current = remote.revision;
      dirtyRef.current = false; conflictRef.current = false;
      setDraft(copy(remote)); setDirty(false); setConflict(false);
      setStatus('최신 초안을 불러왔어요');
    } catch { setError('시간표를 다시 불러오지 못했어요.'); }
    finally { setLoading(false); }
  };
  const addBlock = (candidateId: string | null, title: string, kind: Kind) => {
    if (draft.blocks.length >= MAX_DATE_PLAN_BLOCKS) { setError('시간표에는 최대 20개까지 추가할 수 있어요.'); return; }
    if (!title.trim()) { setError('일정 이름을 입력해 주세요.'); return; }
    const block: DatePlanTimeBlock = {
      id: crypto.randomUUID(), kind, title: title.trim().slice(0, 100),
      position: draft.blocks.length, primaryCandidateId: candidateId, backupCandidateIds: [],
      activityMinutes: 60, travelMinutes: 0, fixedStart: null,
    };
    edit((current) => ({ ...current, blocks: normalizeTimeBlocks([...current.blocks, block]) }));
    setCustomName('');
  };
  const editDuration = (block: DatePlanTimeBlock, field: 'activityMinutes' | 'travelMinutes', unit: 'hours' | 'minutes', value: number) => {
    const original = durationAsHoursMinutes(block[field]);
    const hours = unit === 'hours' ? value : original.hours;
    const minutes = unit === 'minutes' ? value : original.minutes;
    try {
      const duration = durationFromHoursMinutes(hours, minutes);
      setBlock(block.id, (current) => ({ ...current, [field]: duration }));
    } catch { setError('시간은 최대 24시간, 분은 0~59로 입력해 주세요.'); }
  };

  return <section className="date-map-timetable" aria-label="공동 데이트 시간표">
    <div className="date-map-panel-header"><strong><CalendarClock size={16}/> 반자동 시간표</strong><span>{draft.blocks.length}개 일정</span></div>
    <p className="date-map-add-hint">장소와 방문 순서를 정한 뒤 활동·이동 시간을 시와 분으로 입력해 주세요. 이동 시간은 직접 입력하며 자동 길찾기로 계산하지 않아요. 초안은 자동 저장돼요.</p>
    {loading ? <p role="status">공동 시간표를 불러오는 중이에요…</p> : <>
      <label className="date-map-plan-time-label">데이트 시작 시각 (선택)
        <input type="time" value={draft.startTime} disabled={saving || conflict}
          onChange={(event) => edit((current) => ({ ...current, startTime: event.target.value }))}/>
      </label>
      <div className="date-map-timetable-add">
        <label>후보 장소를 일정에 추가
          <select value={candidateToAdd} disabled={saving || conflict} onChange={(event) => setCandidateToAdd(event.target.value)}>
            <option value="">장소를 선택해 주세요</option>
            {candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={!candidateToAdd || saving || conflict || draft.blocks.length >= MAX_DATE_PLAN_BLOCKS}
          onClick={() => {
            const item = candidateById.get(candidateToAdd);
            if (item) addBlock(item.id, item.name, item.category === '맛집' || item.category === '카페' ? 'meal' : 'activity');
            setCandidateToAdd('');
          }}><Plus size={15}/> 장소 추가</button>
        <label>장소가 없는 일정 (선택)
          <input value={customName} maxLength={100} disabled={saving || conflict}
            placeholder="예: 휴식, 이동 준비" onChange={(event) => setCustomName(event.target.value)}/>
        </label>
        <button type="button" disabled={!customName.trim() || saving || conflict || draft.blocks.length >= MAX_DATE_PLAN_BLOCKS}
          onClick={() => addBlock(null, customName, 'other')}><Plus size={15}/> 일반 일정 추가</button>
      </div>
      {!draft.blocks.length && <p className="date-map-empty">아직 일정이 없어요. 후보 장소를 선택해서 첫 일정을 추가해 보세요.</p>}
      {draft.blocks.map((block, index) => {
        const times = timeline[index];
        const current = candidateById.get(block.primaryCandidateId ?? '');
        const missing = block.primaryCandidateId !== null && !current;
        const activity = durationAsHoursMinutes(block.activityMinutes);
        const travel = durationAsHoursMinutes(block.travelMinutes);
        return <article className="date-map-time-block" key={block.id}>
          <div className="date-map-time-block-head">
            <b>{index + 1}. {block.title}</b>
            <div>
              <button type="button" aria-label={block.title + ' 위로 이동'} disabled={saving || conflict || index === 0}
                onClick={() => edit((schedule) => ({ ...schedule, blocks: moveDatePlanBlock(schedule.blocks, index, index - 1) }))}><ArrowUp size={15}/></button>
              <button type="button" aria-label={block.title + ' 아래로 이동'} disabled={saving || conflict || index === draft.blocks.length - 1}
                onClick={() => edit((schedule) => ({ ...schedule, blocks: moveDatePlanBlock(schedule.blocks, index, index + 1) }))}><ArrowDown size={15}/></button>
              <button type="button" aria-label={block.title + ' 일정 삭제'} disabled={saving || conflict}
                onClick={() => edit((schedule) => ({ ...schedule, blocks: normalizeTimeBlocks(schedule.blocks.filter((item) => item.id !== block.id)) }))}><Trash2 size={15}/></button>
            </div>
          </div>
          <div className="date-map-time-summary">
            <span>{times.start ?? '시각 미정'} → {times.end ?? '시각 미정'}</span>
            <small>{block.travelMinutes ? '이동 후 ' + (times.nextStart ?? '다음날 또는 미정') : '이동 시간 없음'}</small>
          </div>
          {times.conflict && <p className="date-map-time-warning" role="status">고정 시작 시각이 앞 일정의 예상 종료·이동 시간보다 빨라요.</p>}
          {times.overflow && <p className="date-map-time-warning" role="status">자정을 넘었어요. 다음날 일정은 자동으로 이어지지 않아요.</p>}
          {missing && <p className="date-map-time-warning" role="alert">삭제된 장소가 포함되어 있어요. 장소를 다시 선택해 주세요.</p>}
          <div className="date-map-time-grid">
            <label>일정 이름<input value={block.title} maxLength={100} disabled={saving || conflict} onChange={(event) =>
              setBlock(block.id, (currentBlock) => ({ ...currentBlock, title: event.target.value }))}/></label>
            <label>종류<select value={block.kind} disabled={saving || conflict} onChange={(event) =>
              setBlock(block.id, (currentBlock) => ({ ...currentBlock, kind: event.target.value as Kind }))}>
              {(Object.keys(KINDS) as Kind[]).map((kind) => <option key={kind} value={kind}>{KINDS[kind]}</option>)}
            </select></label>
            <label>활동 시간 <span>시 · 분</span>
              <div className="date-map-time-duration">
                <input type="number" min={0} max={24} step={1} value={activity.hours} aria-label={block.title + ' 활동 시'}
                  disabled={saving || conflict} onChange={(event) => editDuration(block, 'activityMinutes', 'hours', Number(event.target.value))}/><span>시</span>
                <input type="number" min={0} max={59} step={1} value={activity.minutes} aria-label={block.title + ' 활동 분'}
                  disabled={saving || conflict} onChange={(event) => editDuration(block, 'activityMinutes', 'minutes', Number(event.target.value))}/><span>분</span>
              </div>
            </label>
            <label>다음 장소까지 이동 <span>시 · 분</span>
              <div className="date-map-time-duration">
                <input type="number" min={0} max={24} step={1} value={travel.hours} aria-label={block.title + ' 이동 시'}
                  disabled={saving || conflict} onChange={(event) => editDuration(block, 'travelMinutes', 'hours', Number(event.target.value))}/><span>시</span>
                <input type="number" min={0} max={59} step={1} value={travel.minutes} aria-label={block.title + ' 이동 분'}
                  disabled={saving || conflict} onChange={(event) => editDuration(block, 'travelMinutes', 'minutes', Number(event.target.value))}/><span>분</span>
              </div>
            </label>
            <label>고정 시작 (선택)
              <input type="time" value={block.fixedStart ?? ''} disabled={saving || conflict} onChange={(event) =>
                setBlock(block.id, (currentBlock) => ({ ...currentBlock, fixedStart: event.target.value || null }))}/>
            </label>
          </div>
          <details className="date-map-time-backups">
            <summary>이 시간대의 예비 장소 ({block.backupCandidateIds.length}곳)</summary>
            {candidates.filter((item) => item.id !== block.primaryCandidateId).map((item) =>
              <label key={item.id}><input type="checkbox" checked={block.backupCandidateIds.includes(item.id)}
                disabled={saving || conflict || (!block.backupCandidateIds.includes(item.id) && block.backupCandidateIds.length >= 10)}
                onChange={(event) => setBlock(block.id, (currentBlock) => ({ ...currentBlock, backupCandidateIds: event.target.checked
                  ? [...currentBlock.backupCandidateIds, item.id] : currentBlock.backupCandidateIds.filter((id) => id !== item.id) }))}/>
                {item.name}</label>)}
            {!candidates.length && <p>먼저 데이트 후보를 담아 주세요.</p>}
          </details>
        </article>;
      })}
      <div className="date-map-timetable-status" role="status">{status}{dirty && !saving ? ' · 미저장 변경 있음' : ''}</div>
      {error && <p className="date-map-time-warning" role="alert">{error}</p>}
      {conflict && <button type="button" className="date-map-primary" onClick={() => void reload()}>상대방의 최신 시간표 불러오기</button>}
      {!conflict && !dirty && <button type="button" className="date-map-time-reload" onClick={() => void reload()}>다른 기기의 변경 확인하기</button>}
      <p className="date-map-add-hint">아직 공동 확정 전 초안이에요. 최종 승인 및 승인 후 변경 제안 기능은 다음 단계에서 제공해요.</p>
    </>}
  </section>;
}
