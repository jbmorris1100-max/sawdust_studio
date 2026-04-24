import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// expo-notifications has no web implementation — guard all native calls
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge:  true,
    }),
  });
}

/**
 * Request permission, get the Expo push token, and upsert it into
 * device_tokens. Safe to call on every app launch — the unique constraint
 * on token means it won't create duplicates.
 */
export async function registerForPushNotifications(userName, userDept) {
  if (Platform.OS === 'web') return null;
  // Push notifications require a physical device
  if (!Device.isDevice) {
    console.log('[Notifications] skipping — not a physical device');
    return null;
  }

  // Android needs an explicit notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name:              'default',
      importance:        Notifications.AndroidImportance.MAX,
      vibrationPattern:  [0, 250, 250, 250],
      lightColor:        '#F5A623',
    });
  }

  // Request permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] permission denied');
    return null;
  }

  // Resolve project ID from app.json extra.eas.projectId
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn('[Notifications] no projectId found — set expo.extra.eas.projectId in app.json');
    return null;
  }

  // Get the Expo push token
  let token;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch (err) {
    console.error('[Notifications] failed to get push token:', err);
    return null;
  }

  console.log('[Notifications] push token:', token);

  // Upsert into device_tokens — update name/dept if token already registered
  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      { token, name: userName, dept: userDept },
      { onConflict: 'token' }
    );

  if (error) {
    console.error('[Notifications] failed to save token:', error.message);
  } else {
    console.log('[Notifications] token saved for', userName);
  }

  return token;
}
