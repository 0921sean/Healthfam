/**
 * weekly-close Edge Function
 * 매주 월요일 00:05 KST (일요일 15:05 UTC) 실행
 *
 * Supabase Dashboard → Edge Functions 배포 후
 * cron 설정: select cron.schedule('weekly-close', '5 15 * * 0', $$
 *   select net.http_post(
 *     url := 'https://<project>.supabase.co/functions/v1/weekly-close',
 *     headers := '{"Authorization": "Bearer <service_role_key>"}'::jsonb
 *   ) as request_id;
 * $$);
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async () => {
  try {
    // 이전 주 계산 (현재 실행 시점 기준)
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    // 월요일 실행이므로 저번 주 = 7일 전
    const lastWeekDate = new Date(kst.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { week, year } = getWeekNumber(lastWeekDate);

    console.log(`Processing week ${week}, year ${year}`);

    // 모든 그룹 조회
    const { data: groups, error: groupsError } = await supabase
      .from('groups')
      .select('id, weekly_target, penalty_per_miss, mode, name');

    if (groupsError || !groups) throw groupsError;

    for (const group of groups) {
      await processGroup(group, week, year);
    }

    return new Response(JSON.stringify({ ok: true, week, year }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

async function processGroup(
  group: { id: string; weekly_target: number; penalty_per_miss: number; mode: string; name: string },
  week: number,
  year: number
) {
  // 해당 주 멤버 조회
  const { data: members } = await supabase
    .from('members')
    .select('user_id, display_name')
    .eq('group_id', group.id);

  if (!members?.length) return;

  // 체크인 집계
  const { data: checkins } = await supabase
    .from('checkins')
    .select('user_id')
    .eq('group_id', group.id)
    .eq('week_number', week)
    .eq('year', year)
    .eq('flagged', false);

  const checkinMap: Record<string, number> = {};
  (checkins ?? []).forEach((c) => {
    checkinMap[c.user_id] = (checkinMap[c.user_id] ?? 0) + 1;
  });

  // 승인된 예외 조회
  const { data: exemptions } = await supabase
    .from('exemptions')
    .select('user_id, reduced_target')
    .eq('group_id', group.id)
    .eq('week_number', week)
    .eq('year', year)
    .eq('status', 'approved');

  const exemptionMap: Record<string, number> = {};
  (exemptions ?? []).forEach((e) => { exemptionMap[e.user_id] = e.reduced_target; });

  // 벌금 계산 및 기록
  let totalPool = 0;
  for (const member of members) {
    const checkinCount = checkinMap[member.user_id] ?? 0;
    const effectiveTarget = exemptionMap[member.user_id] !== undefined
      ? exemptionMap[member.user_id]
      : group.weekly_target;
    const missed = Math.max(0, effectiveTarget - checkinCount);
    const amount = missed * group.penalty_per_miss;
    totalPool += amount;

    if (amount > 0 || missed === 0) {
      await supabase.from('penalties').upsert({
        group_id: group.id,
        user_id: member.user_id,
        week_number: week,
        year,
        missed_count: missed,
        amount,
        finalized: true,
      });
    }

    // 푸시 알림 발송 (push_token이 있는 경우)
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', member.user_id)
      .single();

    if (profile?.push_token) {
      await sendPushNotification(
        profile.push_token,
        group.mode as 'savage' | 'awkward',
        member.display_name,
        checkinCount,
        amount,
        totalPool
      );
    }
  }
}

async function sendPushNotification(
  token: string,
  mode: 'savage' | 'awkward',
  name: string,
  checkins: number,
  penalty: number,
  pool: number
) {
  const title = mode === 'savage' ? '주간 정산 완료 💰' : '이번 주 정산이에요 📊';
  const body = mode === 'savage'
    ? `${name}님 이번 주 ${checkins}번. 벌금 ${penalty.toLocaleString()}원. 회식 적립금 ${pool.toLocaleString()}원.`
    : `${name}님 ${checkins}번 하셨어요. 벌금 ${penalty.toLocaleString()}원. 적립금 ${pool.toLocaleString()}원 모였어요!`;

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: token, title, body, sound: 'default' }),
  });
}

function getWeekNumber(date: Date): { week: number; year: number } {
  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000);
  const week = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
  return { week, year: date.getUTCFullYear() };
}
