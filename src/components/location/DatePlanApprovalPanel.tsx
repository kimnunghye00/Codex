import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Clock3, Send, ShieldCheck, X } from 'lucide-react';
import type { DatePlanCandidate, DatePlanTimeBlock } from '../../lib/datePlanFoundation';
import { durationAsHoursMinutes, durationFromHoursMinutes } from '../../lib/datePlanFoundation';
import {
  approveDatePlan, proposeDatePlanChange, requestDatePlanApproval, withdrawDatePlanReview,
  type DatePlanApproval, type DatePlanApprovalSnapshot,
} from '../../lib/datePlanApproval';
import { calculateDatePlanTimeline, moveDatePlanBlock, normalizeTimeBlocks } from '../../lib/datePlanTime';

type Props = {
  coupleId: string; planId: string; uid: string;
  candidates: DatePlanCandidate[];
  approval: DatePlanApproval | null;
  loading: boolean;
  draftReady: boolean;
  detailsReady: boolean;
};

const clone = (source: DatePlanApprovalSnapshot): DatePlanApprovalSnapshot => ({
  ...source, globalBackupCandidateIds: [...source.globalBackupCandidateIds],
  blocks: source.blocks.map((block) => ({ ...block, backupCandidateIds: [...block.backupCandidateIds] })),
});
const friendlyError = (reason: unknown) => {
  const text = String((reason as Error)?.message ?? '');
  if (reason instanceof RangeError) return text;
  if (text.includes('permission-denied')) return '권한이나 승인 상태가 변경되었어요. 화면을 새로 열어 확인해 주세요.';
  if (text.includes('date-plan-no-changes')) return '변경된 내용이 없어요.';
  if (text.includes('date-plan-approval-changed')) return '상대방이 먼저 승인 상태를 변경했어요. 최신 상태를 확인해 주세요.';
  return '승인 상태를 저장하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';
};
function Preview({ snapshot, candidates }: { snapshot: DatePlanApprovalSnapshot; candidates: DatePlanCandidate[] }) {
  const names = new Map(candidates.map((c) => [c.id, c.name]));
  const times = calculateDatePlanTimeline(snapshot.startTime, snapshot.blocks);
  return <div className="date-plan-approval-preview">
    <strong>{snapshot.title} · {snapshot.date}</strong>
    {snapshot.blocks.map((block, index) => <div key={block.id} className="date-plan-approval-preview-row">
      <span>{index + 1}. {names.get(block.primaryCandidateId ?? '') || block.title}</span>
      <small>{times[index].start || '미정'}–{times[index].end || '미정'} · 활동 {durationAsHoursMinutes(block.activityMinutes).hours}시 {durationAsHoursMinutes(block.activityMinutes).minutes}분 · 이동 {durationAsHoursMinutes(block.travelMinutes).hours}시 {durationAsHoursMinutes(block.travelMinutes).minutes}분</small>
    </div>)}
    <small>전체 예비 {snapshot.globalBackupCandidateIds.length}곳 · 저장된 시간표 기준 버전 {snapshot.scheduleRevision}</small>
  </div>;
}

function RevisionEditor({ base, candidates, busy, onSubmit, onClose }: {
  base: DatePlanApprovalSnapshot; candidates: DatePlanCandidate[]; busy: boolean;
  onSubmit: (value: DatePlanApprovalSnapshot) => Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => clone(base));
  const [error, setError] = useState('');
  const [adding, setAdding] = useState('');
  const timeline = useMemo(() => calculateDatePlanTimeline(draft.startTime, draft.blocks), [draft.startTime, draft.blocks]);
  const names = useMemo(() => new Map(candidates.map((item) => [item.id, item.name])), [candidates]);
  const change = (update: (current: DatePlanApprovalSnapshot) => DatePlanApprovalSnapshot) =>
    setDraft((current) => update(current));
  const editBlock = (id: string, update: (block: DatePlanTimeBlock) => DatePlanTimeBlock) =>
    change((current) => ({ ...current, blocks: current.blocks.map((block) => block.id === id ? update(block) : block) }));
  const setDuration = (block: DatePlanTimeBlock, field: 'activityMinutes' | 'travelMinutes', unit: 'hours' | 'minutes', input: string) => {
    const original = durationAsHoursMinutes(block[field]);
    const value = input === '' ? 0 : Number(input);
    try {
      const next = durationFromHoursMinutes(unit === 'hours' ? value : original.hours, unit === 'minutes' ? value : original.minutes);
      editBlock(block.id, (item) => ({ ...item, [field]: next })); setError('');
    } catch { setError('시간은 0~24시, 분은 0~59로 입력해 주세요.'); }
  };
  return <section className="date-plan-revision" aria-label="확정 일정 변경 제안">
    <h4>변경할 내용을 작성해 주세요</h4>
    <p className="date-map-add-hint">제안 중에는 기존 확정 일정이 그대로 유지돼요. 상대방이 승인한 후에만 변경이 반영돼요.</p>
    <label>데이트 이름<input maxLength={100} value={draft.title} disabled={busy}
      onChange={(event) => change((current) => ({ ...current, title: event.target.value }))}/></label>
    <label>데이트 날짜<input type="date" value={draft.date} disabled={busy}
      onChange={(event) => change((current) => ({ ...current, date: event.target.value }))}/></label>
    <label>시작 시각<input type="time" value={draft.startTime} disabled={busy}
      onChange={(event) => change((current) => ({ ...current, startTime: event.target.value }))}/></label>
    <label>장소 후보를 일정에 추가
      <select value={adding} disabled={busy || draft.blocks.length >= 20} onChange={(event) => setAdding(event.target.value)}>
        <option value="">추가할 장소</option>
        {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
      </select>
    </label>
    <button type="button" disabled={!adding || busy || draft.blocks.length >= 20} onClick={() => {
      const item = candidates.find((candidate) => candidate.id === adding);
      if (!item) return;
      const block: DatePlanTimeBlock = {
        id: crypto.randomUUID(), position: draft.blocks.length, title: item.name,
        kind: item.category === '맛집' || item.category === '카페' ? 'meal' : 'activity',
        primaryCandidateId: item.id, backupCandidateIds: [], activityMinutes: 60, travelMinutes: 0, fixedStart: null,
      };
      change((current) => ({ ...current, blocks: normalizeTimeBlocks([...current.blocks, block]) }));
      setAdding('');
    }}>+ 장소 일정에 추가</button>
    {draft.blocks.map((block, index) => {
      const activity = durationAsHoursMinutes(block.activityMinutes);
      const travel = durationAsHoursMinutes(block.travelMinutes);
      return <div key={block.id} className="date-plan-revision-block">
        <div className="date-map-time-block-head">
          <b>{index + 1}. {block.title}</b>
          <div>
            <button type="button" aria-label="위로" disabled={busy || index === 0}
              onClick={() => change((current) => ({ ...current, blocks: moveDatePlanBlock(current.blocks, index, index - 1) }))}><ArrowUp size={15}/></button>
            <button type="button" aria-label="아래로" disabled={busy || index === draft.blocks.length - 1}
              onClick={() => change((current) => ({ ...current, blocks: moveDatePlanBlock(current.blocks, index, index + 1) }))}><ArrowDown size={15}/></button>
            <button type="button" aria-label="일정 제거" disabled={busy}
              onClick={() => change((current) => ({ ...current, blocks: normalizeTimeBlocks(current.blocks.filter((item) => item.id !== block.id)) }))}><X size={15}/></button>
          </div>
        </div>
        <small>{timeline[index].start || '시각 미정'}–{timeline[index].end || '시각 미정'} {timeline[index].conflict && '· 시각 겹침'}</small>
        <label>장소<select disabled={busy} value={block.primaryCandidateId ?? ''}
          onChange={(event) => editBlock(block.id, (item) => ({ ...item, primaryCandidateId: event.target.value || null,
            backupCandidateIds: item.backupCandidateIds.filter((id) => id !== event.target.value) }))}>
          <option value="">장소 없는 일정</option>
          {candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>일정 이름<input disabled={busy} value={block.title} maxLength={100}
          onChange={(event) => editBlock(block.id, (item) => ({ ...item, title: event.target.value }))}/></label>
        <div className="date-plan-revision-times">
          {(['activityMinutes', 'travelMinutes'] as const).map((field) => {
            const duration = field === 'activityMinutes' ? activity : travel;
            return <div key={field}>
              <span>{field === 'activityMinutes' ? '활동 시간' : '다음 장소까지 이동'}</span>
              <div className="date-map-time-duration">
                <input type="number" min={0} max={24} step={1} disabled={busy} aria-label={block.title + ' ' + field + ' 시'} value={duration.hours}
                  onChange={(event) => setDuration(block, field, 'hours', event.target.value)}/><span>시</span>
                <input type="number" min={0} max={59} step={1} disabled={busy} aria-label={block.title + ' ' + field + ' 분'} value={duration.minutes}
                  onChange={(event) => setDuration(block, field, 'minutes', event.target.value)}/><span>분</span>
              </div>
            </div>;
          })}
        </div>
        <label>고정 시작 (선택)<input type="time" disabled={busy} value={block.fixedStart ?? ''}
          onChange={(event) => editBlock(block.id, (item) => ({ ...item, fixedStart: event.target.value || null }))}/></label>
        <details className="date-map-time-backups">
          <summary>시간대별 예비 장소 ({block.backupCandidateIds.length}곳)</summary>
          {candidates.filter((item) => item.id !== block.primaryCandidateId).map((item) => <label key={item.id}>
            <input type="checkbox" disabled={busy || (block.backupCandidateIds.length >= 10 && !block.backupCandidateIds.includes(item.id))}
              checked={block.backupCandidateIds.includes(item.id)}
              onChange={(event) => editBlock(block.id, (old) => ({ ...old, backupCandidateIds: event.target.checked
                ? [...old.backupCandidateIds, item.id] : old.backupCandidateIds.filter((id) => id !== item.id) }))}/>
            {item.name}</label>)}
        </details>
      </div>;
    })}
    <details className="date-map-time-backups">
      <summary>데이트 전체 예비 장소 ({draft.globalBackupCandidateIds.length}곳)</summary>
      {candidates.map((item) => <label key={item.id}>
        <input type="checkbox" disabled={busy || (draft.globalBackupCandidateIds.length >= 20 && !draft.globalBackupCandidateIds.includes(item.id))}
          checked={draft.globalBackupCandidateIds.includes(item.id)}
          onChange={(event) => change((current) => ({ ...current, globalBackupCandidateIds: event.target.checked
            ? [...current.globalBackupCandidateIds, item.id] : current.globalBackupCandidateIds.filter((id) => id !== item.id) }))}/>
        {names.get(item.id)}</label>)}
    </details>
    {error && <p role="alert" className="date-map-time-warning">{error}</p>}
    <div className="date-plan-approval-actions">
      <button type="button" disabled={busy} onClick={onClose}>취소</button>
      <button type="button" disabled={busy} onClick={() => void onSubmit(draft)}>상대방에게 변경 제안</button>
    </div>
  </section>;
}

export function DatePlanApprovalPanel({ coupleId, planId, uid, candidates, approval, loading, draftReady, detailsReady }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const act = async (task: () => Promise<unknown>, success: string, sentNotification?: boolean) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await task(); setEditing(false); setMessage(success);
      if (sentNotification) {
        window.dispatchEvent(new CustomEvent('route-local-notification', { detail: {
          actor: 'me', kind: 'date-plan', title: '최종 확정 요청을 보냈어요',
          detail: '상대방이 확인하면 이 데이트가 최종 확정돼요.',
          target: { screen: 'date-plan', itemId: planId },
        }}));
      }
    }
    catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  };
  const ownApproval = Boolean(approval?.approvedBy?.[uid]);
  return <section className="date-plan-approval-panel" aria-label="데이트 공동 승인">
    <div className="date-map-panel-header"><strong><ShieldCheck size={16}/> 최종 공동 승인</strong>
      <span>{loading ? '불러오는 중…'
        : approval?.status === 'confirmed' ? '두 사람 승인 완료'
        : approval?.status === 'review' ? (ownApproval ? '상대방 확인 대기' : '최종 확정 요청 도착')
        : approval?.status === 'change-review' ? (ownApproval ? '상대방 승인 대기' : '변경 제안 도착')
        : '미확정 초안'}</span></div>
    {loading && <p role="status">승인 상태를 확인하고 있어요…</p>}
    {!loading && !approval && <>
      <p className="date-map-add-hint">이름·날짜·시작 시각과 시간표를 저장한 뒤 승인 요청을 보내세요. 요청하면 현재 일정이 잠기고 상대방의 승인을 기다려요.</p>
      <button className="date-map-primary" type="button" disabled={busy || !draftReady || !detailsReady} onClick={() =>
        void act(() => requestDatePlanApproval(coupleId, planId, uid, candidates), '상대방에게 최종 확정을 요청했어요.', true)}>
        <Send size={15}/> 최종 확정 요청
      </button>
      {(!draftReady || !detailsReady) && <small>시간표의 자동 저장이 완료되고 데이트 정보에 미저장 변경이 없어야 요청할 수 있어요.</small>}
    </>}
    {!loading && approval && <>
      <Preview snapshot={approval.confirmedSnapshot} candidates={candidates}/>
      {approval.status === 'review' && <>
        <p className="date-map-add-hint">{ownApproval ? '내 승인 완료 · 상대방의 확인을 기다리고 있어요.' : '상대방이 보낸 최종 확정 요청이에요. 내용을 확인한 뒤 최종 확정을 수락해 주세요.'}</p>
        {!ownApproval && <button type="button" className="date-map-primary" disabled={busy} onClick={() =>
          void act(() => approveDatePlan(coupleId, planId, uid), '두 사람의 최종 승인이 완료됐어요.')}>
          <Check size={15}/> 최종 확정 수락
        </button>}
        <button type="button" disabled={busy} onClick={() =>
          void act(() => withdrawDatePlanReview(coupleId, planId), '승인 요청을 취소했어요. 다시 초안을 수정할 수 있어요.')}>승인 요청 취소 / 수정 요청</button>
      </>}
      {approval.status === 'confirmed' && <>
        <p className="date-map-add-hint">두 사람이 승인한 일정이에요. 확정 내용은 자동으로 변경되지 않으며 수정하려면 변경 제안과 상대방 승인이 필요해요.</p>
        {!editing && <button type="button" disabled={busy} onClick={() => { setEditing(true); setError(''); }}>확정 일정 변경 제안</button>}
        {editing && <RevisionEditor key={approval.revision} base={approval.confirmedSnapshot} candidates={candidates} busy={busy}
          onClose={() => setEditing(false)}
          onSubmit={async (proposed) => act(() => proposeDatePlanChange(coupleId, planId, uid, proposed, candidates),
            '상대방에게 확정 일정 변경을 제안했어요.')}/>}
      </>}
      {approval.status === 'change-review' && <>
        <p className="date-map-add-hint">{ownApproval ? '내 변경 제안 · 상대방 승인 대기 중이에요.' : '상대방의 변경 제안이 도착했어요. 기존 확정 일정과 비교해 주세요.'}</p>
        <h4>변경 제안 내용</h4>
        <Preview snapshot={approval.proposedSnapshot} candidates={candidates}/>
        {!ownApproval && <button type="button" className="date-map-primary" disabled={busy} onClick={() =>
          void act(() => approveDatePlan(coupleId, planId, uid), '두 사람의 승인으로 변경 제안이 반영됐어요.')}>
          <Check size={15}/> 변경 제안 승인
        </button>}
        <button type="button" disabled={busy} onClick={() =>
          void act(() => withdrawDatePlanReview(coupleId, planId), '변경 제안을 취소했어요. 기존 확정 일정은 유지돼요.')}>
          변경 제안 거절 / 취소
        </button>
      </>}
    </>}
    {message && <p role="status" className="date-plan-approval-success">{message}</p>}
    {error && <p role="alert" className="date-map-time-warning">{error}</p>}
  </section>;
}
