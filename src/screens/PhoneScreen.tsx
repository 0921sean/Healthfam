import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';

interface Props {
  onOtpSent: (phone: string) => void;
}

export function PhoneScreen({ onOtpSent }: Props) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendOtp() {
    const cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.length < 10) {
      Alert.alert('오류', '올바른 휴대폰 번호를 입력해주세요.');
      return;
    }
    // 한국 번호 → E.164 형식
    const e164 = '+82' + (cleaned.startsWith('0') ? cleaned.slice(1) : cleaned);

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
    setLoading(false);

    if (error) {
      Alert.alert('오류', error.message);
      return;
    }
    onOtpSent(e164);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>🏋️ healthfam</Text>
        <Text style={styles.title}>휴대폰 번호로 시작하기</Text>
        <Text style={styles.subtitle}>번호를 입력하면 인증 문자를 보내드려요.</Text>

        <TextInput
          style={styles.input}
          placeholder="010-0000-0000"
          placeholderTextColor="#aaa"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          maxLength={13}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={sendOtp}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>인증 문자 받기</Text>
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
  logo: {
    fontSize: 32,
    textAlign: 'center',
    marginBottom: 8,
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
    fontSize: 17,
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
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
