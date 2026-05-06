import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View } from 'react-native';
import * as Linking from 'expo-linking';

import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

import { PhoneScreen } from '../screens/PhoneScreen';
import { OtpScreen } from '../screens/OtpScreen';
import { ProfileSetupScreen } from '../screens/ProfileSetupScreen';
import { FeedScreen } from '../screens/FeedScreen';
import { PenaltyScreen } from '../screens/PenaltyScreen';
import { CreateGroupScreen } from '../screens/CreateGroupScreen';
import { JoinGroupScreen } from '../screens/JoinGroupScreen';
import { ExemptionRequestScreen } from '../screens/ExemptionRequestScreen';
import { LandingScreen } from '../screens/LandingScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function GroupTabs({ groupId, userId }: { groupId: string; userId: string }) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#FF5A5F',
        tabBarInactiveTintColor: '#aaa',
        tabBarStyle: { borderTopColor: '#eee' },
      }}
    >
      <Tab.Screen
        name="Feed"
        options={{ title: '인증 피드', tabBarIcon: ({ color }) => <TabIcon emoji="📸" color={color} /> }}
      >
        {() => <FeedScreen groupId={groupId} userId={userId} />}
      </Tab.Screen>
      <Tab.Screen
        name="Penalty"
        options={{ title: '벌금 현황', tabBarIcon: ({ color }) => <TabIcon emoji="💰" color={color} /> }}
      >
        {() => <PenaltyScreen groupId={groupId} userId={userId} />}
      </Tab.Screen>
      <Tab.Screen
        name="Exemption"
        options={{ title: '예외 신청', tabBarIcon: ({ color }) => <TabIcon emoji="🙏" color={color} /> }}
      >
        {() => <ExemptionRequestScreen groupId={groupId} userId={userId} onDone={() => {}} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

function TabIcon({ emoji, color }: { emoji: string; color: string }) {
  const { Text } = require('react-native');
  return <Text style={{ fontSize: 20, opacity: color === '#FF5A5F' ? 1 : 0.5 }}>{emoji}</Text>;
}

export function AppNavigator() {
  const { session, loading, userId } = useAuth();
  const [phone, setPhone] = useState('');
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [landingMode, setLandingMode] = useState<'choose' | 'create' | 'join'>('choose');

  // 딥링크: healthfam://join?code=ABC123
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    return () => sub.remove();
  }, []);

  function handleDeepLink(url: string) {
    const parsed = Linking.parse(url);
    if (parsed.path === 'join' && parsed.queryParams?.code) {
      setInviteCode(String(parsed.queryParams.code));
    }
  }

  // 로그아웃 시 상태 초기화
  useEffect(() => {
    if (!userId) {
      setLandingMode('choose');
      setActiveGroupId(null);
    }
  }, [userId]);

  // 세션 있으면 프로필 확인
  useEffect(() => {
    if (!userId) { setHasProfile(null); return; }
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single()
      .then(({ data }) => setHasProfile(!!data?.display_name));
  }, [userId]);

  // 그룹 조회
  useEffect(() => {
    if (!userId || !hasProfile) return;
    supabase
      .from('members')
      .select('group_id')
      .eq('user_id', userId)
      .order('joined_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data[0]) setActiveGroupId(data[0].group_id);
        else setActiveGroupId('none');
      });
  }, [userId, hasProfile]);

  if (loading || hasProfile === null && !!userId) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#FF5A5F" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          // 인증 플로우
          !phone ? (
            <Stack.Screen name="Phone">
              {() => <PhoneScreen onOtpSent={setPhone} />}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="Otp">
              {() => (
                <OtpScreen
                  phone={phone}
                  onVerified={() => setPhone('')}
                  onBack={() => setPhone('')}
                />
              )}
            </Stack.Screen>
          )
        ) : !hasProfile ? (
          <Stack.Screen name="ProfileSetup">
            {() => <ProfileSetupScreen userId={userId!} onComplete={() => setHasProfile(true)} />}
          </Stack.Screen>
        ) : activeGroupId === null ? (
          <Stack.Screen name="Loading">
            {() => (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#FF5A5F" />
              </View>
            )}
          </Stack.Screen>
        ) : activeGroupId === 'none' ? (
          // 그룹 없음 → 딥링크 초대 코드가 있으면 바로 참여, 없으면 선택 화면
          inviteCode ? (
            <Stack.Screen name="Join">
              {() => (
                <JoinGroupScreen
                  userId={userId!}
                  initialCode={inviteCode}
                  onJoined={(gid) => { setActiveGroupId(gid); setInviteCode(''); }}
                />
              )}
            </Stack.Screen>
          ) : landingMode === 'create' ? (
            <Stack.Screen name="CreateGroup">
              {() => (
                <CreateGroupScreen
                  userId={userId!}
                  onCreated={setActiveGroupId}
                />
              )}
            </Stack.Screen>
          ) : landingMode === 'join' ? (
            <Stack.Screen name="Join">
              {() => (
                <JoinGroupScreen
                  userId={userId!}
                  onJoined={(gid) => { setActiveGroupId(gid); setLandingMode('choose'); }}
                />
              )}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="Landing">
              {() => (
                <LandingScreen
                  onCreateGroup={() => setLandingMode('create')}
                  onJoinGroup={() => setLandingMode('join')}
                />
              )}
            </Stack.Screen>
          )
        ) : (
          <Stack.Screen name="Main">
            {() => <GroupTabs groupId={activeGroupId} userId={userId!} />}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
