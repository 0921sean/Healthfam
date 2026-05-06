import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Share,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { getCurrentWeek } from '../lib/utils';
import type { CheckIn, Group } from '../types';

interface Props {
  groupId: string;
  userId: string;
}

export function FeedScreen({ groupId, userId }: Props) {
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [group, setGroup] = useState<Group | null>(null);
  const [myCount, setMyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { week, year } = getCurrentWeek();

  const load = useCallback(async () => {
    const [{ data: groupData }, { data: feedData }] = await Promise.all([
      supabase.from('groups').select('*').eq('id', groupId).single(),
      supabase
        .from('checkins')
        .select('*, profiles(display_name)')
        .eq('group_id', groupId)
        .eq('week_number', week)
        .eq('year', year)
        .order('checked_at', { ascending: false }),
    ]);

    if (groupData) setGroup(groupData);
    if (feedData) {
      const mapped = feedData.map((c: any) => ({
        ...c,
        display_name: c.profiles?.display_name ?? '멤버',
      }));
      setCheckins(mapped);
      setMyCount(mapped.filter((c: CheckIn) => c.user_id === userId).length);
    }
    setLoading(false);
    setRefreshing(false);
  }, [groupId, userId, week, year]);

  useEffect(() => {
    load();

    // Realtime: 체크인 추가/삭제 감지
    const channel = supabase
      .channel(`feed-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins', filter: `group_id=eq.${groupId}` }, () => load())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load, groupId]);

  async function uploadCheckin() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 업로드를 위해 갤러리 접근 권한이 필요해요.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop() ?? 'jpg';
    const path = `${groupId}/${userId}/${Date.now()}.${ext}`;

    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const arrayBuffer = await new Response(blob).arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from('checkin-photos')
      .upload(path, arrayBuffer, { contentType: `image/${ext}` });

    if (uploadError) {
      setUploading(false);
      Alert.alert('오류', '사진 업로드에 실패했어요.');
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('checkin-photos')
      .getPublicUrl(path);

    const { error: insertError } = await supabase.from('checkins').insert({
      group_id: groupId,
      user_id: userId,
      photo_url: publicUrl,
      week_number: week,
      year,
    });

    setUploading(false);

    if (insertError) {
      Alert.alert('오류', '인증 등록에 실패했어요.');
      return;
    }

    load();
  }

  async function shareInvite() {
    if (!group) return;
    await Share.share({
      message: `healthfam 모임 "${group.name}"에 초대합니다!\n초대 코드: ${group.invite_code}\n앱 설치 후 코드를 입력해주세요.`,
    });
  }

  async function flagCheckin(checkinId: string) {
    await supabase.from('checkins').update({ flagged: true }).eq('id', checkinId);
    load();
  }

  const isAdmin = group?.created_by === userId;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF5A5F" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <View>
          <Text style={styles.groupName}>{group?.name ?? ''}</Text>
          <Text style={styles.weekLabel}>{week}주차 · 내 인증 {myCount}/{group?.weekly_target}회</Text>
        </View>
        <TouchableOpacity onPress={shareInvite} style={styles.inviteBtn}>
          <Text style={styles.inviteBtnText}>초대</Text>
        </TouchableOpacity>
      </View>

      {/* 피드 */}
      <FlatList
        data={checkins}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.feedContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>아직 이번 주 인증이 없어요. 첫 번째로 인증해보세요! 🏋️</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Image source={{ uri: item.photo_url }} style={styles.photo} />
            {item.flagged && (
              <View style={styles.flagBadge}>
                <Text style={styles.flagText}>⚠️ 이의제기</Text>
              </View>
            )}
            <View style={styles.cardFooter}>
              <Text style={styles.cardName}>{item.display_name}</Text>
              <Text style={styles.cardTime}>
                {new Date(item.checked_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
              </Text>
            </View>
            {isAdmin && !item.flagged && (
              <TouchableOpacity
                style={styles.flagBtn}
                onPress={() => Alert.alert(
                  '이의 제기',
                  `${item.display_name}님의 사진에 이의를 제기할까요?`,
                  [
                    { text: '취소', style: 'cancel' },
                    { text: '제기', style: 'destructive', onPress: () => flagCheckin(item.id) },
                  ]
                )}
              >
                <Text style={styles.flagBtnText}>⚠️</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />

      {/* 인증 버튼 */}
      <TouchableOpacity
        style={[styles.fab, uploading && styles.fabDisabled]}
        onPress={uploadCheckin}
        disabled={uploading}
      >
        {uploading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.fabText}>📸 인증하기</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9F9F9' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  groupName: { fontSize: 18, fontWeight: '700', color: '#111' },
  weekLabel: { fontSize: 13, color: '#666', marginTop: 2 },
  inviteBtn: {
    borderWidth: 1.5,
    borderColor: '#FF5A5F',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  inviteBtnText: { color: '#FF5A5F', fontSize: 13, fontWeight: '600' },
  feedContent: { padding: 12, paddingBottom: 100 },
  columnWrapper: { gap: 12 },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  photo: { width: '100%', aspectRatio: 1 },
  flagBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: '#fff3',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  flagText: { fontSize: 11 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
  },
  cardName: { fontSize: 13, fontWeight: '600', color: '#111' },
  cardTime: { fontSize: 11, color: '#aaa' },
  flagBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#fff',
    borderRadius: 16,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagBtnText: { fontSize: 14 },
  empty: {
    paddingTop: 60,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    lineHeight: 22,
  },
  fab: {
    position: 'absolute',
    bottom: 32,
    left: 24,
    right: 24,
    backgroundColor: '#FF5A5F',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#FF5A5F',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabDisabled: { opacity: 0.6 },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
