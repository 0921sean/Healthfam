/**
 * weekly-reminder Edge Function
 * 수요일 20:00 KST (11:00 UTC): 주중 리마인드
 * 토요일 10:00 KST (01:00 UTC): 주말 마지막 기회
 *
 * cron 설정 (Supabase Dashboard → Edge Functions → weekly-reminder → Schedule):
 *   수요일: 0 11 * * 3
 *   토요일: 0 1 * * 6
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function getWeekNumber(date: Date): { week: number; year: number } {
  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000);
  const week = Math.max(1, Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7));
  return { week, year: date.getUTCFullYear() };
}

Deno.serve(async () => {
  try {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const { week, year } = getWeekNumber(kst);

    const { data: groups } = await supabase
      .from('groups')
      .select('id, name, weekly_target, penalty_per_miss, mode');

    if (!groups?.length) return new Response(JSON.stringify({ ok: true, sent: 0 }));

    let sentCount = 0;

    for (const group of groups) {
      const { data: members } = await supabase
        .from('members')
        .select('user_id, display_name')
        .eq('group_id', group.id);

      if (!members?.length) continue;

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

      const { data: exemptions } = await supabase
        .from('exemptions')
        .select('user_id, reduced_target')
        .eq('group_id', group.id)
        .eq('week_number', week)
        .eq('year', year)
        .eq('status', 'approved');

      const exemptionMap: Record<string, number> = {};
      (exemptions ?? []).forEach((e) => { exemptionMap[e.user_id] = e.reduced_target; });

      for (const member of members) {
        const count = checkinMap[member.user_id] ?? 0;
        const target = exemptionMap[member.user_id] !== undefined ? exemptionMap[member.user_id] : group.weekly_target;
        const remaining = Math.max(0, target - count);

        if (remaining === 0) continue; // 이미 달성 → 알림 불필요

        const { data: profile } = await supabase
          .from('profiles')
          .select('push_token')
          .eq('id', member.user_id)
          .single();

        if (!profile?.push_token) continue;

        const penalty = remaining * group.penalty_per_miss;
        const isSavage = group.mode === 'savage';

        const title = isSavage ? '야 헬스 안 가냐? 🏋️' : '헬스... 안 가...? 🥺';
        const body = isSavage
          ? `${remaining}번 더 가야 해. 지금 벌금 ${penalty.toLocaleString()}원 쌓이는 중. 이번 회식도 네가 사려고?`
          : `이번 주 목표까지 ${remaining}번 남았어요... 할 수 있을 것 같은데..`;

        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: profile.push_token, title, body, sound: 'default' }),
        });
        sentCount++;
      }
    }

    return new Response(JSON.stringify({ ok: true, week, year, sent: sentCount }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
