import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { getCurrentWeek, formatKRW } from '../lib/utils';
import type { Group, WeeklyStats, Penalty, Exemption } from '../types';

interface Props {
  groupId: string;
  userId: string;
}

export function PenaltyScreen({ groupId, userId }: Props) {
  const [group, setGroup] = useState<Group | null>(null);
  const [stats, setStats] = useState<WeeklyStats[]>([]);
  const [totalPool, setTotalPool] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingExemptions, setPendingExemptions] = useState<Exemption[]>([]);

  const { week, year } = getCurrentWeek();

  const load = useCallback(async () => {
    const [{ data: groupData }, { data: members }, { data: checkins }, { data: exemptions }, { data: penalties }] =
      await Promise.all([
        supabase.from('groups').select('*').eq('id', groupId).single(),
        supabase.from('members').select('user_id, display_name').eq('group_id', groupId),
        supabase
          .from('checkins')
          .select('user_id')
          .eq('group_id', groupId)
          .eq('week_number', week)
          .eq('year', year)
          .eq('flagged', false),
        supabase
          .from('exemptions')
          .select('*, profiles(display_name)')
          .eq('group_id', groupId)
          .eq('week_number', week)
          .eq('year', year),
        supabase
          .from('penalties')
          .select('user_id, amount')
          .eq('group_id', groupId)
          .eq('finalized', true),
      ]);

    if (!groupData || !members) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setGroup(groupData);

    // 멤버별 체크인 카운트
    const checkinMap: Record<string, number> = {};
    (checkins ?? []).forEach((c) => {
      checkinMap[c.user_id] = (checkinMap[c.user_id] ?? 0) + 1;
    });

    // 예외 처리: 승인된 경우 effective_target 조정
    const approvedExemptions: Record<string, number> = {};
    const pendingList: Exemption[] = [];
    (exemptions ?? []).forEach((e: any) => {
      if (e.status === 'approved') {
        approvedExemptions[e.user_id] = e.reduced_target;
      } else if (e.status === 'pending') {
        pendingList.push({ ...e, display_name: e.profiles?.display_name });
      }
    });
    setPendingExemptions(pendingList);

    // 주간 통계 계산
    const weeklyStats: WeeklyStats[] = members.map((m) => {
      const checkinCount = checkinMap[m.user_id] ?? 0;
      const effectiveTarget =
        approvedExemptions[m.user_id] !== undefined
          ? approvedExemptions[m.user_id]
          : groupData.weekly_target;
      const missed = Math.max(0, effectiveTarget - checkinCount);
      const penaltyAmount = missed * groupData.penalty_per_miss;
      return {
        user_id: m.user_id,
        display_name: m.display_name,
        checkin_count: checkinCount,
        effective_target: effectiveTarget,
        penalty_amount: penaltyAmount,
      };
    });
    setStats(weeklyStats);

    // 누적 회식 적립금 (확정된 벌금 합계)
    const pool = (penalties ?? []).reduce((sum, p) => sum + p.amount, 0);
    // 이번 주 예상 벌금 포함
    const thisWeek = weeklyStats.reduce((sum, s) => sum + s.penalty_amount, 0);
    setTotalPool(pool + thisWeek);

    setLoading(false);
    setRefreshing(false);
  }, [groupId, week, year]);

  useEffect(() => { load(); }, [load]);

  const isAdmin = group?.created_by === userId;

  async function handleExemption(exemption: Exemption, approve: boolean, newTarget?: number) {
    const updates: any = { status: approve ? 'approved' : 'rejected' };
    if (approve && newTarget !== undefined) updates.reduced_target = newTarget;

    await supabase.from('exemptions').update(updates).eq('id', exemption.id);
    load();
  }

  function showExemptionDialog(exemption: Exemption) {
    Alert.alert(
      `${exemption.display_name} 예외 신청`,
      `사유: ${REASON_LABELS[exemption.reason]}\n목표 횟수를 얼마로 조정할까요?`,
      [
        { text: '거절', style: 'destructive', onPress: () => handleExemption(exemption, false) },
        {
          text: '0회 (완전 면제)',
          onPress: () => handleExemption(exemption, true, 0),
        },
        {
          text: `${Math.floor((group?.weekly_target ?? 0) / 2)}회로 조정`,
          onPress: () => handleExemption(exemption, true, Math.floor((group?.weekly_target ?? 0) / 2)),
        },
      ]
    );
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#FF5A5F" /></View>;
  }

  return (
    <View style={styles.container}>
      {/* 회식 적립금 배너 */}
      <View style={styles.poolBanner}>
        <Text style={styles.poolLabel}>🍻 회식 적립금</Text>
        <Text style={styles.poolAmount}>{formatKRW(totalPool)}</Text>
        <Text style={styles.poolSub}>{week}주차 예상 포함</Text>
      </View>

      {/* 방장: 대기 중 예외 신청 */}
      {isAdmin && pendingExemptions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⏳ 예외 신청 대기 ({pendingExemptions.length})</Text>
          {pendingExemptions.map((e) => (
            <TouchableOpacity key={e.id} style={styles.exemptionCard} onPress={() => showExemptionDialog(e)}>
              <Text style={styles.exemptionName}>{e.display_name}</Text>
              <Text style={styles.exemptionReason}>{REASON_LABELS[e.reason]}</Text>
              <Text style={styles.exemptionAction}>처리하기 →</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* 멤버별 현황 */}
      <FlatList
        data={stats}
        keyExtractor={(item) => item.user_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <Text style={styles.sectionTitle}>이번 주 현황 ({week}주차)</Text>
        }
        renderItem={({ item }) => {
          const isMe = item.user_id === userId;
          const progressPct = Math.min(1, item.checkin_count / (item.effective_target || 1));
          return (
            <View style={[styles.memberCard, isMe && styles.memberCardMe]}>
              <View style={styles.memberHeader}>
                <Text style={styles.memberName}>
                  {item.display_name} {isMe ? '(나)' : ''}
                </Text>
                <Text style={[styles.memberPenalty, item.penalty_amount > 0 && styles.memberPenaltyRed]}>
                  {item.penalty_amount > 0 ? `-${formatKRW(item.penalty_amount)}` : '✅ 완료'}
                </Text>
              </View>

              {/* 진행 바 */}
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${progressPct * 100}%` }]} />
              </View>

              <Text style={styles.memberSub}>
                {item.checkin_count} / {item.effective_target}회
                {item.effective_target < (group?.weekly_target ?? 0) && ' (예외 적용)'}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const REASON_LABELS: Record<string, string> = {
  military: '군대',
  travel: '여행',
  injury: '부상/질병',
  other: '기타',
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9F9F9' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  poolBanner: {
    backgroundColor: '#FF5A5F',
    paddingTop: 60,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  poolLabel: { fontSize: 14, color: '#fff', opacity: 0.8 },
  poolAmount: { fontSize: 36, fontWeight: '800', color: '#fff', marginTop: 4 },
  poolSub: { fontSize: 12, color: '#fff', opacity: 0.7, marginTop: 4 },
  section: { paddingHorizontal: 20, paddingTop: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#444', marginBottom: 10, paddingHorizontal: 20, paddingTop: 16 },
  exemptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 8,
  },
  exemptionName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#111' },
  exemptionReason: { fontSize: 13, color: '#666' },
  exemptionAction: { fontSize: 13, color: '#FF5A5F', fontWeight: '600' },
  listContent: { paddingBottom: 40 },
  memberCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 10,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  memberCardMe: {
    borderWidth: 2,
    borderColor: '#FF5A5F',
  },
  memberHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  memberName: { fontSize: 15, fontWeight: '600', color: '#111' },
  memberPenalty: { fontSize: 15, fontWeight: '700', color: '#22C55E' },
  memberPenaltyRed: { color: '#FF5A5F' },
  progressBg: {
    height: 6,
    backgroundColor: '#F0F0F0',
    borderRadius: 3,
    marginBottom: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FF5A5F',
    borderRadius: 3,
  },
  memberSub: { fontSize: 12, color: '#aaa' },
});
