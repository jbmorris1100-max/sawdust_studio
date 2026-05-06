import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  SafeAreaView, StatusBar, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { storeTenant } from '../lib/tenant';
import { testConnection } from '../lib/innergy';
import InlineIQLogo from '../components/InlineIQLogo';

const C = {
  bg:      '#07090F',
  surface: '#0D1117',
  input:   '#111620',
  border:  '#1A2535',
  text:    '#FFFFFF',
  muted:   '#2D8A94',
  accent:  '#00C5CC',
  success: '#22c55e',
  danger:  '#FF4444',
  blue:    '#3b82f6',
};

const ROLE_OPTIONS = ['Owner', 'Shop Supervisor', 'Crew Lead'];
const ERP_OPTIONS  = ['Innergy', 'Cabinet Vision', 'Microvellum', 'Other', 'No ERP — Skip'];

const DEFAULT_DEPTS = ['Production', 'Assembly', 'Finishing', 'Craftsman', 'Installation'];
const EXTRA_DEPTS   = ['Custom', 'Other'];

function ProgressDots({ total, current }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.dot, i === current && styles.dotActive]} />
      ))}
    </View>
  );
}

// ── Screen 1: Welcome ─────────────────────────────────────────
function WelcomeScreen({ onSetup, onJoinCode }) {
  return (
    <View style={styles.screen}>
      <View style={styles.welcomeCenter}>
        <InlineIQLogo size="large" />
      </View>
      <View style={styles.welcomeActions}>
        <TouchableOpacity style={styles.primaryBtn} onPress={onSetup} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Set Up Your Shop</Text>
          <Ionicons name="arrow-forward" size={18} color="#000" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostBtn} onPress={onJoinCode} activeOpacity={0.8}>
          <Text style={styles.ghostBtnText}>I have a join code</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Screen 2: Shop Details ────────────────────────────────────
function ShopDetailsScreen({ shopName, setShopName, yourName, setYourName, role, setRole, onNext }) {
  const valid = shopName.trim() && yourName.trim();
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.screenPad} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepTitle}>Your shop</Text>
        <Text style={styles.stepSub}>We'll set everything up for you.</Text>

        <Text style={styles.fieldLabel}>SHOP NAME</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Morrison Cabinet Co."
          placeholderTextColor={C.muted}
          value={shopName}
          onChangeText={setShopName}
          autoFocus
        />

        <Text style={styles.fieldLabel}>YOUR NAME</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Mike Torres"
          placeholderTextColor={C.muted}
          value={yourName}
          onChangeText={setYourName}
        />

        <Text style={styles.fieldLabel}>YOUR ROLE</Text>
        <View style={styles.roleRow}>
          {ROLE_OPTIONS.map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.roleChip, role === r && styles.roleChipActive]}
              onPress={() => setRole(r)}
              activeOpacity={0.7}
            >
              <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, !valid && styles.btnDisabled, { marginTop: 32 }]}
          onPress={onNext}
          disabled={!valid}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Next</Text>
          <Ionicons name="arrow-forward" size={18} color="#000" />
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Screen 3: ERP Connection ──────────────────────────────────
function ERPScreen({ selectedERP, setSelectedERP, apiKey, setApiKey, testStatus, setTestStatus, onTest, onNext }) {
  const needsKey = selectedERP === 'Innergy';
  const isSkip   = selectedERP === 'No ERP — Skip' || (selectedERP && !needsKey);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.screenPad} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepTitle}>Connect your ERP</Text>
        <Text style={styles.stepSub}>Inline works standalone or connected to your ERP.</Text>

        <View style={styles.erpGrid}>
          {ERP_OPTIONS.map(erp => (
            <TouchableOpacity
              key={erp}
              style={[
                styles.erpChip,
                selectedERP === erp && styles.erpChipActive,
                erp === 'No ERP — Skip' && styles.erpChipSkip,
              ]}
              onPress={() => { setSelectedERP(erp); setTestStatus(null); }}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.erpChipText,
                selectedERP === erp && styles.erpChipTextActive,
                erp === 'No ERP — Skip' && styles.erpChipTextSkip,
              ]}>{erp}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {needsKey && (
          <View style={styles.erpKeyBlock}>
            <Text style={styles.fieldLabel}>INNERGY API KEY</Text>
            <TextInput
              style={styles.input}
              placeholder="Paste your API key here"
              placeholderTextColor={C.muted}
              value={apiKey}
              onChangeText={(v) => { setApiKey(v); setTestStatus(null); }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.helperText}>Find this in Innergy → Settings → API</Text>

            <TouchableOpacity
              style={[styles.testBtn, !apiKey.trim() && styles.btnDisabled]}
              onPress={onTest}
              disabled={!apiKey.trim()}
              activeOpacity={0.8}
            >
              <Text style={styles.testBtnText}>Test Connection</Text>
            </TouchableOpacity>

            {testStatus === 'ok' && (
              <View style={styles.testResult}>
                <Ionicons name="checkmark-circle" size={16} color={C.success} />
                <Text style={[styles.testResultText, { color: C.success }]}>Connected</Text>
              </View>
            )}
            {testStatus === 'fail' && (
              <View style={styles.testResult}>
                <Ionicons name="close-circle" size={16} color={C.danger} />
                <Text style={[styles.testResultText, { color: C.danger }]}>Invalid key — try again</Text>
              </View>
            )}
          </View>
        )}

        {isSkip && (
          <View style={styles.skipNote}>
            <Ionicons name="information-circle-outline" size={16} color={C.muted} />
            <Text style={styles.skipNoteText}>No problem. Inline works great on its own.</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, !selectedERP && styles.btnDisabled, { marginTop: 32 }]}
          onPress={onNext}
          disabled={!selectedERP}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Next</Text>
          <Ionicons name="arrow-forward" size={18} color="#000" />
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Screen 4: Departments ─────────────────────────────────────
function DepartmentsScreen({ selected, setSelected, customDept, setCustomDept, onAddCustom, onNext }) {
  const allDepts = [...DEFAULT_DEPTS, ...EXTRA_DEPTS];
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.screenPad} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepTitle}>Your departments</Text>
        <Text style={styles.stepSub}>Select all that apply.</Text>

        <View style={styles.deptGrid}>
          {allDepts.map(d => {
            const on = selected.includes(d);
            return (
              <TouchableOpacity
                key={d}
                style={[styles.deptChip, on && styles.deptChipActive]}
                onPress={() => setSelected(prev => on ? prev.filter(x => x !== d) : [...prev, d])}
                activeOpacity={0.7}
              >
                {on && <Ionicons name="checkmark" size={12} color={C.accent} style={{ marginRight: 4 }} />}
                <Text style={[styles.deptChipText, on && styles.deptChipTextActive]}>{d}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>ADD CUSTOM DEPARTMENT</Text>
        <View style={styles.customRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="e.g. Shipping"
            placeholderTextColor={C.muted}
            value={customDept}
            onChangeText={setCustomDept}
          />
          <TouchableOpacity
            style={[styles.addBtn, !customDept.trim() && styles.btnDisabled]}
            onPress={onAddCustom}
            disabled={!customDept.trim()}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={20} color="#000" />
          </TouchableOpacity>
        </View>

        {selected.filter(d => !allDepts.includes(d)).map(d => (
          <View key={d} style={styles.customTag}>
            <Text style={styles.customTagText}>{d}</Text>
            <TouchableOpacity onPress={() => setSelected(prev => prev.filter(x => x !== d))}>
              <Ionicons name="close" size={14} color={C.muted} />
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.primaryBtn, selected.length === 0 && styles.btnDisabled, { marginTop: 32 }]}
          onPress={onNext}
          disabled={selected.length === 0}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Next</Text>
          <Ionicons name="arrow-forward" size={18} color="#000" />
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Screen 5: Ready ───────────────────────────────────────────
function ReadyScreen({ shopName, saving, onGo }) {
  return (
    <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center', gap: 20 }]}>
      <View style={styles.checkCircle}>
        <Ionicons name="checkmark" size={40} color={C.success} />
      </View>
      <Text style={styles.readyTitle}>Your shop is ready.</Text>
      <Text style={styles.readyShop}>{shopName}</Text>
      <TouchableOpacity
        style={[styles.primaryBtn, { marginTop: 16 }, saving && styles.btnDisabled]}
        onPress={onGo}
        disabled={saving}
        activeOpacity={0.85}
      >
        {saving
          ? <ActivityIndicator size="small" color="#000" />
          : <>
              <Text style={styles.primaryBtnText}>Go to Dashboard</Text>
              <Ionicons name="arrow-forward" size={18} color="#000" />
            </>
        }
      </TouchableOpacity>
    </View>
  );
}

// ── Main OnboardingFlow ───────────────────────────────────────
export default function OnboardingFlow({ onComplete }) {
  const [step, setStep] = useState(0);

  // Step 2
  const [shopName,  setShopName]  = useState('');
  const [yourName,  setYourName]  = useState('');
  const [role,      setRole]      = useState('Owner');

  // Step 3
  const [selectedERP, setSelectedERP] = useState('');
  const [apiKey,      setApiKey]      = useState('');
  const [testStatus,  setTestStatus]  = useState(null); // null | 'ok' | 'fail' | 'testing'

  // Step 4
  const [departments, setDepartments] = useState(['Production', 'Assembly', 'Finishing']);
  const [customDept,  setCustomDept]  = useState('');

  // Step 5
  const [saving, setSaving] = useState(false);

  const TOTAL = 4; // steps 1-4 show dots (welcome is 0, not counted)

  const handleTestConnection = async () => {
    setTestStatus('testing');
    // Temporarily inject key for test
    const original = process.env.EXPO_PUBLIC_INNERGY_API_KEY;
    try {
      const res = await fetch('https://app.innergy.com/api/version', {
        headers: { 'Api-Key': apiKey.trim(), 'Content-Type': 'application/json' },
      });
      setTestStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setTestStatus('fail');
    }
  };

  const handleAddCustomDept = () => {
    const d = customDept.trim();
    if (!d || departments.includes(d)) return;
    setDepartments(prev => [...prev, d]);
    setCustomDept('');
  };

  const handleFinish = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const genericActivities = [
        'Shop Maintenance', 'Machine Maintenance', 'Cleaning', 'Training',
        'Material Handling', 'Shop Setup', 'Receiving', 'Warranty / Repair',
      ];

      const slug = shopName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + Date.now().toString(36);

      const tenantPayload = {
        shop_name:     shopName.trim(),
        slug,
        erp_type:      selectedERP === 'Innergy' ? 'innergy' : (selectedERP === 'No ERP — Skip' ? 'none' : selectedERP.toLowerCase()),
        innergy_api_key: selectedERP === 'Innergy' && apiKey.trim() ? apiKey.trim() : null,
        departments:   JSON.stringify(departments),
        generic_activities: JSON.stringify(genericActivities),
        subscription_status: 'trial',
      };

      const { data: tenant, error } = await supabase
        .from('tenants')
        .insert(tenantPayload)
        .select()
        .single();

      if (error) throw error;

      const tenantConfig = {
        ...tenant,
        departments,
        generic_activities: genericActivities,
      };

      await storeTenant(tenantConfig);
      onComplete(tenantConfig, yourName.trim(), role);
    } catch (e) {
      console.error('[OnboardingFlow] finish error:', e);
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {step > 0 && step < 5 && (
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => setStep(s => s - 1)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color={C.muted} />
          </TouchableOpacity>
          <ProgressDots total={4} current={step - 1} />
          <View style={{ width: 22 }} />
        </View>
      )}

      {step === 0 && (
        <WelcomeScreen
          onSetup={() => setStep(1)}
          onJoinCode={() => setStep(1)}
        />
      )}
      {step === 1 && (
        <ShopDetailsScreen
          shopName={shopName}   setShopName={setShopName}
          yourName={yourName}   setYourName={setYourName}
          role={role}           setRole={setRole}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <ERPScreen
          selectedERP={selectedERP} setSelectedERP={setSelectedERP}
          apiKey={apiKey}           setApiKey={setApiKey}
          testStatus={testStatus}   setTestStatus={setTestStatus}
          onTest={handleTestConnection}
          onNext={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <DepartmentsScreen
          selected={departments}  setSelected={setDepartments}
          customDept={customDept} setCustomDept={setCustomDept}
          onAddCustom={handleAddCustomDept}
          onNext={() => setStep(4)}
        />
      )}
      {step === 4 && (
        <ReadyScreen
          shopName={shopName}
          saving={saving}
          onGo={handleFinish}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.bg },
  flex:    { flex: 1 },
  screen:  { flex: 1, paddingHorizontal: 24 },
  screenPad: { paddingHorizontal: 24, paddingBottom: 60, paddingTop: 8 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  dots: { flexDirection: 'row', gap: 6 },
  dot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  dotActive: { backgroundColor: C.accent, width: 18 },

  // Welcome
  welcomeCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  wordmark: { fontSize: 48, fontWeight: '800', color: C.text, letterSpacing: -2 },
  tagline:  { fontSize: 16, color: C.muted, letterSpacing: 0.3 },
  welcomeActions: { paddingBottom: 48, gap: 12 },

  // Steps
  stepTitle: { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -0.5, marginBottom: 6, marginTop: 8 },
  stepSub:   { fontSize: 14, color: C.muted, marginBottom: 28 },

  fieldLabel: {
    fontSize: 10, fontWeight: '700', color: C.muted,
    letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 8, marginTop: 20,
  },
  input: {
    backgroundColor: C.input, borderRadius: 14, borderWidth: 1.5, borderColor: C.border,
    color: C.text, fontSize: 16, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 4,
  },
  helperText: { fontSize: 11, color: C.muted, marginBottom: 12, marginTop: 4 },

  // Role chips
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  roleChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.input, borderWidth: 1.5, borderColor: C.border,
  },
  roleChipActive:     { backgroundColor: C.accent + '22', borderColor: C.accent },
  roleChipText:       { fontSize: 13, fontWeight: '600', color: C.muted },
  roleChipTextActive: { color: C.accent },

  // ERP grid
  erpGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  erpChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    backgroundColor: C.input, borderWidth: 1.5, borderColor: C.border,
  },
  erpChipActive:     { backgroundColor: C.accent + '22', borderColor: C.accent },
  erpChipSkip:       { borderStyle: 'dashed' },
  erpChipText:       { fontSize: 13, fontWeight: '600', color: C.muted },
  erpChipTextActive: { color: C.accent },
  erpChipTextSkip:   { color: C.muted },
  erpKeyBlock: { marginTop: 8 },

  testBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    paddingVertical: 12, marginTop: 8,
  },
  testBtnText: { color: C.text, fontSize: 14, fontWeight: '600' },
  testResult:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  testResultText: { fontSize: 13, fontWeight: '600' },

  skipNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 14, marginTop: 12,
  },
  skipNoteText: { fontSize: 13, color: C.muted, flex: 1 },

  // Dept grid
  deptGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  deptChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    backgroundColor: C.input, borderWidth: 1.5, borderColor: C.border,
  },
  deptChipActive:     { backgroundColor: C.accent + '22', borderColor: C.accent },
  deptChipText:       { fontSize: 13, fontWeight: '600', color: C.muted },
  deptChipTextActive: { color: C.accent },

  customRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 12 },
  addBtn: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center',
  },
  customTag: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6,
  },
  customTagText: { fontSize: 13, color: C.text, fontWeight: '600' },

  // Ready screen
  checkCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.success + '22', borderWidth: 2, borderColor: C.success + '44',
    justifyContent: 'center', alignItems: 'center',
  },
  readyTitle: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  readyShop:  { fontSize: 16, color: C.muted },

  // Buttons
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 16, paddingVertical: 18,
  },
  primaryBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
  ghostBtn: {
    alignItems: 'center', paddingVertical: 14,
    borderRadius: 14, borderWidth: 1.5, borderColor: C.border,
  },
  ghostBtnText: { color: C.muted, fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.35 },
});
