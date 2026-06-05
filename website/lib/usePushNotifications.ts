'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// applicationServerKey must be a Uint8Array (a raw base64url string is not
// accepted by most browsers), so convert the VAPID public key here.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function usePushNotifications({
  tenantId,
  userType,
  userName,
  dept,
}: {
  tenantId: string;
  userType: 'supervisor' | 'crew';
  userName?: string;
  dept?: string;
}) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const supported = pushSupported();

  useEffect(() => {
    if (supported) setPermission(Notification.permission);
  }, [supported]);

  async function subscribe() {
    if (!supported) return;
    try {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        console.error('Push subscribe failed: NEXT_PUBLIC_VAPID_PUBLIC_KEY missing');
        return;
      }

      // Register service worker
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;

      // Subscribe to push (reuse an existing subscription if present)
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));

      // Save to Supabase
      const subJson = sub.toJSON();
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) return;
      await supabase.from('push_subscriptions').upsert(
        {
          tenant_id: tenantId,
          user_type: userType,
          user_name: userName ?? null,
          dept: dept ?? null,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
        },
        { onConflict: 'endpoint' }
      );

      setSubscribed(true);
    } catch (e) {
      console.error('Push subscribe failed:', e);
    }
  }

  return { permission, subscribed, supported, subscribe };
}
