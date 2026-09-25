import { collection, doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { calculateDatePlanTimeline, validateDatePlanSchedule } from './datePlanTime';
import type { DatePlanTimeBlock, DatePlanCandidate } from './datePlanFoundation';
import { activityRef } from './coupleActivity';

export type DatePlanApprovalSnapshot = {
  title: string;
  date: string;
  startTime: string;
  blocks: DatePlanTimeBlock[];
  globalBackupCandidateIds: string[];
  scheduleRevision: number;
};

export type DatePlanApproval = {
  status: 'review' | 'confirmed' | 'change-review';
  requestedBy: string;
  proposedBy: string;
  approvedBy: Record<string, boolean>;
  confirmedSnapshot: DatePlanApprovalSnapshot;
  proposedSnapshot: DatePlanApprovalSnapshot;
  revision: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const planRef = (coupleId: string, planId: string) =>
  doc(db, 'couples', coupleId, 'datePlans', planId);
const scheduleRef = (coupleId: string, planId: string) =>
  doc(db, 'couples', coupleId, 'datePlans', planId, 'schedule', 'draft');
const approvalRef = (coupleId: string, planId: string) =>
  doc(db, 'couples', coupleId, 'datePlans', planId, 'approval', 'state');

export async function readDatePlanApproval(coupleId: string, planId: string): Promise<DatePlanApproval | null> {
  const snapshot = await getDocFromServer(approvalRef(coupleId, planId));
  return snapshot.exists() ? snapshot.data() as DatePlanApproval : null;
}

export function subscribeDatePlanApproval(
  coupleId: string, planId: string,
  onChange: (approval: DatePlanApproval | null) => void, onError: (error: unknown) => void,
) {
  return onSnapshot(approvalRef(coupleId, planId), { includeMetadataChanges: true }, (snapshot) => {
    // Do not turn an initial cache miss into "미확정 초안" before Firestore
    // has checked the server. That race made both devices show a request button
    // while an approval document already existed remotely.
    if (snapshot.metadata.fromCache && !snapshot.exists()) return;
    onChange(snapshot.exists() ? snapshot.data() as DatePlanApproval : null);
  }, onError);
}

export function validateApprovalSnapshot(snapshot: DatePlanApprovalSnapshot, candidates: readonly DatePlanCandidate[]) {
  if (!snapshot.title.trim() || snapshot.title.length > 100) throw new RangeError('최종 확정할 데이트 이름을 입력해 주세요.');
  if (snapshot.date !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date) ||
    Number.isNaN(Date.parse(snapshot.date + 'T00:00:00Z')))) throw new RangeError('데이트 날짜를 확인해 주세요.');
  if (!Number.isSafeInteger(snapshot.scheduleRevision) || snapshot.scheduleRevision < 1) {
    throw new RangeError('시간표가 아직 저장되지 않았어요.');
  }
  if (snapshot.blocks.length === 0) {
    throw new RangeError('최종 확정할 일정을 하나 이상 추가해 주세요.');
  }
  validateDatePlanSchedule(snapshot.startTime, snapshot.blocks, candidates.map((candidate) => candidate.id),
    snapshot.globalBackupCandidateIds);
  const timeline = calculateDatePlanTimeline(snapshot.startTime, snapshot.blocks);
  if (timeline.some((item) => item.conflict || item.overflow)) {
    throw new RangeError('시간표에 겹치는 일정이나 자정을 넘긴 일정이 있어요. 시간을 다시 확인해 주세요.');
  }
}

export async function requestDatePlanApproval(coupleId: string, planId: string, uid: string,
  candidates: readonly DatePlanCandidate[]) {
  return runTransaction(db, async (tx) => {
    const plan = await tx.get(planRef(coupleId, planId));
    const schedule = await tx.get(scheduleRef(coupleId, planId));
    const approval = await tx.get(approvalRef(coupleId, planId));
    const couple = await tx.get(doc(db, 'couples', coupleId));
    if (!plan.exists()) throw new Error('date-plan-missing');
    if (!schedule.exists()) throw new Error('date-plan-schedule-missing');
    if (approval.exists()) throw new Error('date-plan-approval-exists');
    const planData = plan.data();
    const data = schedule.data();
    const snapshot: DatePlanApprovalSnapshot = {
      title: planData.title, date: planData.date, startTime: data.startTime,
      blocks: data.blocks, globalBackupCandidateIds: data.globalBackupCandidateIds ?? [],
      scheduleRevision: data.revision,
    };
    validateApprovalSnapshot(snapshot, candidates);
    const recipientUid = (couple.data()?.memberUids as string[] | undefined)?.find((member) => member !== uid);
    if (!recipientUid) throw new Error('couple-membership-required');
    tx.set(activityRef(coupleId, 'plan-' + planId + '-1'), {
      id: 'plan-' + planId + '-1', authorUid: uid, recipientUid,
      kind: 'date-plan', sourceId: planId, revision: 1,
      title: '데이트 최종 확정 요청이 왔어요', detail: snapshot.title.slice(0, 100),
      target: { screen: 'date-plan', itemId: planId }, createdAt: serverTimestamp(),
    });
    tx.set(approvalRef(coupleId, planId), {
      status: 'review', requestedBy: uid, proposedBy: uid, approvedBy: { [uid]: true },
      confirmedSnapshot: snapshot, proposedSnapshot: snapshot,
      revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  });
}

export async function approveDatePlan(coupleId: string, planId: string, uid: string) {
  return runTransaction(db, async (tx) => {
    const ref = approvalRef(coupleId, planId);
    const existing = await tx.get(ref);
    if (!existing.exists()) throw new Error('date-plan-approval-changed');
    const value = existing.data() as DatePlanApproval;
    if ((value.status !== 'review' && value.status !== 'change-review') || value.proposedBy === uid) {
      throw new Error('date-plan-approval-changed');
    }
    const nextRevision = value.revision + 1;
    tx.set(activityRef(coupleId, 'plan-' + planId + '-' + nextRevision), {
      id: 'plan-' + planId + '-' + nextRevision, authorUid: uid, recipientUid: value.proposedBy,
      kind: 'date-plan', sourceId: planId, revision: nextRevision,
      title: value.status === 'review' ? '데이트 최종 확정 완료' : '데이트 변경안 승인 완료',
      detail: value.proposedSnapshot.title.slice(0, 100),
      target: { screen: 'date-plan', itemId: planId }, createdAt: serverTimestamp(),
    });
    tx.update(ref, {
      status: 'confirmed',
      approvedBy: { ...value.approvedBy, [uid]: true },
      confirmedSnapshot: value.status === 'change-review' ? value.proposedSnapshot : value.confirmedSnapshot,
      revision: value.revision + 1, updatedAt: serverTimestamp(),
    });
  });
}

export async function withdrawDatePlanReview(coupleId: string, planId: string) {
  return runTransaction(db, async (tx) => {
    const ref = approvalRef(coupleId, planId);
    const existing = await tx.get(ref);
    if (!existing.exists()) throw new Error('date-plan-approval-changed');
    const value = existing.data() as DatePlanApproval;
    if (value.status === 'review') tx.delete(ref);
    else if (value.status === 'change-review') tx.update(ref, {
      status: 'confirmed', revision: value.revision + 1, updatedAt: serverTimestamp(),
    });
    else throw new Error('date-plan-approval-changed');
  });
}

export async function proposeDatePlanChange(coupleId: string, planId: string, uid: string,
  proposed: DatePlanApprovalSnapshot, candidates: readonly DatePlanCandidate[]) {
  validateApprovalSnapshot(proposed, candidates);
  return runTransaction(db, async (tx) => {
    const ref = approvalRef(coupleId, planId);
    const current = await tx.get(ref);
    if (!current.exists()) throw new Error('date-plan-approval-changed');
    const approval = current.data() as DatePlanApproval;
    if (approval.status !== 'confirmed') throw new Error('date-plan-approval-changed');
    if (JSON.stringify(approval.confirmedSnapshot) === JSON.stringify(proposed)) throw new Error('date-plan-no-changes');
    const nextRevision = approval.revision + 1;
    const pair = await tx.get(doc(db, 'couples', coupleId));
    const recipientUid = (pair.data()?.memberUids as string[] | undefined)?.find((member) => member !== uid);
    if (!recipientUid) throw new Error('couple-membership-required');
    tx.set(activityRef(coupleId, 'plan-' + planId + '-' + nextRevision), {
      id: 'plan-' + planId + '-' + nextRevision, authorUid: uid, recipientUid,
      kind: 'date-plan', sourceId: planId, revision: nextRevision,
      title: '데이트 변경 제안', detail: proposed.title.slice(0, 100),
      target: { screen: 'date-plan', itemId: planId }, createdAt: serverTimestamp(),
    });
    // Keep original accepted schedule intact. Only a separate proposal is updated.
    tx.update(ref, {
      status: 'change-review', proposedBy: uid, approvedBy: { [uid]: true },
      proposedSnapshot: proposed, revision: approval.revision + 1, updatedAt: serverTimestamp(),
    });
  });
}
