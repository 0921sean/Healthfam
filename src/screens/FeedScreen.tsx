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

const LIKE_EMOJI = '💪';

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

  async function toggleLike(checkinId: string) {
    const alreadyLiked = (reactions[checkinId]?.[LIKE_EMOJI] ?? []).includes(userId);
    if (alreadyLiked) {
      await supabase.from('checkin_reactions').delete().eq('checkin_id', checkinId).eq('user_id', userId).eq('emoji', LIKE_EMOJI);
    } else {
      await supabase.from('checkin_reactions').upsert({ checkin_id: checkinId, user_id: userId, emoji: LIKE_EMOJI }, { onConflict: 'checkin_id,user_id' });
    }
    setReactions(prev => {
      const next = { ...prev, [checkinId]: { ...(prev[checkinId] ?? {}) } };
      const list = [...(next[checkinId][LIKE_EMOJI] ?? [])];
      next[checkinId][LIKE_EMOJI] = alreadyLiked ? list.filter(id => id !== userId) : [...list, userId];
      return next;
    });
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#FF5A5F" /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.groupName}>{group?.name ?? ''}</Text>
          <Text style={styles.weekLabel}>{week}주차 · 내 인증 {myCount}/{group?.weekly_target}회</Text>
        </View>
        <TouchableOpacity onPress={() => Share.share({ message: `healthfam 모임 "${group?.name}"에 초대합니다!\n초대 코드: ${group?.invite_code}` })} style={styles.inviteBtn}>
          <Text style={styles.inviteBtnText}>초대</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={checkins}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#FF5A5F" />}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.feedContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🏋️</Text>
            <Text style={styles.emptyText}>아직 이번 주 인증이 없어요{'\n'}첫 번째로 인증해보세요!</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isOwn = item.user_id === userId;
          const likeCount = (reactions[item.id]?.[LIKE_EMOJI] ?? []).length;
          const liked = (reactions[item.id]?.[LIKE_EMOJI] ?? []).includes(userId);
          return (
            <View style={styles.card}>
              <Image source={{ uri: item.photo_url }} style={styles.photo} resizeMode="cover" />

              {/* 본인 사진 삭제 — 좌상단 연하게 */}
              {isOwn && (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteCheckin(item)} activeOpacity={0.7}>
                  <Text style={styles.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              )}

              {/* 💪 좋아요 — 우하단 overlay */}
              <TouchableOpacity style={styles.likeBtn} onPress={() => toggleLike(item.id)} activeOpacity={0.8}>
                <Text style={[styles.likeEmoji, liked && styles.likeEmojiActive]}>💪</Text>
                {likeCount > 0 && <Text style={[styles.likeCount, liked && styles.likeCountActive]}>{likeCount}</Text>}
              </TouchableOpacity>

              <View style={styles.cardFooter}>
                <Text style={styles.cardName} numberOfLines={1}>{item.display_name}</Text>
                <Text style={styles.cardTime}>
                  {new Date(item.checked_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <TouchableOpacity style={[styles.fab, uploading && styles.fabDisabled]} onPress={uploadCheckin} disabled={uploading} activeOpacity={0.85}>
        {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.fabText}>📸 인증하기</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 58, paddingBottom: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EFEFEF',
  },
  groupName: { fontSize: 18, fontWeight: '800', color: '#111', letterSpacing: -0.3 },
  weekLabel: { fontSize: 13, color: '#999', marginTop: 3 },
  inviteBtn: { borderWidth: 1.5, borderColor: '#FF5A5F', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  inviteBtnText: { color: '#FF5A5F', fontSize: 13, fontWeight: '700' },
  feedContent: { padding: 10, paddingBottom: 110 },
  columnWrapper: { gap: 10 },
  card: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 10,
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: '#F2F2F7' },
  deleteBtn: {
    position: 'absolute', top: 7, left: 7,
    backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 10,
    width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 11, color: '#fff', fontWeight: '600' },
  likeBtn: {
    position: 'absolute', bottom: 36, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 12,
    paddingHorizontal: 7, paddingVertical: 4,
  },
  likeEmoji: { fontSize: 14, opacity: 0.7 },
  likeEmojiActive: { opacity: 1 },
  likeCount: { fontSize: 11, color: '#fff', fontWeight: '700' },
  likeCountActive: { color: '#FFD0D0' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  cardName: { fontSize: 12, fontWeight: '700', color: '#111', flex: 1 },
  cardTime: { fontSize: 11, color: '#bbb' },
  empty: { paddingTop: 80, alignItems: 'center', paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 44, marginBottom: 14 },
  emptyText: { fontSize: 14, color: '#bbb', textAlign: 'center', lineHeight: 22 },
  fab: {
    position: 'absolute', bottom: 30, left: 20, right: 20,
    backgroundColor: '#FF5A5F', borderRadius: 16, paddingVertical: 16, alignItems: 'center',
    elevation: 5, shadowColor: '#FF5A5F', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 5 },
  },
  fabDisabled: { opacity: 0.6 },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
