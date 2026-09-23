import type { DateCourse } from './dateMap';

/** V2 drafts are separate from legacy dateCourses and the global datePlaces wish list. */
export type DatePlanDraft = {
  id: string;
  title: string; // May be empty while brainstorming.
  date: string; // YYYY-MM-DD or undecided ('').
  status: 'draft'; // Confirmations and proposals are introduced in a later phase.
  schemaVersion: 2;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type DatePlanCandidate = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category: '맛집' | '카페' | '놀거리' | '여행' | '기타';
  memo: string;
  /** Optional reference only; adding a candidate never writes to the global wish list. */
  sourceSavedPlaceId?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type CandidatePreference = 'want' | 'considering' | 'pass';

export type DatePlanTimeBlock = {
  id: string;
  kind: 'activity' | 'meal' | 'other';
  title: string;
  position: number;
  primaryCandidateId: string | null;
  backupCandidateIds: string[];
  /** Duration is persisted in minutes; the UI edits it with hour/minute inputs. */
  activityMinutes: number;
  travelMinutes: number;
  /** An optional fixed HH:mm time must not be overwritten by automatic recalculation. */
  fixedStart: string | null;
};

export type DatePlanLegacySummary = {
  id: string;
  source: 'legacy';
  title: string;
  date: string;
  /** Keep original ordering and IDs. No automatic rewrite of legacy data. */
  placeIds: string[];
  timeSlots: string[];
};

/** Read-only representation for existing courses until an explicit, tested migration is built. */
export function readLegacyDateCourse(course: DateCourse): DatePlanLegacySummary {
  return {
    id: course.id,
    source: 'legacy',
    title: course.title,
    date: course.date,
    placeIds: [...course.placeIds],
    timeSlots: course.placeIds.map((_, index) => course.timeSlots?.[index] ?? ''),
  };
}

/** UI duration fields use hours/minutes; storage uses one integer for predictable math. */
export function durationFromHoursMinutes(hours: number, minutes: number): number {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes > 59) {
    throw new RangeError('시간과 분을 다시 확인해 주세요.');
  }
  const total = hours * 60 + minutes;
  if (!Number.isSafeInteger(total) || total > 24 * 60) throw new RangeError('최대 24시간까지 설정할 수 있어요.');
  return total;
}
export function durationAsHoursMinutes(totalMinutes: number): { hours: number; minutes: number } {
  if (!Number.isSafeInteger(totalMinutes) || totalMinutes < 0 || totalMinutes > 24 * 60) {
    throw new RangeError('시간을 다시 확인해 주세요.');
  }
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}
