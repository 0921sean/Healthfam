import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Share,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { generateInviteCode, formatKRW } from '../lib/utils';
import type { NotificationMode } from '../types';

interface Props {
  userId: string;
  onCreated: (groupId: string) => void;
}

export function CreateGroupScreen({ userId, onCreated }: Props) {
  const [name, setName] = useState('');
  const [weeklyTarget, setWeeklyTarget] = useState('3');
  const [penaltyPerMiss, setPenaltyPerMiss] = useState('5000');
  const [mode, setMode] = useState<NotificationMode>('savage');
  const [loading, setLoading] = useState(false);

  async function createGroup() {
    if (!name.trim()) {
      Alert.alert('오류', '모임 이름을 입력해주세요.');
      return;
    }
    const target = parseInt(weeklyTarget, 10);
    const penalty = parseInt(penaltyPerMiss, 10);

    if (isNaN(target) || target < 1 || target > 7) {
      Alert.alert('오류', '주간 목표는 1~7회로 입력해주세요.');
      return;
    }
    if (isNaN(penalty) || penalty < 0) {
      Alert.alert('오류', '올바른 벌금액을 입력해주세요.');
      return;
    }

    setLoading(true);
    const inviteCode = generateInviteCode();

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .insert({
        name: name.trim(),
        weekly_target: target,
        penalty_per_miss: penalty,
        mode,
        created_by: userId,
        invite_code: inviteCode,
      })
      .select()
      .single();

    if (groupError || !group) {
      setLoading(false);
      Alert.alert('오류', '모임 생성에 실패했어요.');
      return;
    }

    // 방장을 멤버로 추가
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    await supabase.from('members').insert({
      group_id: group.id,
      user_id: userId,
      role: 'admin',
      display_name: profile?.display_name ?? '방장',
    });

    setLoading(false);
    onCreated(group.id);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>새 모임 만들기</Text>

      <Text style={styles.label}>모임 이름</Text>
      <TextInput
        style={styles.input}
        placeholder="예: 2024 헬스 챌린지"
        placeholderTextColor="#aaa"
        value={name}
        onChangeText={setName}
        maxLength={20}
      />

      <Text style={styles.label}>주간 목표 횟수</Text>
      <View style={styles.row}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.chip, weeklyTarget === String(n) && styles.chipActive]}
            onPress={() => setWeeklyTarget(String(n))}
          >
            <Text style={[styles.chipText, weeklyTarget === String(n) && styles.chipTextActive]}>
              {n}회
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>횟수 미달 1회당 벌금</Text>
      <View style={styles.row}>
        {['1000', '3000', '5000', '10000'].map((v) => (
          <TouchableOpacity
            key={v}
            style={[styles.chip, penaltyPerMiss === v && styles.chipActive]}
            onPress={() => setPenaltyPerMiss(v)}
          >
            <Text style={[styles.chipText, penaltyPerMiss === v && styles.chipTextActive]}>
              {formatKRW(parseInt(v))}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={[styles.input, { marginTop: 8 }]}
        placeholder="직접 입력 (숫자만)"
        placeholderTextColor="#aaa"
        keyboardType="number-pad"
        value={penaltyPerMiss}
        onChangeText={setPenaltyPerMiss}
      />

      <Text style={styles.label}>알림 모드</Text>
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeCard, mode === 'savage' && styles.modeCardActive]}
          onPress={() => setMode('savage')}
        >
          <Text style={styles.modeEmoji}>😤</Text>
          <Text style={styles.modeName}>사나운 모드</Text>
          <Text style={styles.modeDesc}>"야 헬스 안 가냐?{'\n'}회식도 네가 사려고?"</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeCard, mode === 'awkward' && styles.modeCardActive]}
          onPress={() => setMode('awkward')}
        >
          <Text style={styles.modeEmoji}>😶</Text>
          <Text style={styles.modeName}>어색한 사이</Text>
          <Text style={styles.modeDesc}>"헬스... 안 가...?{'\n'}이번 주 목표까지..."</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={createGroup}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>모임 만들기</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 28,
    color: '#111',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#444',
    marginBottom: 8,
    marginTop: 20,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
    color: '#111',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipActive: {
    borderColor: '#FF5A5F',
    backgroundColor: '#FFF0F0',
  },
  chipText: { fontSize: 14, color: '#555' },
  chipTextActive: { color: '#FF5A5F', fontWeight: '700' },
  modeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modeCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  modeCardActive: {
    borderColor: '#FF5A5F',
    backgroundColor: '#FFF8F8',
  },
  modeEmoji: { fontSize: 28, marginBottom: 6 },
  modeName: { fontSize: 13, fontWeight: '700', color: '#111', marginBottom: 4 },
  modeDesc: { fontSize: 11, color: '#666', textAlign: 'center', lineHeight: 16 },
  button: {
    backgroundColor: '#FF5A5F',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
