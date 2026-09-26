import { useEffect, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import {
  addDatePlanCandidateComment, deleteDatePlanCandidateComment, subscribeDatePlanCandidateComments,
} from '../../lib/datePlanOpinions';
import type { DatePlanCandidateComment } from '../../lib/datePlanFoundation';

function describeError(error: unknown) {
  const code = String((error as { code?: string })?.code ?? '');
  if (code.includes('permission-denied')) return '댓글을 읽거나 저장할 권한이 없어요. 두 사람의 연결 상태를 확인해 주세요.';
  return '댓글을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

/** Mounted only for the selected candidate, so other candidates don't create comment listeners. */
export function DatePlanCandidateFeedback({ coupleId, planId, candidateId, uid }: {
  coupleId: string; planId: string; candidateId: string; uid: string;
}) {
  return <CandidateFeedback key={`${coupleId}:${planId}:${candidateId}`} coupleId={coupleId} planId={planId} candidateId={candidateId} uid={uid} />;
}

function CandidateFeedback({ coupleId, planId, candidateId, uid }: {
  coupleId: string; planId: string; candidateId: string; uid: string;
}) {
  const [comments, setComments] = useState<DatePlanCandidateComment[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    return subscribeDatePlanCandidateComments(coupleId, planId, candidateId, (items) => {
      setComments(items); setLoading(false); setError('');
    }, (reason) => { setLoading(false); setError(describeError(reason)); });
  }, [coupleId, planId, candidateId]);

  const submit = async () => {
    const message = text.trim();
    if (!message || pending || !uid) return;
    setPending(true); setError('');
    try {
      await addDatePlanCandidateComment(coupleId, planId, candidateId, uid, message);
      setText('');
    } catch (reason) { setError(describeError(reason)); }
    finally { setPending(false); }
  };

  const remove = async (item: DatePlanCandidateComment) => {
    if (pending || item.authorUid !== uid) return;
    setPending(true); setError('');
    try { await deleteDatePlanCandidateComment(coupleId, planId, candidateId, item.id); }
    catch (reason) { setError(describeError(reason)); }
    finally { setPending(false); }
  };

  return <section className="date-map-plan-feedback" aria-label="장소 후보 댓글">
    <div className="date-map-plan-feedback-title"><MessageCircle size={15}/><strong>함께 나눈 이야기</strong><span>{comments.length}개</span></div>
    {loading && <p role="status">댓글을 불러오는 중이에요…</p>}
    {!loading && !comments.length && !error && <p>아직 댓글이 없어요. 이 장소에 대한 의견을 남겨 보세요.</p>}
    {comments.map((item) => <div key={item.id} className="date-map-plan-comment">
      <div><b>{item.authorUid === uid ? '나' : '상대방'}</b><p>{item.text}</p></div>
      {item.authorUid === uid && <button type="button" disabled={pending} aria-label="내 댓글 삭제" onClick={() => void remove(item)}><X size={14}/></button>}
    </div>)}
    <form className="date-map-plan-comment-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor={'date-plan-comment-' + candidateId}>댓글 남기기</label>
      <textarea id={'date-plan-comment-' + candidateId} value={text} maxLength={500} rows={2} disabled={pending || !uid}
        placeholder="예: 여기는 주말보다 평일에 가는 게 좋을 것 같아!"
        onChange={(event) => setText(event.target.value)}/>
      <div><span>{text.length}/500</span><button type="submit" disabled={pending || !text.trim() || !uid}>{pending ? '저장 중…' : '댓글 등록'}</button></div>
    </form>
    {error && <p role="alert" className="date-map-plan-feedback-error">{error}</p>}
  </section>;
}
