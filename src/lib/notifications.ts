import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { NotificationMode } from '../types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  return token;
}

export function getReminderMessage(
  mode: NotificationMode,
  remaining: number,
  penalty: number
): { title: string; body: string } {
  if (mode === 'savage') {
    return {
      title: '야 헬스 안 가냐? 🏋️',
      body: `${remaining}번 더 가야 해. 지금 벌금 ${penalty.toLocaleString()}원 쌓이는 중. 이번 회식도 네가 사려고?`,
    };
  }
  return {
    title: '헬스... 안 가...? 🥺',
    body: `이번 주 목표까지 ${remaining}번 남았어요... 할 수 있을 것 같은데..`,
  };
}

export function getSettlementMessage(
  mode: NotificationMode,
  name: string,
  checkins: number,
  penaltyAmount: number,
  totalPool: number
): { title: string; body: string } {
  if (mode === 'savage') {
    return {
      title: '주간 정산 완료 💰',
      body: `${name}님 이번 주 ${checkins}번. 벌금 ${penaltyAmount.toLocaleString()}원. 회식 적립금 총 ${totalPool.toLocaleString()}원.`,
    };
  }
  return {
    title: '이번 주 정산이에요 📊',
    body: `${name}님 ${checkins}번 하셨어요. 벌금 ${penaltyAmount.toLocaleString()}원. 적립금 ${totalPool.toLocaleString()}원 모였어요!`,
  };
}
