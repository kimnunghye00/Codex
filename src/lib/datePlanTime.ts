import type { DatePlanTimeBlock } from './datePlanFoundation';

export const MAX_DATE_PLAN_BLOCKS = 20;
const isClock = (clock: string): boolean => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock);
const pad = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export type DatePlanSchedule = {
  startTime: string;
  blocks: DatePlanTimeBlock[];
  revision: number;
  updatedBy: string;
  updatedAt?: unknown;
};

export type DatePlanTiming = {
  id: string;
  start: string | null;
  end: string | null;
  nextStart: string | null;
  conflict: boolean;
  overflow: boolean;
};

export function parseClock(clock: string): number {
  if (!isClock(clock)) throw new RangeError('시작 시간을 HH:mm 형식으로 입력해 주세요.');
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
}

/** Avoid wrapping 25:00 into a misleading 01:00 on the same date. */
function safeClock(total: number): string | null {
  return total >= 0 && total < 24 * 60 ? pad(total) : null;
}

export function normalizeTimeBlocks(blocks: DatePlanTimeBlock[]): DatePlanTimeBlock[] {
  return blocks.map((block, position) => ({ ...block, position, backupCandidateIds: [...block.backupCandidateIds] }));
}

export function validateDatePlanSchedule(startTime: string, blocks: DatePlanTimeBlock[], candidateIds: readonly string[]): void {
  if (startTime !== '' && !isClock(startTime)) throw new RangeError('시작 시간을 확인해 주세요.');
  if (blocks.length > MAX_DATE_PLAN_BLOCKS) throw new RangeError('시간표는 최대 20개까지 추가할 수 있어요.');
  const known = new Set(candidateIds);
  const ids = new Set<string>();
  blocks.forEach((block, index) => {
    if (!block.id || block.id.length > 100 || ids.has(block.id) || block.position !== index) {
      throw new RangeError('일정 순서와 식별자를 확인해 주세요.');
    }
    ids.add(block.id);
    if (!['activity', 'meal', 'other'].includes(block.kind) || !block.title.trim() || block.title.length > 100) {
      throw new RangeError('일정 이름과 종류를 확인해 주세요.');
    }
    for (const duration of [block.activityMinutes, block.travelMinutes]) {
      if (!Number.isSafeInteger(duration) || duration < 0 || duration > 1440) {
        throw new RangeError('활동 및 이동 시간은 각각 0~24시간으로 입력해 주세요.');
      }
    }
    if (block.fixedStart !== null && !isClock(block.fixedStart)) throw new RangeError('고정 시작 시간을 확인해 주세요.');
    if (block.primaryCandidateId !== null && !known.has(block.primaryCandidateId)) {
      throw new RangeError('삭제된 장소가 시간표에 포함돼 있어요. 장소를 다시 선택해 주세요.');
    }
    if (block.backupCandidateIds.length > 10 || new Set(block.backupCandidateIds).size !== block.backupCandidateIds.length
      || block.backupCandidateIds.some((id) => !known.has(id) || id === block.primaryCandidateId)) {
      throw new RangeError('예비 장소는 최대 10곳까지 중복 없이 선택해 주세요.');
    }
  });
}

export function calculateDatePlanTimeline(startTime: string, blocks: DatePlanTimeBlock[]): DatePlanTiming[] {
  let next: number | null = startTime ? parseClock(startTime) : null;
  return blocks.map((block) => {
    const fixed = block.fixedStart === null ? null : parseClock(block.fixedStart);
    const conflict = fixed !== null && next !== null && fixed < next;
    const start = fixed ?? next;
    if (start === null) {
      next = null;
      return { id: block.id, start: null, end: null, nextStart: null, conflict: false, overflow: false };
    }
    const end = start + block.activityMinutes;
    const nextTime = end + block.travelMinutes;
    const overflow = end >= 1440 || nextTime >= 1440;
    next = overflow ? null : nextTime;
    return { id: block.id, start: safeClock(start), end: safeClock(end), nextStart: safeClock(nextTime), conflict, overflow };
  });
}

export function moveDatePlanBlock(blocks: DatePlanTimeBlock[], from: number, to: number): DatePlanTimeBlock[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) {
    throw new RangeError('이동할 일정의 순서를 확인해 주세요.');
  }
  const output = [...blocks];
  const [moving] = output.splice(from, 1);
  output.splice(to, 0, moving);
  return normalizeTimeBlocks(output);
}
