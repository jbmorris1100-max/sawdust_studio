import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T as C } from '../lib/theme';

export default function TrialExpiredScreen({ shopName }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={styles.container}>

        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed" size={40} color={C.muted} />
        </View>

        <Text style={styles.title}>Your 30-day trial has ended</Text>
        {shopName ? (
          <Text style={styles.shopName}>{shopName}</Text>
        ) : null}
        <Text style={styles.sub}>
          To keep using Inline, subscribe below.
        </Text>

        <View style={styles.priceCard}>
          <Text style={styles.price}>$399</Text>
          <Text style={styles.period}>/month</Text>
          <Text style={styles.priceNote}>Unlimited crew · All features · Cancel anytime</Text>
        </View>

        <TouchableOpacity
          style={styles.subscribeBtn}
          onPress={() => Linking.openURL('https://inlineiq.app/subscribe')}
          activeOpacity={0.85}
        >
          <Text style={styles.subscribeBtnText}>Subscribe Now</Text>
          <Ionicons name="arrow-forward" size={18} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.contactBtn}
          onPress={() => Linking.openURL('mailto:hello@inlineiq.app')}
          activeOpacity={0.8}
        >
          <Text style={styles.contactBtnText}>Contact Us</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export function TrialExpiredBanner({ onDismiss }) {
  return (
    <View style={styles.banner}>
      <Ionicons name="alert-circle-outline" size={14} color={C.danger} />
      <Text style={styles.bannerText}>Trial expired — contact your manager</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, paddingHorizontal: 28, justifyContent: 'center', gap: 16 },

  iconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    justifyContent: 'center', alignItems: 'center',
    alignSelf: 'center', marginBottom: 8,
  },
  title:    { fontSize: 24, fontWeight: '800', color: C.text, letterSpacing: -0.5, textAlign: 'center' },
  shopName: { fontSize: 14, color: C.muted, textAlign: 'center', marginTop: -8 },
  sub:      { fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 22 },

  priceCard: {
    backgroundColor: C.surface, borderRadius: 20, borderWidth: 1, borderColor: C.border,
    paddingVertical: 24, paddingHorizontal: 20,
    alignItems: 'center', gap: 4, marginVertical: 8,
  },
  price:     { fontSize: 48, fontWeight: '800', color: C.accent },
  period:    { fontSize: 18, color: C.muted, marginTop: -8 },
  priceNote: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 8 },

  subscribeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 16, paddingVertical: 18,
  },
  subscribeBtnText: { color: '#000', fontSize: 17, fontWeight: '800' },

  contactBtn: { alignItems: 'center', paddingVertical: 14 },
  contactBtnText: { color: C.muted, fontSize: 14, fontWeight: '600' },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(248,113,113,0.08)', paddingVertical: 10, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: 'rgba(248,113,113,0.2)',
  },
  bannerText: { color: C.danger, fontSize: 12, fontWeight: '600', flex: 1 },
});
