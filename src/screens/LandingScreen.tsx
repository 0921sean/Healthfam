import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Image,
} from 'react-native';

interface Props {
  onCreateGroup: () => void;
  onJoinGroup: () => void;
}

export function LandingScreen({ onCreateGroup, onJoinGroup }: Props) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.hero}>
          <Text style={styles.emoji}>🏋️</Text>
          <Text style={styles.title}>healthfam</Text>
          <Text style={styles.subtitle}>
            친구들과 헬스 목표를 지키고{'\n'}못 지키면 회식비를 내세요
          </Text>
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.primaryBtn} onPress={onCreateGroup}>
            <Text style={styles.primaryBtnText}>새 모임 만들기</Text>
            <Text style={styles.primaryBtnSub}>방장으로 시작</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={onJoinGroup}>
            <Text style={styles.secondaryBtnText}>초대 코드로 참여</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 48,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  emoji: { fontSize: 64 },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#111',
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 4,
  },
  buttons: { gap: 12 },
  primaryBtn: {
    backgroundColor: '#FF5A5F',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#FF5A5F',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  primaryBtnSub: { color: '#fff', fontSize: 12, opacity: 0.75, marginTop: 2 },
  secondaryBtn: {
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#444', fontSize: 16, fontWeight: '600' },
});
