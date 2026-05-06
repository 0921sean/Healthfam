import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';

interface Props {
  userId: string;
  initialCode?: string;
  onJoined: (groupId: string) => void;
}

export function JoinGroupScreen({ userId, initialCode = '', onJoined }: Props) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [loading, setLoading] = useState(false);

  async function joinGroup() {
    if (code.trim().length < 6) {
      Alert.alert('오류', '6자리 초대 코드를 입력해주세요.');
      return;
    }

    setLoading(true);

    const { data: group, error } = await supabase
      .from('groups')
      .select('id, name')
      .eq('invite_code', code.trim().toUpperCase())
      .single();

    if (error || !group) {
      setLoading(false);
      Alert.alert('오류', '초대 코드를 찾을 수 없어요.');
      return;
    }

    // 이미 멤버인지 확인
    const { data: existing } = await supabase
      .from('members')
      .select('id')
      .eq('group_id', group.id)
      .eq('user_id', userId)
      .single();

    if (existing) {
      setLoading(false);
      onJoined(group.id);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    const { error: joinError } = await supabase.from('members').insert({
      group_id: group.id,
      user_id: userId,
      role: 'member',
      display_name: profile?.display_name ?? '멤버',
    });

    setLoading(false);

    if (joinError) {
      Alert.alert('오류', '모임 참여에 실패했어요.');
      return;
    }

    Alert.alert('환영해요!', `"${group.name}" 모임에 참여했어요.`, [
      { text: '확인', onPress: () => onJoined(group.id) },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>초대 코드 입력</Text>
        <Text style={styles.subtitle}>방장에게 받은 6자리 코드를 입력하세요.</Text>

        <TextInput
          style={styles.input}
          placeholder="ABC123"
          placeholderTextColor="#aaa"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          maxLength={6}
          autoCapitalize="characters"
          autoFocus={!initialCode}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={joinGroup}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>참여하기</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    color: '#111',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 24,
    letterSpacing: 6,
    textAlign: 'center',
    marginBottom: 16,
    color: '#111',
  },
  button: {
    backgroundColor: '#FF5A5F',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
