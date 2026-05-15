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
  Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { getCurrentWeek } from '../lib/utils';
import type { CheckIn, Group } from '../types';

const EMOJIS = ['💪', '❤️', '😂'];
const SCREEN_W = Dimensions.get('window').width;

interface Props {
  groupId: string;
  userId: string;
}

function InitialAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const initial = name.charAt(0).toUpperCase();
  const colors = ['#FF5A5F', '#FF8C5A', '#5A9EFF', '#5AE3A0', '#C35AFF'];
  const bg = colors[name.charCodeAt(0) % colors.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.44 }}>{initial}</Text>
    </View>
  );
}

export function FeedScreen({ groupId, userId }: Props) {
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [group, setGroup] = useState<Group | null>(null);
  const [myCount, setMyCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({});

  const { week, year } = getCurrentWeek();

  const load = useCallback(async () => {
    const [{ data: groupData }, { data: feedData }, { data: membersData }, { data: reactionsData }] = await Promise.all([
      supabase.from('groups').select('*').eq('id', groupId).single(),
      supabase.from('checkins').select('*').eq('group_id', groupId).eq('week_number', week).eq('year', year).order('checked_at', { ascending: false }),
      supabase.from('members').select('user_id, display_name').eq('group_id', groupId),
      supabase.from('checkin_reactions').select('checkin_id, user_id, emoji'),
    ]);

    if (groupData) setGroup(groupData);
    if (membersData) setMemberCount(membersData.length);

    const reactionMap: Record<string, Record<string, string[]>> = {};
    (reactionsData ?? []).forEach((r: any) => {
      if (!reactionMap[r.checkin_id]) reactionMap[r.checkin_id] = {};
      if (!reactionMap[r.checkin_id][r.emoji]) reactionMap[r.checkin_id][r.emoji] = [];
      reactionMap[r.checkin_id][r.emoji].push(r.user_id);
    });
    setReactions(reactionMap);

    if (feedData) {
      const nameMap: Record<string, string> = {};
      (membersData ?? []).forEach((m: any) => { nameMap[m.user_id] = m.display_name; });

      const paths = feedData.map((c: any) => c.photo_url ?? '');
      let signedMap: Record<string, string> = {};
      try {
        const { data: signedData } = await supabase.storage.from('checkin-photos').createSignedUrls(paths, 604800);
        (signedData ?? []).forEach((s, i) => { if (s.signedUrl) signedMap[paths[i]] = s.signedUrl; });
      } catch (_) {}

      const mapped = feedData.map((c: any) => ({
        ...c,
        display_name: nameMap[c.user_id] ?? '멤버',
        photo_url: signedMap[c.photo_url] ?? c.photo_url,
      }));
      setCheckins(mapped);
      setMyCount(mapped.filter((c: CheckIn) => c.user_id === userId).length);

      // 이번 주 인증한 유니크 멤버 수
      const uniqueUsers = new Set(mapped.map((c: CheckIn) => c.user_id));
      setTotalCount(uniqueUsers.size);
    }
    setLoading(false);
    setRefreshing(false);
  }, [groupId, userId, week, year]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`feed-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins', filter: `group_id=eq.${groupId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkin_reactions' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, groupId]);

  async function uploadCheckin() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('권한 필요', '갤러리 접근 권한이 필요해요.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    const asset = result.assets[0];
    const contentType = asset.mimeType ?? 'image/jpeg';
    const ext = contentType.split('/')[1]?.toLowerCase() ?? 'jpeg';
    const path = `${groupId}/${userId}/${Date.now()}.${ext}`;

    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const blob = await (await fetch(asset.uri)).blob();

    const uploadRes = await fetch(
      `https://zpecibjusddegwdfowep.supabase.co/storage/v1/object/checkin-photos/${path}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body: blob }
    );

    if (!uploadRes.ok) { setUploading(false); Alert.alert('업로드 실패', await uploadRes.text()); return; }

    const { error } = await supabase.from('checkins').insert({ group_id: groupId, user_id: userId, photo_url: path, week_number: week, year });
    setUploading(false);
    if (error) { Alert.alert('오류', error.message); return; }
    load();
  }

  async function deleteCheckin(item: CheckIn) {
    Alert.alert('사진 삭제', '이 인증 사진을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => {
        await supabase.storage.from('checkin-photos').remove([item.photo_url]);
        await supabase.from('checkins').delete().eq('id', item.id);
        load();
      }},
    ]);
  }

  async function toggleReaction(checkinId: string, emoji: string) {
    const myReactions = reactions[checkinId]?.[emoji] ?? [];
    const alreadyReacted = myReactions.includes(userId);
    if (alreadyReacted) {
      await supabase.from('checkin_reactions').delete().eq('checkin_id', checkinId).eq('user_id', userId).eq('emoji', emoji);
    } else {
      await supabase.from('checkin_reactions').upsert({ checkin_id: checkinId, user_id: userId, emoji }, { onConflict: 'checkin_id,user_id' });
    }
    setReactions(prev => {
      const next = { ...prev, [checkinId]: { ...(prev[checkinId] ?? {}) } };
      const list = [...(next[checkinId][emoji] ?? [])];
      next[checkinId][emoji] = alreadyReacted ? list.filter(id => id !== userId) : [...list, userId];
      return next;
    });
  }

  const weekProgress = group ? Math.min(myCount / group.weekly_target, 1) : 0;

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#FF5A5F" /></View>;

  const ListHeader = (
    <View style={styles.statsBar}>
      <View style={styles.statItem}>
        <Text style={styles.statNum}>{myCount}</Text>
        <Text style={styles.statLabel}>내 인증</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <Text style={styles.statNum}>{group?.weekly_target ?? 0}</Text>
        <Text style={styles.statLabel}>주간 목표</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <Text style={styles.statNum}>{totalCount}/{memberCount}</Text>
        <Text style={styles.statLabel}>참여 인원</Text>
      </View>

      {/* 내 진행 바 */}
      <View style={styles.progressSection}>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${weekProgress * 100}%` }]} />
        </View>
        <Text style={styles.progressLabel}>
          {weekProgress >= 1 ? '✅ 이번 주 목표 달성!' : `${group?.weekly_target ? group.weekly_target - myCount : 0}회 남음`}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.groupName}>{group?.name ?? ''}</Text>
        <TouchableOpacity
          onPress={() => Share.share({ message: `healthfam 모임 "${group?.name}"에 초대합니다!\n초대 코드: ${group?.invite_code}` })}
          style={styles.inviteBtn}
        >
          <Text style={styles.inviteBtnText}>+ 초대</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.weekLabel}>{week}주차</Text>

      <FlatList
        data={checkins}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#FF5A5F" />}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.feedContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🏋️</Text>
            <Text style={styles.emptyTitle}>아직 인증이 없어요</Text>
            <Text style={styles.emptySubtitle}>오늘 헬스 가고 첫 인증을 남겨보세요!</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isOwn = item.user_id === userId;
          const checkinReactions = reactions[item.id] ?? {};
          return (
            <View style={styles.card}>
              {/* 카드 상단: 유저 정보 */}
              <View style={styles.cardHeader}>
                <InitialAvatar name={item.display_name} size={36} />
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardName}>{item.display_name} {isOwn && <Text style={styles.meTag}>(나)</Text>}</Text>
                  <Text style={styles.cardTime}>
                    {new Date(item.checked_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                  </Text>
                </View>
                {isOwn && (
                  <TouchableOpacity onPress={() => deleteCheckin(item)} style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>삭제</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* 사진 */}
              <Image source={{ uri: item.photo_url }} style={styles.photo} resizeMode="cover" />

              {/* 감정 반응 */}
              <View style={styles.reactionRow}>
                {EMOJIS.map(emoji => {
                  const count = (checkinReactions[emoji] ?? []).length;
                  const reacted = (checkinReactions[emoji] ?? []).includes(userId);
                  return (
                    <TouchableOpacity
                      key={emoji}
                      style={[styles.reactionBtn, reacted && styles.reactionBtnActive]}
                      onPress={() => toggleReaction(item.id, emoji)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.reactionEmoji}>{emoji}</Text>
                      {count > 0 && <Text style={[styles.reactionCount, reacted && styles.reactionCountActive]}>{count}</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        }}
      />

      {/* 인증 버튼 */}
      <TouchableOpacity style={[styles.fab, uploading && styles.fabDisabled]} onPress={uploadCheckin} disabled={uploading} activeOpacity={0.85}>
        {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.fabText}>📸  인증하기</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 2,
    backgroundColor: '#fff',
  },
  groupName: { fontSize: 20, fontWeight: '800', color: '#111', letterSpacing: -0.5 },
  weekLabel: { fontSize: 13, color: '#999', paddingHorizontal: 20, paddingBottom: 12, backgroundColor: '#fff' },
  inviteBtn: { backgroundColor: '#FF5A5F', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  inviteBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  statsBar: {
    backgroundColor: '#fff',
    marginHorizontal: 0,
    marginBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '800', color: '#111' },
  statLabel: { fontSize: 11, color: '#999', marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: '#EEE' },
  progressSection: { width: '100%', marginTop: 14 },
  progressBg: { height: 6, backgroundColor: '#F0F0F0', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#FF5A5F', borderRadius: 3 },
  progressLabel: { fontSize: 12, color: '#999', marginTop: 6, textAlign: 'right' },

  feedContent: { paddingBottom: 110 },

  card: {
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  cardHeaderText: { flex: 1 },
  cardName: { fontSize: 14, fontWeight: '700', color: '#111' },
  meTag: { fontSize: 12, fontWeight: '400', color: '#999' },
  cardTime: { fontSize: 12, color: '#aaa', marginTop: 1 },
  deleteBtn: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
  },
  deleteBtnText: { fontSize: 12, color: '#999' },

  photo: { width: SCREEN_W, height: SCREEN_W, backgroundColor: '#F2F2F7' },

  reactionRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  reactionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#F5F5F5', borderRadius: 20,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  reactionBtnActive: { backgroundColor: '#FFF0F0', borderColor: '#FFD0D0' },
  reactionEmoji: { fontSize: 16 },
  reactionCount: { fontSize: 13, color: '#666', fontWeight: '600' },
  reactionCountActive: { color: '#FF5A5F' },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#111', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#aaa', textAlign: 'center', lineHeight: 20 },

  fab: {
    position: 'absolute', bottom: 30, left: 24, right: 24,
    backgroundColor: '#FF5A5F', borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
    elevation: 6, shadowColor: '#FF5A5F', shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  fabDisabled: { opacity: 0.6 },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
});
