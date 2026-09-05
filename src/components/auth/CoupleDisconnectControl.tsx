import { AlertTriangle, Unlink, X } from 'lucide-react';
import { useState } from 'react';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { disconnectCouple } from '../../lib/coupleDisconnect';
import '../../couple-disconnect.css';

export function CoupleDisconnectControl({ uid, connection, onDisconnected }: {
  uid: string;
  connection: RealCoupleConnection;
  onDisconnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const confirmDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setFeedback('');
    try {
      await disconnectCouple(uid, connection.coupleId, connection.partnerUid);
      onDisconnected();
      setOpen(false);
    } catch (cause) {
      console.error('[ROUTE couple disconnect]', cause);
      const message = cause instanceof Error ? cause.message : '';
      setFeedback(message === 'connection-changed' || message === 'connection-missing'
        ? '연결 상태가 이미 변경되었어요. 잠시 후 다시 확인해 주세요.'
        : '연결을 끊지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <button type="button" className="route-disconnect-trigger" onClick={() => { setFeedback(''); setOpen(true); }}>
      상대방과 연결 끊기
    </button>

    {open && <div className="route-disconnect-backdrop" role="dialog" aria-modal="true" aria-label="상대방과 연결 끊기" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section className="route-disconnect-dialog">
        <header className="route-disconnect-head">
          <div><span><Unlink size={18} /></span><strong>상대방과 연결을 끊을까요?</strong></div>
          <button type="button" className="route-disconnect-close" aria-label="닫기" disabled={busy} onClick={() => setOpen(false)}><X size={19} /></button>
        </header>
        <div className="route-disconnect-body">
          <p><strong>{connection.partnerProfile?.name || '상대방'}</strong>님과 연결된 공유 공간이 종료돼요.</p>
          <div className="route-disconnect-warning">
            <b><AlertTriangle size={14} /> 연결을 끊기 전에 확인해 주세요</b>
            <ul>
              <li>그동안 나눈 대화와 공유한 앨범·추억 기록이 더 이상 보이지 않을 수 있어요.</li>
              <li>일정, 위치 공유, 발자취 등 두 사람이 함께 사용한 기록도 접근할 수 없게 될 수 있어요.</li>
              <li>연결을 끊은 뒤 다시 연결하더라도 이전 기록을 자동으로 복구하지 못할 수 있어요.</li>
            </ul>
          </div>
          {feedback && <p className="route-disconnect-feedback">{feedback}</p>}
          <div className="route-disconnect-actions">
            <button type="button" className="route-disconnect-cancel" disabled={busy} onClick={() => setOpen(false)}>취소</button>
            <button type="button" className="route-disconnect-confirm" disabled={busy} onClick={() => void confirmDisconnect()}>{busy ? '연결 끊는 중...' : '수락하고 연결 끊기'}</button>
          </div>
        </div>
      </section>
    </div>}
  </>;
}
