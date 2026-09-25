import { doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { DatePlanTimeBlock } from './datePlanFoundation';
import { normalizeTimeBlocks, validateDatePlanSchedule, type DatePlanSchedule } from './datePlanTime';

const scheduleRef = (coupleId: string, planId: string) =>
  doc(db, 'couples', coupleId, 'datePlans', planId, 'schedule', 'draft');

export const EMPTY_DATE_PLAN_SCHEDULE: DatePlanSchedule = {
  startTime: '', blocks: [], revision: 0, updatedBy: '',
};

function fromSnapshot(data: Record<string, unknown> | undefined): DatePlanSchedule {
  if (!data) return { ...EMPTY_DATE_PLAN_SCHEDULE, blocks: [] };
  return {
    startTime: typeof data.startTime === 'string' ? data.startTime : '',
    blocks: Array.isArray(data.blocks) ? data.blocks as DatePlanTimeBlock[] : [],
    revision: typeof data.revision === 'number' ? data.revision : 0,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
    updatedAt: data.updatedAt,
  };
}

export function subscribeDatePlanSchedule(
  coupleId: string, planId: string,
  onChange: (schedule: DatePlanSchedule) => void, onError: (error: unknown) => void,
) {
  return onSnapshot(scheduleRef(coupleId, planId), (snap) => onChange(fromSnapshot(snap.data())), onError);
}

export async function readDatePlanSchedule(coupleId: string, planId: string) {
  const snap = await getDocFromServer(scheduleRef(coupleId, planId));
  return fromSnapshot(snap.data());
}

/** Optimistic revision prevents either partner overwriting an unseen edit. */
export async function saveDatePlanSchedule(
  coupleId: string, planId: string, uid: string,
  expectedRevision: number, startTime: string, blocks: DatePlanTimeBlock[], candidateIds: readonly string[],
): Promise<number> {
  const ordered = normalizeTimeBlocks(blocks);
  validateDatePlanSchedule(startTime, ordered, candidateIds);
  return runTransaction(db, async (transaction) => {
    const ref = scheduleRef(coupleId, planId);
    const existing = await transaction.get(ref);
    const revision = existing.exists() ? existing.data().revision as number : 0;
    if (revision !== expectedRevision) throw new Error('date-plan-schedule-conflict');
    const next = revision + 1;
    transaction.set(ref, {
      startTime, blocks: ordered, revision: next, updatedBy: uid, updatedAt: serverTimestamp(),
    });
    return next;
  });
}
