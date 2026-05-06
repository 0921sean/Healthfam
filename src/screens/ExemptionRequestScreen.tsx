import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { getCurrentWeek } from '../lib/utils';

interface Props {
  groupId: string;
  userId: string;
  onDone: () => void;
}

type Reason = 'military' | 'travel' | 'injury' | 'other';

const REASONS: { key: Reason; label: string; desc: string }[] = [
  { key: 'military', label: '🪖 군대', desc: '군 복무 중' },
  { key: 'travel', label: '✈️ 여행', desc: '외출/여행으로 헬스장 이용 불가' },
  { key: 'injury', label: '🤕 부상/질병', desc: '부상이나 몸이 안 좋은 경우' },
  { key: 'other', label: '📝 기타', desc: '그 외 사정' },
];

export function ExemptionRequestScreen({ groupId, userId, onDone }: Props) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [detail, setDetail] = useState('');
  const [loading, setLoading] = useState(false);

  const { week, year } = getCurrentWeek();

  async function submit() {
    if (!reason) {
      Alert.alert('오류', '사유를 선택해주세요.');
      return;
    }

    setLoading(true);

    // 이미 신청했는지 확인
    const { data: existing } = await supabase
      .from('exemptions')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .eq('week_number', week)
      .eq('year', year)
      .single();

    if (existing) {
      setLoading(false);
      Alert.alert('이미 신청했어요', '이번 주 예외 신청이 이미 접수되어 있어요.');
      return;
    }

    const { data: groupData } = await supabase
      .from('groups')
      .select('weekly_target')
      .eq('id', groupId)
      .single();

    const { error } = await supabase.from('exemptions').insert({
      group_id: groupId,
      user_id: userId,
      week_number: week,
      year,
      reason,
      reason_detail: detail.trim() || null,
      reduced_target: groupData?.weekly_target ?? 0, // 방장이 나중에 조정
      status: 'pending',
    });

    setLoading(false);

    if (error) {
      Alert.alert('오류', '신청에 실패했어요.');
      return;
    }

    Alert.alert('신청 완료', '방장이 검토 후 처리할 거예요.', [
      { text: '확인', onPress: onDone },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>예외 신청</Text>
      <Text style={styles.subtitle}>이번 주 목표 횟수 조정을 방장에게 요청해요.</Text>

      <Text style={styles.label}>사유</Text>
      {REASONS.map((r) => (
        <TouchableOpacity
          key={r.key}
          style={[styles.reasonCard, reason === r.key && styles.reasonCardActive]}
          onPress={() => setReason(r.key)}
        >
          <Text style={styles.reasonLabel}>{r.label}</Text>
          <Text style={styles.reasonDesc}>{r.desc}</Text>
        </TouchableOpacity>
      ))}

      <Text style={[styles.label, { marginTop: 20 }]}>추가 설명 (선택)</Text>
      <TextInput
        style={styles.textArea}
        placeholder="예: 월~금 제주 여행, 토일에 2번 가능해요"
        placeholderTextColor="#aaa"
        value={detail}
        onChangeText={setDetail}
        multiline
        numberOfLines={3}
      />

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={submit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>신청하기</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: '#111', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 28 },
  label: { fontSize: 14, fontWeight: '600', color: '#444', marginBottom: 10 },
  reasonCard: {
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reasonCardActive: {
    borderColor: '#FF5A5F',
    backgroundColor: '#FFF8F8',
  },
  reasonLabel: { fontSize: 15, fontWeight: '600', color: '#111' },
  reasonDesc: { fontSize: 13, color: '#666', flex: 1 },
  textArea: {
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: '#111',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#FF5A5F',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
