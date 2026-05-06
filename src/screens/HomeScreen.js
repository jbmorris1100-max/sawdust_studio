import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList,
  Modal, SafeAreaView, StatusBar, Platform, ScrollView,
  KeyboardAvoidingView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { RoleContext } from '../lib/RoleContext';
import { EndDayContext } from '../lib/EndDayContext';
import { getEmployeeId, hasInnergy } from '../lib/innergy';
import { clockOutEmployee } from '../lib/clockOut';
import { getSyncStatus } from '../lib/syncQueue';
import { getTenant } from '../lib/tenant';
import InlineIQLogo from '../components/InlineIQLogo';

const STORAGE_KEY_NAME = '@inline_user_name';
const STORAGE_KEY_DEPT = '@inline_user_dept';
const LAST_READ_KEY    = '@inline_last_read';
const DEVICE_ID_KEY    = '@inline_device_id';
const CURRENT_TASK_KEY = '@inline_current_task';
const RECENT_JOBS_KEY  = '@inline_recent_jobs';

const GENERIC_ACTIVITIES = [
  'Shop Maintenance',  'Machine Maintenance',
  'Cleaning',          'Training',
  'Material Handling', 'Shop Setup',
  'Receiving',         'Warranty / Repair',
];

const DEPARTMENTS = ['Production', 'Assembly', 'Finishing', 'Craftsman'];

const DEPT_COLORS = {
  Production: { bg: '#172554', text: '#93c5fd' },
  Assembly:   { bg: '#052e16', text: '#86efac' },
  Finishing:  { bg: '#431407', text: '#fdba74' },
  Craftsman:  { bg: '#500724', text: '#f9a8d4' },
};

const C = {
  bg:       '#07090F',
  surface:  '#0D1117',
  input:    '#111620',
  border:   '#1A2535',
  text:     '#FFFFFF',
  muted:    '#2D8A94',
  accent:   '#00C5CC',
  danger:   '#FF4444',
  success:  '#22c55e',
};

const formatMsgTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sc = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(sc).padStart(2, '0')}`;
}

function formatTimeSince(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function HomeScreen({ navigation, route }) {
  const { onClearUnread } = route?.params ?? {};
  const resetRole = useContext(RoleContext);
  const endDay    = useContext(EndDayContext);

  const [userName, setUserName]   = useState('');
  const [userDept, setUserDept]   = useState('');
  const [setupVisible, setSetupVisible]   = useState(false);
  const [deptOnlyMode, setDeptOnlyMode]   = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDept, setDraftDept] = useState('');
  const [departments, setDepartments] = useState(DEPARTMENTS);

  const [currentTask, setCurrentTask] = useState(null);
  const [elapsed,     setElapsed]     = useState('');
  const [endingDay,   setEndingDay]   = useState(false);
  const [dayDone,     setDayDone]     = useState(false);

  const [recentMessages, setRecentMessages] = useState([]);
  const [lastSeenAt,     setLastSeenAt]     = useState('');
  const [openInventory,  setOpenInventory]  = useState(0);
  const [openDamage,     setOpenDamage]     = useState(0);
  const [isOnline,       setIsOnline]       = useState(null);
  const [syncOk,         setSyncOk]         = useState(true);

  const [settingsVisible,   setSettingsVisible]   = useState(false);
  const [switchVisible,     setSwitchVisible]     = useState(false);
  const [recentJobs,        setRecentJobs]        = useState([]);
  const [switchBanner,      setSwitchBanner]      = useState('');
  const switchBannerRef = useRef(null);

  const lastSeenAtRef = useRef('');
  const intervalRef   = useRef(null);
  useEffect(() => { lastSeenAtRef.current = lastSeenAt; }, [lastSeenAt]);

  // ── Load stored identity ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [name, dept, seen] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_NAME),
        AsyncStorage.getItem(STORAGE_KEY_DEPT),
        AsyncStorage.getItem(LAST_READ_KEY),
      ]);
      if (seen) setLastSeenAt(seen);
      if (name && dept) {
        setUserName(name); setUserDept(dept);
      } else if (name && !dept) {
        setUserName(name); setDraftName(name);
        setDeptOnlyMode(true); setSetupVisible(true);
      } else {
        setSetupVisible(true);
      }
      const { ok } = await getSyncStatus();
      setSyncOk(ok);

      // Load tenant departments
      const tenant = await getTenant();
      if (tenant?.departments) {
        try {
          const depts = typeof tenant.departments === 'string'
            ? JSON.parse(tenant.departments) : tenant.departments;
          if (Array.isArray(depts) && depts.length > 0) setDepartments(depts);
        } catch (_) {}
      }

      // Load recent jobs
      const raw = await AsyncStorage.getItem(RECENT_JOBS_KEY);
      if (raw) { try { setRecentJobs(JSON.parse(raw)); } catch (_) {} }
    })();
  }, []);

  // ── Elapsed timer ─────────────────────────────────────────────
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!currentTask?.startedAt) { setElapsed(''); return; }
    const tick = () => setElapsed(formatElapsed(Date.now() - new Date(currentTask.startedAt).getTime()));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [currentTask?.startedAt]);

  // ── Reload on focus ───────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(CURRENT_TASK_KEY).then(raw => {
      try { setCurrentTask(raw ? JSON.parse(raw) : null); } catch { setCurrentTask(null); }
    });
    AsyncStorage.getItem(RECENT_JOBS_KEY).then(raw => {
      if (raw) { try { setRecentJobs(JSON.parse(raw)); } catch (_) {} }
    });
    if (userDept) fetchAlerts(userDept);
    if (userName) {
      AsyncStorage.getItem(LAST_READ_KEY).then(seen => {
        const s = seen ?? '';
        if (s) setLastSeenAt(s);
        fetchRecentMessages(userName, s);
      });
    }
    getSyncStatus().then(({ ok }) => setSyncOk(ok));
  }, [userDept, userName]));

  // ── Real-time messages ────────────────────────────────────────
  useEffect(() => {
    if (!userName) return;
    const ch = supabase.channel('home-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
        if (p.new.sender_name === userName) return;
        setRecentMessages(prev => {
          const ls = lastSeenAtRef.current;
          if (ls && p.new.created_at <= ls) return prev;
          return [p.new, ...prev].slice(0, 3);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userName]);

  // ── Connection ping ───────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      try {
        const { error } = await supabase.from('messages').select('id').limit(1);
        const down = error?.message?.toLowerCase().includes('fetch') ||
                     error?.message?.toLowerCase().includes('network');
        setIsOnline(!down);
      } catch { setIsOnline(false); }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  const fetchAlerts = async (dept) => {
    try {
      const [{ count: inv }, { count: dmg }] = await Promise.all([
        supabase.from('inventory_needs').select('*', { count: 'exact', head: true }).eq('dept', dept).eq('status', 'pending'),
        supabase.from('damage_reports').select('*',  { count: 'exact', head: true }).eq('dept', dept).eq('status', 'open'),
      ]);
      setOpenInventory(inv ?? 0);
      setOpenDamage(dmg ?? 0);
    } catch (_) {}
  };

  const fetchRecentMessages = useCallback(async (name, seenAt) => {
    let q = supabase.from('messages').select('*').neq('sender_name', name)
      .order('created_at', { ascending: false }).limit(3);
    if (seenAt) q = q.gt('created_at', seenAt);
    const { data } = await q;
    if (data) setRecentMessages(data);
  }, []);

  // ── Quick Switch ──────────────────────────────────────────────
  const showSwitchBanner = (msg) => {
    setSwitchBanner(msg);
    if (switchBannerRef.current) clearTimeout(switchBannerRef.current);
    switchBannerRef.current = setTimeout(() => setSwitchBanner(''), 2000);
  };

  const handleQuickSwitch = async (item) => {
    setSwitchVisible(false);
    const now = new Date().toISOString();
    const name = await AsyncStorage.getItem(STORAGE_KEY_NAME) ?? userName;

    // Clock out previous
    const prevRaw = await AsyncStorage.getItem(CURRENT_TASK_KEY);
    if (prevRaw) {
      try {
        const prevTask = JSON.parse(prevRaw);
        const empId = prevTask.employeeId ?? (name ? await getEmployeeId(name) : null);
        await clockOutEmployee(empId, prevTask);
      } catch (_) {}
    }

    const isGeneric = typeof item === 'string';
    const newTask = isGeneric
      ? { jobName: item, workOrderName: item, workOrderId: null, dept: userDept, startedAt: now, employeeName: name }
      : { ...item, startedAt: now, employeeName: name };

    await AsyncStorage.setItem(CURRENT_TASK_KEY, JSON.stringify(newTask));
    setCurrentTask(newTask);

    // Update recent jobs (only for real work orders, not generic activities)
    if (!isGeneric && item.workOrderId) {
      const prevJobs = recentJobs.filter(j => j.workOrderId !== item.workOrderId);
      const next = [{ ...item, lastWorkedAt: now }, ...prevJobs].slice(0, 5);
      setRecentJobs(next);
      await AsyncStorage.setItem(RECENT_JOBS_KEY, JSON.stringify(next));
    }

    const label = isGeneric ? item : (item.jobName || item.workOrderName);
    showSwitchBanner(`Switched to ${label}`);
  };

  // ── Setup modal ───────────────────────────────────────────────
  const handleSaveSetup = async () => {
    if (deptOnlyMode) {
      if (!draftDept) return;
      await AsyncStorage.setItem(STORAGE_KEY_DEPT, draftDept);
      const deviceId = (await AsyncStorage.getItem(DEVICE_ID_KEY)) || 'unknown';
      await supabase.from('device_tokens').update({ dept: draftDept }).eq('id', deviceId).catch(() => {});
      await supabase.from('login_log').insert({ worker_name: userName, dept: draftDept, role: 'dept_change', device_id: deviceId, app_version: '2' }).catch(() => {});
      setUserDept(draftDept); setSetupVisible(false); setDeptOnlyMode(false);
      fetchAlerts(draftDept);
      AsyncStorage.getItem(LAST_READ_KEY).then(seen => fetchRecentMessages(userName, seen ?? ''));
      return;
    }
    if (!draftName.trim() || !draftDept) return;
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_NAME, draftName.trim()),
      AsyncStorage.setItem(STORAGE_KEY_DEPT, draftDept),
    ]);
    setUserName(draftName.trim()); setUserDept(draftDept); setSetupVisible(false);
    fetchAlerts(draftDept);
  };

  // ── End Day ───────────────────────────────────────────────────
  const handleEndDay = async () => {
    if (endingDay) return;
    setEndingDay(true);
    try {
      const raw  = await AsyncStorage.getItem(CURRENT_TASK_KEY);
      const task = raw ? JSON.parse(raw) : null;
      const name = await AsyncStorage.getItem(STORAGE_KEY_NAME);
      const empId = task?.employeeId ?? (name ? await getEmployeeId(name) : null);
      await clockOutEmployee(empId, task);
      setCurrentTask(null);
      setDayDone(true);
      setTimeout(async () => {
        setDayDone(false);
        setEndingDay(false);
        await endDay();
      }, 3000);
    } catch (_) {
      setEndingDay(false);
      await endDay();
    }
  };

  const handleNotifPress = useCallback(async () => {
    const now = new Date().toISOString();
    await AsyncStorage.setItem(LAST_READ_KEY, now);
    setLastSeenAt(now); setRecentMessages([]); onClearUnread?.();
    navigation.navigate('Messages', { userName, userDept });
  }, [userName, userDept, onClearUnread, navigation]);

  const handleSwitchRole = () => {
    if (Platform.OS === 'web') {
      setSettingsVisible(true);
    } else {
      Alert.alert('Settings', null, [
        { text: 'Switch Department', onPress: () => { setDeptOnlyMode(true); setDraftDept(userDept); setSetupVisible(true); } },
        { text: 'Switch Role', style: 'destructive', onPress: () => resetRole?.() },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const deptStyle   = DEPT_COLORS[userDept] ?? { bg: '#1f1f1f', text: '#888' };
  const totalAlerts = openInventory + openDamage;

  // ── Day-done overlay ──────────────────────────────────────────
  if (dayDone) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.dayDoneWrap}>
          <Text style={styles.dayDoneEmoji}>✅</Text>
          <Text style={styles.dayDoneTitle}>Day logged</Text>
          <Text style={styles.dayDoneSub}>See you tomorrow</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Switch banner */}
      {!!switchBanner && (
        <View style={styles.switchBanner}>
          <Ionicons name="checkmark-circle" size={14} color={C.success} />
          <Text style={styles.switchBannerText}>{switchBanner}</Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <View>
          <InlineIQLogo size="header" />
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
          <View style={[styles.syncDot, syncOk ? styles.syncGreen : styles.syncRed]} />
          <TouchableOpacity onPress={handleSwitchRole} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="settings-outline" size={24} color={C.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {isOnline === false && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fca5a5" />
          <Text style={styles.offlineBannerText}>Offline — will sync when connected</Text>
        </View>
      )}

      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Current Task */}
        {userName ? (
          <View style={styles.taskCard}>
            {currentTask ? (
              <>
                <Text style={styles.taskLabel}>CURRENT JOB</Text>
                <Text style={styles.taskJobName}>{currentTask.jobName || currentTask.workOrderName}</Text>
                {currentTask.workOrderName && currentTask.jobName
                  ? <Text style={styles.taskWO}>{currentTask.workOrderName}</Text>
                  : null}
                <View style={styles.taskMeta}>
                  {currentTask.dept ? (
                    <View style={styles.taskDeptPill}>
                      <Text style={styles.taskDeptText}>{currentTask.dept}</Text>
                    </View>
                  ) : null}
                  {elapsed ? <Text style={styles.taskElapsed}>{elapsed}</Text> : null}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.taskLabel}>CURRENT JOB</Text>
                <Text style={styles.taskEmpty}>Scan a part to begin your shift</Text>
              </>
            )}
          </View>
        ) : null}

        {/* Alerts */}
        {totalAlerts > 0 && (
          <View style={styles.alertBanner}>
            <View style={styles.alertDot} />
            <Text style={styles.alertText}>
              {totalAlerts} open alert{totalAlerts !== 1 ? 's' : ''} in {userDept}
            </Text>
          </View>
        )}

        {/* Recent messages */}
        {recentMessages.length > 0 && (
          <View style={styles.notifSection}>
            <Text style={styles.notifLabel}>Recent Messages</Text>
            {recentMessages.map(msg => {
              const isUnread = !lastSeenAt || msg.created_at > lastSeenAt;
              return (
                <TouchableOpacity
                  key={msg.id}
                  style={[styles.notifCard, isUnread && styles.notifCardUnread]}
                  onPress={handleNotifPress}
                  activeOpacity={0.7}
                >
                  <View style={styles.notifAvatar}>
                    <Text style={styles.notifAvatarText}>{(msg.sender_name || '?')[0].toUpperCase()}</Text>
                  </View>
                  <View style={styles.notifBody}>
                    <View style={styles.notifRow}>
                      <Text style={styles.notifSender} numberOfLines={1}>{msg.sender_name}</Text>
                      <Text style={styles.notifTime}>{formatMsgTime(msg.created_at)}</Text>
                    </View>
                    <Text style={styles.notifPreview} numberOfLines={1}>{(msg.body || '').slice(0, 40)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Quick actions */}
        <View style={styles.quickGrid}>
          <TouchableOpacity style={styles.quickCard} onPress={() => navigation.navigate('Needs', { userName, userDept })} activeOpacity={0.7}>
            <Ionicons name="cube-outline" size={22} color="#00C5CC" />
            <Text style={styles.quickLabel}>Log Need</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={() => navigation.navigate('Damage', { userName, userDept })} activeOpacity={0.7}>
            <Ionicons name="warning-outline" size={22} color="#ef4444" />
            <Text style={styles.quickLabel}>Report Damage</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={handleNotifPress} activeOpacity={0.7}>
            <Ionicons name="chatbubble-outline" size={22} color="#8b5cf6" />
            <Text style={styles.quickLabel}>Messages</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={() => navigation.navigate('ScanPart', { userName, userDept })}
          activeOpacity={0.85}
        >
          <Ionicons name="scan-outline" size={24} color="#000" style={{ marginRight: 10 }} />
          <Text style={styles.scanBtnText}>Scan New Part</Text>
        </TouchableOpacity>

        {/* Quick Switch */}
        <TouchableOpacity
          style={styles.switchBtn}
          onPress={() => setSwitchVisible(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="swap-horizontal-outline" size={16} color={C.accent} style={{ marginRight: 6 }} />
          <Text style={styles.switchBtnText}>Quick Switch</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.endDayBtn, endingDay && { opacity: 0.5 }]}
          onPress={handleEndDay}
          disabled={endingDay}
          activeOpacity={0.8}
        >
          <Text style={styles.endDayText}>End Day</Text>
        </TouchableOpacity>
      </View>

      {/* Setup modal */}
      <Modal visible={setupVisible} animationType="slide" transparent onRequestClose={() => { setSetupVisible(false); setDeptOnlyMode(false); }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{deptOnlyMode ? 'Switch Department' : 'Who are you?'}</Text>

            {!deptOnlyMode && (
              <>
                <Text style={styles.fieldLabel}>YOUR NAME</Text>
                <TextInput
                  style={styles.input} placeholder="e.g. Jake Morris"
                  placeholderTextColor={C.muted} value={draftName}
                  onChangeText={setDraftName} autoFocus
                />
              </>
            )}

            <Text style={styles.fieldLabel}>DEPARTMENT</Text>
            <FlatList
              data={departments} keyExtractor={d => d} scrollEnabled={false}
              renderItem={({ item }) => {
                const dc  = DEPT_COLORS[item] ?? { bg: '#1f1f1f', text: '#888' };
                const sel = draftDept === item;
                return (
                  <TouchableOpacity
                    style={[styles.deptOption, sel && { borderColor: dc.text, backgroundColor: dc.bg }]}
                    onPress={() => setDraftDept(item)}
                  >
                    <Text style={[styles.deptOptionText, sel && { color: dc.text, fontWeight: '700' }]}>{item}</Text>
                    {sel && <Ionicons name="checkmark-circle" size={18} color={dc.text} />}
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity
              style={[styles.saveBtn, (deptOnlyMode ? !draftDept : (!draftName.trim() || !draftDept)) && styles.saveBtnDisabled]}
              onPress={handleSaveSetup}
              disabled={deptOnlyMode ? !draftDept : (!draftName.trim() || !draftDept)}
            >
              <Text style={styles.saveBtnText}>{deptOnlyMode ? 'Switch Department' : "Let's Go"}</Text>
            </TouchableOpacity>

            {deptOnlyMode && (
              <TouchableOpacity style={{ alignItems: 'center', paddingTop: 14 }} onPress={() => { setSetupVisible(false); setDeptOnlyMode(false); }}>
                <Text style={{ color: C.muted, fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Settings modal (web fallback) */}
      <Modal visible={settingsVisible} animationType="slide" transparent onRequestClose={() => setSettingsVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Settings</Text>
            <TouchableOpacity style={styles.settingsBtn} onPress={() => { setSettingsVisible(false); setDeptOnlyMode(true); setDraftDept(userDept); setSetupVisible(true); }}>
              <Text style={styles.settingsBtnText}>Switch Department</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.settingsBtn, styles.settingsBtnDanger]} onPress={() => { setSettingsVisible(false); setTimeout(() => resetRole?.(), 50); }}>
              <Text style={[styles.settingsBtnText, { color: C.danger }]}>Switch Role</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', paddingTop: 14 }} onPress={() => setSettingsVisible(false)}>
              <Text style={{ color: C.muted, fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Quick Switch bottom sheet */}
      <Modal visible={switchVisible} animationType="slide" transparent onRequestClose={() => setSwitchVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '80%' }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.modalTitle}>Quick Switch</Text>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {recentJobs.length > 0 && (
                <>
                  <Text style={styles.fieldLabel}>RECENT JOBS</Text>
                  {recentJobs.map((job, i) => (
                    <TouchableOpacity
                      key={i}
                      style={styles.switchRow}
                      onPress={() => handleQuickSwitch(job)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.switchRowIcon}>
                        <Ionicons name="time-outline" size={16} color={C.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.switchRowName}>{job.jobName || job.workOrderName}</Text>
                        {job.workOrderName && job.jobName && (
                          <Text style={styles.switchRowSub}>{job.workOrderName}</Text>
                        )}
                      </View>
                      {job.lastWorkedAt && (
                        <Text style={styles.switchRowTime}>{formatTimeSince(job.lastWorkedAt)}</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </>
              )}

              <Text style={styles.fieldLabel}>GENERIC ACTIVITIES</Text>
              <View style={styles.activityGrid}>
                {GENERIC_ACTIVITIES.map((act, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.activityChip}
                    onPress={() => handleQuickSwitch(act)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.activityChipText}>{act}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity style={{ alignItems: 'center', paddingTop: 16 }} onPress={() => setSwitchVisible(false)}>
              <Text style={{ color: C.muted, fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  // Switch banner
  switchBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#062022', paddingVertical: 8, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#0E4F52',
  },
  switchBannerText: { color: C.success, fontSize: 12, fontWeight: '600', flex: 1 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  appTitle: { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  userRow:  { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
  userName: { fontSize: 14, color: C.muted, fontWeight: '500' },
  deptBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  deptBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  syncDot:   { width: 8, height: 8, borderRadius: 4 },
  syncGreen: { backgroundColor: C.success },
  syncRed:   { backgroundColor: C.danger },

  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#1f0a0a', paddingVertical: 8, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#450a0a',
  },
  offlineBannerText: { color: '#fca5a5', fontSize: 12, fontWeight: '500' },

  taskCard: {
    marginHorizontal: 16, marginTop: 16,
    backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1.5, borderColor: '#222',
    paddingVertical: 16, paddingHorizontal: 16,
  },
  taskLabel:   { fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 8 },
  taskJobName: { fontSize: 18, fontWeight: '800', color: C.text, letterSpacing: -0.3, marginBottom: 2 },
  taskWO:      { fontSize: 13, color: C.muted, marginBottom: 8 },
  taskMeta:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskDeptPill:{ backgroundColor: C.accent + '22', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.accent + '44' },
  taskDeptText:{ fontSize: 11, fontWeight: '700', color: C.accent },
  taskElapsed: { fontSize: 14, color: C.accent, fontWeight: '700', fontVariant: ['tabular-nums'] },
  taskEmpty:   { fontSize: 14, color: C.muted, fontStyle: 'italic' },

  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: '#062022', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#0E4F52',
  },
  alertDot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent },
  alertText: { color: C.accent, fontSize: 13, fontWeight: '600' },

  notifSection: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  notifLabel: { fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 8 },
  notifCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: '#222',
    borderLeftWidth: 3, borderLeftColor: C.border,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  notifCardUnread: { borderLeftColor: C.accent },
  notifAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent + '22', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  notifAvatarText: { color: C.accent, fontSize: 15, fontWeight: '700' },
  notifBody: { flex: 1 },
  notifRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  notifSender: { fontSize: 13, fontWeight: '700', color: C.text, flex: 1, marginRight: 8 },
  notifTime:   { fontSize: 11, color: C.muted, flexShrink: 0 },
  notifPreview:{ fontSize: 12, color: C.muted },

  quickGrid: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  quickCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: '#222',
    paddingVertical: 16, alignItems: 'center', gap: 8,
  },
  quickLabel: { fontSize: 11, fontWeight: '700', color: C.muted, textAlign: 'center' },

  bottomBar: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8, gap: 8 },
  scanBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.accent, borderRadius: 16, paddingVertical: 18,
    shadowColor: '#00C5CC', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  scanBtnText: { color: '#000', fontSize: 18, fontWeight: '800' },
  switchBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    borderRadius: 14, paddingVertical: 12,
    backgroundColor: C.accent + '18', borderWidth: 1, borderColor: C.accent + '44',
  },
  switchBtnText: { color: C.accent, fontSize: 14, fontWeight: '700' },
  endDayBtn: {
    alignItems: 'center', paddingVertical: 12,
    borderRadius: 14, backgroundColor: C.surface,
    borderWidth: 1, borderColor: '#333',
  },
  endDayText: { color: C.muted, fontSize: 14, fontWeight: '600' },

  dayDoneWrap:  { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  dayDoneEmoji: { fontSize: 48 },
  dayDoneTitle: { fontSize: 26, fontWeight: '800', color: C.success },
  dayDoneSub:   { fontSize: 16, color: C.muted },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 4, letterSpacing: -0.3 },
  fieldLabel: { fontSize: 11, color: C.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 8, marginTop: 18 },
  input: {
    backgroundColor: C.input, borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    color: C.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 13,
  },
  deptOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, marginBottom: 6,
    backgroundColor: C.input, borderWidth: 1.5, borderColor: C.border,
  },
  deptOptionText: { color: C.muted, fontSize: 15, fontWeight: '500' },
  saveBtn: { marginTop: 22, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  settingsBtn: {
    marginTop: 14, backgroundColor: C.input, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border, paddingVertical: 15, alignItems: 'center',
  },
  settingsBtnDanger: { borderColor: '#7f1d1d', backgroundColor: '#1a0a0a', borderWidth: 1.5 },
  settingsBtnText: { color: C.text, fontSize: 16, fontWeight: '600' },

  // Quick Switch sheet
  switchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.input, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  switchRowIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: C.accent + '18', justifyContent: 'center', alignItems: 'center',
  },
  switchRowName: { fontSize: 14, fontWeight: '700', color: C.text },
  switchRowSub:  { fontSize: 11, color: C.muted, marginTop: 1 },
  switchRowTime: { fontSize: 11, color: C.muted, flexShrink: 0 },

  activityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  activityChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    backgroundColor: C.input, borderWidth: 1.5, borderColor: C.border,
  },
  activityChipText: { fontSize: 13, fontWeight: '600', color: C.muted },
});
