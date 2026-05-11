/**
 * ISO 주 번호와 연도를 반환 (KST 기준)
 * 주 경계: 월요일 00:00 KST
 */
export function getCurrentWeek(): { week: number; year: number } {
  const now = new Date();
  // KST = UTC+9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  const startOfYear = new Date(Date.UTC(kst.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((kst.getTime() - startOfYear.getTime()) / 86400000);
  const week = Math.max(1, Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7));

  return { week, year: kst.getUTCFullYear() };
}

export function formatKRW(amount: number): string {
  return amount.toLocaleString('ko-KR') + '원';
}

export function formatWeek(week: number, year: number): string {
  return `${year}년 ${week}주차`;
}

export function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export const EXEMPTION_REASON_LABELS: Record<string, string> = {
  military: '군대',
  travel: '여행',
  injury: '부상/질병',
  other: '기타',
};
