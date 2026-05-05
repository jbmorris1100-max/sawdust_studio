import AsyncStorage from '@react-native-async-storage/async-storage';

const STATUS_KEY  = '@innergy_sync_status';
const PENDING_KEY = '@innergy_pending_count';

export async function getSyncStatus() {
  const [status, count] = await Promise.all([
    AsyncStorage.getItem(STATUS_KEY),
    AsyncStorage.getItem(PENDING_KEY),
  ]);
  return {
    ok:           status !== 'fail',
    pendingCount: parseInt(count ?? '0', 10),
  };
}

export async function setSyncStatus(ok) {
  await AsyncStorage.setItem(STATUS_KEY, ok ? 'ok' : 'fail');
}

export async function incrementPending() {
  const n = parseInt((await AsyncStorage.getItem(PENDING_KEY)) ?? '0', 10);
  await AsyncStorage.setItem(PENDING_KEY, String(n + 1));
}

export async function decrementPending() {
  const n = parseInt((await AsyncStorage.getItem(PENDING_KEY)) ?? '0', 10);
  await AsyncStorage.setItem(PENDING_KEY, String(Math.max(0, n - 1)));
}
