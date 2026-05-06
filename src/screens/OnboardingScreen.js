import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import InlineIQLogo from '../components/InlineIQLogo';

const STORAGE_KEY_NAME = '@inline_user_name';

const C = {
  bg:      '#07090F',
  surface: '#0D1117',
  input:   '#111620',
  border:  '#1A2535',
  text:    '#FFFFFF',
  muted:   '#2D8A94',
  accent:  '#00C5CC',
};

const BULLETS = [
  { icon: 'time-outline',        text: 'Clock in when your shift starts' },
  { icon: 'warning-outline',     text: 'Log any issues — damaged parts, missing materials' },
  { icon: 'chatbubble-outline',  text: 'Message the supervisor directly from the app' },
];

export default function OnboardingScreen({ onComplete }) {
  const [name,   setName]   = useState('');
  const [saving, setSaving] = useState(false);

  const handleGo = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    await AsyncStorage.setItem(STORAGE_KEY_NAME, name.trim());
    onComplete(name.trim());
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.inner}>
          <InlineIQLogo size="small" />
          <Text style={styles.heading}>Welcome to{'\n'}the crew.</Text>
          <Text style={styles.sub}>Let's get you set up quick.</Text>

          <View style={styles.bulletsWrap}>
            {BULLETS.map((b, i) => (
              <View key={i} style={styles.bullet}>
                <View style={styles.bulletIcon}>
                  <Ionicons name={b.icon} size={18} color={C.accent} />
                </View>
                <Text style={styles.bulletText}>{b.text}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.fieldLabel}>YOUR NAME</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Jake Morris"
            placeholderTextColor={C.muted}
            value={name}
            onChangeText={setName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleGo}
          />

          <TouchableOpacity
            style={[styles.goBtn, !name.trim() && styles.goBtnDisabled]}
            onPress={handleGo}
            disabled={!name.trim() || saving}
            activeOpacity={0.85}
          >
            <Text style={styles.goBtnText}>Got it, let's go</Text>
            <Ionicons name="arrow-forward" size={18} color="#000" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  kav:  { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },

  brand: {
    fontSize: 11,
    fontWeight: '700',
    color: C.accent,
    letterSpacing: 2,
    marginBottom: 14,
  },
  heading: {
    fontSize: 34,
    fontWeight: '800',
    color: C.text,
    letterSpacing: -0.5,
    lineHeight: 40,
    marginBottom: 8,
  },
  sub: {
    fontSize: 15,
    color: C.muted,
    marginBottom: 32,
  },

  bulletsWrap: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 16,
    marginBottom: 32,
    gap: 14,
  },
  bullet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  bulletIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: C.accent + '18',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
    paddingTop: 5,
  },

  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.muted,
    letterSpacing: 0.9,
    marginBottom: 10,
  },
  input: {
    backgroundColor: C.input,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    color: C.text,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },

  goBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 17,
  },
  goBtnDisabled: { opacity: 0.35 },
  goBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
