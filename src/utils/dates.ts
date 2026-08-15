const DAY = 86_400_000;

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function messageDateLabel(timestamp: string) {
  const date = new Date(timestamp);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const difference = Math.round((today.getTime() - target.getTime()) / DAY);
  if (difference === 0) return '오늘';
  if (difference === 1) return '어제';
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function messageTime(timestamp: string) {
  return new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
}

export function isSameMonthDay(date: string, target = new Date()) {
  const value = new Date(`${date}T00:00:00`);
  return value.getMonth() === target.getMonth() && value.getDate() === target.getDate() && value.getFullYear() < target.getFullYear();
}
