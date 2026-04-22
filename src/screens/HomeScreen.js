import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

// ── Constants ─────────────────────────────────────────────────
const STORAGE_KEY_NAME = '@sawdust_user_name';
const STORAGE_KEY_DEPT = '@sawdust_user_dept';

const DEPARTMENTS = [
  'Cutting',
  'Edgebanding',
  'Assembly',
  'Finishing',
  'Craftsman',
  'Install',
];

const DEPT_COLORS = {
  Cutting:     { bg: '#172554', text: '#93c5fd' },
  Edgebanding: { bg: '#2e1065', text: '#c4b5fd' },
  Assembly:    { bg: '#052e16', text: '#86efac' },
  Finishing:   { bg: '#431407', text: '#fdba74' },
  Craftsman:   { bg: '#500724', text: '#f9a8d4' },
  Install:     { bg: '#4c0519', text: '#fca5a5' },
};

const ACTIONS = [
  { key: 'inventory', label: 'Log Inventory',     screen: 'LogInventory', icon: 'cube-outline',        accentColor: '#f59e0b' },
  { key: 'damage',    label: 'Report Damage',      screen: 'ReportDamage', icon: 'warning-outline',     accentColor: '#ef4444' },
  { key: 'scan',      label: 'Scan Part',          screen: 'ScanPart',     icon: 'scan-outline',        accentColor: '#3b82f6' },
  { key: 'message',   label: 'Message Supervisor', screen: 'Messages',     icon: 'chatbubble-outline',  accentColor: '#22c55e' },
];

// ── Main Component ────────────────────────────────────────────
export default function HomeScreen({ navigation, route }) {
  const { onResetRole } = route?.params ?? {};

  const [userName, setUserName]             = useState('');
  const [userDept, setUserDept]             = useState('');
  const [setupVisible, setSetupVisible]     = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [draftName, setDraftName]           = useState('');
  const [draftDept, setDraftDept]           = useState('');
  const [openInventory, setOpenInventory]   = useState(0);
  const [openDamage, setOpenDamage]         = useState(0);
  const [alertLoading, setAlertLoading]     = useState(false);

  useEffect(() => {
    (async () => {
      const [name, dept] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_NAME),
        AsyncStorage.getItem(STORAGE_KEY_DEPT),
      ]);
      if (name && dept) {
        setUserName(name);
        setUserDept(dept);
      } else {
        setSetupVisible(true);
      }
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (userDept) fetchAlerts(userDept);
    }, [userDept])
  );

  const fetchAlerts = async (dept) => {
    setAlertLoading(true);
    try {
      const [{ count: invCount }, { count: dmgCount }] = await Promise.all([
        supabase.from('inventory_needs').select('*', { count: 'exact', head: true }).eq('dept', dept).eq('status', 'pending'),
        supabase.from('damage_reports').select('*', { count: 'exact', head: true }).eq('dept', dept).eq('status', 'open'),
      ]);
      setOpenInventory(invCount ?? 0);
      setOpenDamage(dmgCount ?? 0);
    } catch (_) {
    } finally {
      setAlertLoading(false);
    }
  };

  const handleSaveSetup = async () => {
    if (!draftName.trim() || !draftDept) return;
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_NAME, draftName.trim()),
      AsyncStorage.setItem(STORAGE_KEY_DEPT, draftDept),
    ]);
    setUserName(draftName.trim());
    setUserDept(draftDept);
    setSetupVisible(false);
    fetchAlerts(draftDept);
  };

  const badgeFor = (key) => {
    if (key === 'inventory') return openInventory;
    if (key === 'damage')    return openDamage;
    return 0;
  };

  const totalAlerts = openInventory + openDamage;
  const deptStyle = DEPT_COLORS[userDept] ?? { bg: '#1f1f1f', text: '#888' };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>Sawdust Crew</Text>
          {userName ? (
            <View style={styles.userRow}>
              <Text style={styles.userName}>{userName}</Text>
              <View style={[styles.deptBadge, { backgroundColor: deptStyle.bg }]}>
                <Text style={[styles.deptBadgeText, { color: deptStyle.text }]}>{userDept}</Text>
              </View>
            </View>
          ) : null}
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            onPress={() => setSettingsVisible(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="settings-outline" size={24} color={C.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setDraftName(userName); setDraftDept(userDept); setSetupVisible(true); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="person-circle-outline" size={30} color={C.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Alert Banner */}
      {totalAlerts > 0 && (
        <View style={styles.alertBanner}>
          <View style={styles.alertDot} />
          {alertLoading
            ? <ActivityIndicator size="small" color={C.accent} />
            : <Text style={styles.alertText}>
                {totalAlerts} open alert{totalAlerts !== 1 ? 's' : ''} in {userDept}
              </Text>
          }
        </View>
      )}

      {/* Action Cards */}
      <View style={styles.grid}>
        {ACTIONS.map((action) => {
          const badge = badgeFor(action.key);
          return (
            <TouchableOpacity
              key={action.key}
              style={[styles.card, { borderLeftColor: action.accentColor }]}
              activeOpacity={0.7}
              onPress={() => navigation.navigate(action.screen, { userName, userDept })}
            >
              <View style={[styles.cardIconWrap, { backgroundColor: action.accentColor + '22' }]}>
                <Ionicons name={action.icon} size={24} color={action.accentColor} />
              </View>
              <Text style={styles.cardLabel}>{action.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={C.border} style={styles.cardChevron} />
              {badge > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Setup Modal */}
      <Modal visible={setupVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Who are you?</Text>

            <Text style={styles.fieldLabel}>Your Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Jake Morris"
              placeholderTextColor={C.muted}
              value={draftName}
              onChangeText={setDraftName}
              autoFocus
            />

            <Text style={styles.fieldLabel}>Department</Text>
            <FlatList
              data={DEPARTMENTS}
              keyExtractor={(d) => d}
              scrollEnabled={false}
              renderItem={({ item }) => {
                const dc = DEPT_COLORS[item] ?? { bg: '#1f1f1f', text: '#888' };
                const sel = draftDept === item;
                return (
                  <TouchableOpacity
                    style={[
                      styles.deptOption,
                      sel && { borderColor: dc.text, backgroundColor: dc.bg },
                    ]}
                    onPress={() => setDraftDept(item)}
                  >
                    <Text style={[styles.deptOptionText, sel && { color: dc.text, fontWeight: '700' }]}>
                      {item}
                    </Text>
                    {sel && <Ionicons name="checkmark-circle" size={18} color={dc.text} />}
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity
              style={[styles.saveBtn, (!draftName.trim() || !draftDept) && styles.saveBtnDisabled]}
              onPress={handleSaveSetup}
              disabled={!draftName.trim() || !draftDept}
            >
              <Text style={styles.saveBtnText}>Let's Go</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Settings Modal */}
      <Modal visible={settingsVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Settings</Text>

            <TouchableOpacity
              style={styles.settingsRow}
              onPress={() => { setSettingsVisible(false); setDraftName(userName); setDraftDept(userDept); setSetupVisible(true); }}
              activeOpacity={0.7}
            >
              <View style={[styles.settingsIcon, { backgroundColor: C.accent + '22' }]}>
                <Ionicons name="person-outline" size={18} color={C.accent} />
              </View>
              <Text style={styles.settingsRowText}>Change Name / Department</Text>
              <Ionicons name="chevron-forward" size={16} color={C.border} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsRow}
              onPress={async () => { setSettingsVisible(false); if (onResetRole) await onResetRole(); }}
              activeOpacity={0.7}
            >
              <View style={[styles.settingsIcon, { backgroundColor: '#3b82f622' }]}>
                <Ionicons name="swap-horizontal-outline" size={18} color="#3b82f6" />
              </View>
              <Text style={[styles.settingsRowText, { color: '#3b82f6' }]}>Switch Role</Text>
              <Ionicons name="chevron-forward" size={16} color={C.border} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsCancelBtn}
              onPress={() => setSettingsVisible(false)}
            >
              <Text style={styles.settingsCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Design tokens ─────────────────────────────────────────────
const C = {
  bg:          '#0d0d0d',
  surface:     '#141414',
  input:       '#1a1a1a',
  border:      '#2a2a2a',
  text:        '#e5e5e5',
  muted:       '#555555',
  accent:      '#f59e0b',
  accentDark:  '#d97706',
  danger:      '#ef4444',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: C.text,
    letterSpacing: -0.3,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 3,
  },
  userName: {
    fontSize: 14,
    color: C.muted,
    fontWeight: '500',
  },
  deptBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
  },
  deptBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Alert banner
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#1a1200',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#3d2e00',
  },
  alertDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.accent,
  },
  alertText: {
    color: C.accent,
    fontSize: 13,
    fontWeight: '600',
  },

  // Grid
  grid: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#222222',
    borderLeftWidth: 4,
    paddingVertical: 16,
    paddingLeft: 16,
    paddingRight: 14,
    gap: 14,
    position: 'relative',
  },
  cardIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.2,
  },
  cardChevron: { marginLeft: 4 },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: C.danger,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: C.text,
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  fieldLabel: {
    fontSize: 11,
    color: C.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 8,
    marginTop: 18,
  },
  input: {
    backgroundColor: C.input,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  deptOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: C.input,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  deptOptionText: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '500',
  },
  saveBtn: {
    marginTop: 22,
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },

  // Header icons
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },

  // Settings modal rows
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  settingsIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsRowText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  settingsCancelBtn: {
    marginTop: 18,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: C.input,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  settingsCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.muted,
  },
});
