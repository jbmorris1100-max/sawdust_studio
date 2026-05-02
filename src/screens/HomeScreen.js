import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
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
  Alert,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { RoleContext } from '../lib/RoleContext';
import { getWorkOrders } from '../lib/innergy';

// ── Constants ─────────────────────────────────────────────────
const STORAGE_KEY_NAME    = '@sawdust_user_name';
const STORAGE_KEY_DEPT    = '@sawdust_user_dept';
const LAST_READ_KEY       = '@sawdust_last_read';
const DEVICE_ID_KEY       = '@sawdust_device_id';
const CURRENT_TASK_KEY    = '@sawdust_current_task';

const DEPARTMENTS = ['Production', 'Assembly', 'Finishing', 'Craftsman'];

const DEPT_COLORS = {
  Production:  { bg: '#172554', text: '#93c5fd' },
  Assembly:    { bg: '#052e16', text: '#86efac' },
  Finishing:   { bg: '#431407', text: '#fdba74' },
  Craftsman:   { bg: '#500724', text: '#f9a8d4' },
};

const ACTIONS = [
  { key: 'inventory', label: 'Log Inventory Need', screen: 'Needs',    icon: 'cube-outline',    accentColor: '#f59e0b' },
  { key: 'damage',    label: 'Report Damage',      screen: 'Damage',   icon: 'warning-outline', accentColor: '#ef4444' },
  { key: 'scan',      label: 'Scan Part',          screen: 'ScanPart', icon: 'scan-outline',    accentColor: '#3b82f6' },
  { key: 'message',   label: 'Message Supervisor', screen: 'Messages', icon: 'chatbubble-outline', accentColor: '#8b5cf6' },
];

// ── Helpers ───────────────────────────────────────────────────
const formatMsgTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const timeAgo = (iso) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

// ── Main Component ────────────────────────────────────────────
export default function HomeScreen({ navigation, route }) {
  const { onClearUnread } = route?.params ?? {};
  const resetRole = useContext(RoleContext);

  const [userName, setUserName]             = useState('');
  const [userDept, setUserDept]             = useState('');
  const [setupVisible, setSetupVisible]     = useState(false);
  const [deptOnlyMode, setDeptOnlyMode]     = useState(false);
  const [draftName, setDraftName]           = useState('');
  const [draftDept, setDraftDept]           = useState('');
  const [openInventory, setOpenInventory]   = useState(0);
  const [openDamage, setOpenDamage]         = useState(0);
  const [alertLoading, setAlertLoading]     = useState(false);
  const [recentMessages, setRecentMessages] = useState([]);
  const [lastSeenAt, setLastSeenAt]         = useState('');
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [isOnline, setIsOnline]             = useState(null);

  // Current Task
  const [currentTask,       setCurrentTask]       = useState(null);
  const [taskModalVisible,  setTaskModalVisible]  = useState(false);
  const [workOrders,        setWorkOrders]        = useState([]);
  const [loadingWorkOrders, setLoadingWorkOrders] = useState(false);
  const [selectedWO,        setSelectedWO]        = useState(null);
  const [selectedTaskType,  setSelectedTaskType]  = useState('');

  // Ref so the realtime subscription always reads the latest lastSeenAt
  const lastSeenAtRef = useRef('');
  useEffect(() => { lastSeenAtRef.current = lastSeenAt; }, [lastSeenAt]);

  // ── Load persisted state ──────────────────────────────────
  useEffect(() => {
    (async () => {
      const [name, dept, seen] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_NAME),
        AsyncStorage.getItem(STORAGE_KEY_DEPT),
        AsyncStorage.getItem(LAST_READ_KEY),
      ]);
      if (seen) setLastSeenAt(seen);
      if (name && dept) {
        setUserName(name);
        setUserDept(dept);
      } else if (name && !dept) {
        setUserName(name);
        setDraftName(name);
        setDeptOnlyMode(true);
        setSetupVisible(true);
      } else {
        setSetupVisible(true);
      }
    })();
  }, []);

  // ── Load current task on focus ────────────────────────────
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(CURRENT_TASK_KEY).then((raw) => {
        if (raw) {
          try { setCurrentTask(JSON.parse(raw)); } catch { setCurrentTask(null); }
        } else {
          setCurrentTask(null);
        }
      });
      if (userDept) fetchAlerts(userDept);
      if (userName) {
        AsyncStorage.getItem(LAST_READ_KEY).then((seen) => {
          const s = seen ?? '';
          if (s) setLastSeenAt(s);
          fetchRecentMessages(userName, s);
        });
      }
    }, [userDept, userName, fetchRecentMessages])
  );

  // ── Real-time message subscription ───────────────────────
  useEffect(() => {
    if (!userName) return;
    const ch = supabase
      .channel('home-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (payload.new.sender_name === userName) return;
        setRecentMessages((prev) => {
          const ls = lastSeenAtRef.current;
          if (ls && payload.new.created_at <= ls) return prev;
          return [payload.new, ...prev].slice(0, 3);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userName]);

  // ── Connection status ─────────────────────────────────────
  const checkConnection = useCallback(async () => {
    try {
      const { error } = await supabase.from('messages').select('id').limit(1);
      const networkDown = error?.message?.toLowerCase().includes('fetch') ||
                          error?.message?.toLowerCase().includes('network');
      setIsOnline(!networkDown);
    } catch {
      setIsOnline(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();
    const id = setInterval(checkConnection, 30000);
    return () => clearInterval(id);
  }, [checkConnection]);

  const fetchRecentMessages = useCallback(async (name, seenAt) => {
    let query = supabase
      .from('messages')
      .select('*')
      .neq('sender_name', name)
      .order('created_at', { ascending: false })
      .limit(3);
    if (seenAt) query = query.gt('created_at', seenAt);
    const { data } = await query;
    if (data) setRecentMessages(data);
  }, []);

  const handleNotifPress = useCallback(async () => {
    const now = new Date().toISOString();
    await AsyncStorage.setItem(LAST_READ_KEY, now);
    setLastSeenAt(now);
    setRecentMessages([]);
    onClearUnread?.();
    navigation.navigate('Messages', { userName, userDept });
  }, [userName, userDept, onClearUnread, navigation]);

  // ── Alerts ────────────────────────────────────────────────
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

  // ── Setup ─────────────────────────────────────────────────
  const handleSaveSetup = async () => {
    if (deptOnlyMode) {
      if (!draftDept) return;
      await AsyncStorage.setItem(STORAGE_KEY_DEPT, draftDept);
      const deviceId = (await AsyncStorage.getItem(DEVICE_ID_KEY)) || 'unknown';
      try {
        await supabase.from('device_tokens').update({ dept: draftDept }).eq('id', deviceId);
      } catch (e) {}
      try {
        await supabase.from('login_log').insert({
          worker_name: userName, dept: draftDept, role: 'dept_change',
          device_id: deviceId, app_version: '2',
        });
      } catch (e) {}
      setUserDept(draftDept);
      setSetupVisible(false);
      setDeptOnlyMode(false);
      fetchAlerts(draftDept);
      AsyncStorage.getItem(LAST_READ_KEY).then((seen) => {
        fetchRecentMessages(userName, seen ?? '');
      });
      return;
    }
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

  const handleSwitchRole = () => {
    if (Platform.OS === 'web') {
      setSettingsModalVisible(true);
    } else {
      Alert.alert('Settings', null, [
        {
          text: 'Switch Department',
          onPress: () => {
            setDeptOnlyMode(true);
            setDraftDept(userDept);
            setSetupVisible(true);
          },
        },
        {
          text: 'Switch Role',
          style: 'destructive',
          onPress: () => resetRole?.(),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  // ── Current Task ──────────────────────────────────────────
  const handleOpenTaskModal = async () => {
    setTaskModalVisible(true);
    setSelectedWO(null);
    setSelectedTaskType('');
    setLoadingWorkOrders(true);
    const data = await getWorkOrders();
    setWorkOrders(Array.isArray(data) ? data : []);
    setLoadingWorkOrders(false);
  };

  const handleSaveTask = async () => {
    if (!selectedWO) return;
    const task = {
      workOrderId:   selectedWO.id ?? selectedWO.workOrderId ?? '',
      workOrderName: selectedWO.name ?? selectedWO.workOrderName ?? selectedWO.title ?? String(selectedWO.id ?? ''),
      jobName:       selectedWO.jobName ?? selectedWO.projectName ?? selectedWO.job ?? '',
      taskType:      selectedTaskType,
      startedAt:     new Date().toISOString(),
    };
    await AsyncStorage.setItem(CURRENT_TASK_KEY, JSON.stringify(task));
    setCurrentTask(task);
    setTaskModalVisible(false);
  };

  const handleClearTask = async () => {
    await AsyncStorage.removeItem(CURRENT_TASK_KEY);
    setCurrentTask(null);
  };

  // ── Helpers ───────────────────────────────────────────────
  const badgeFor = (key) => {
    if (key === 'inventory') return openInventory;
    if (key === 'damage')    return openDamage;
    return 0;
  };

  const totalAlerts = openInventory + openDamage;
  const deptStyle = DEPT_COLORS[userDept] ?? { bg: '#1f1f1f', text: '#888' };

  // ── Render ────────────────────────────────────────────────
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
            onPress={handleSwitchRole}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="settings-outline" size={24} color={C.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (userName) {
                setDeptOnlyMode(true);
                setDraftDept(userDept);
              } else {
                setDraftName('');
                setDraftDept('');
              }
              setSetupVisible(true);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="person-circle-outline" size={30} color={C.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {isOnline === false && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fca5a5" />
          <Text style={styles.offlineBannerText}>You're offline — data will sync when connected</Text>
        </View>
      )}

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Current Task Card */}
        {userName ? (
          <View style={styles.taskCard}>
            <View style={styles.taskCardHeader}>
              <View style={styles.taskCardTitleRow}>
                <Ionicons
                  name={currentTask ? 'briefcase' : 'briefcase-outline'}
                  size={16}
                  color={currentTask ? C.accent : C.muted}
                />
                <Text style={[styles.taskCardTitle, currentTask && { color: C.accent }]}>
                  Current Task
                </Text>
              </View>
              {currentTask ? (
                <TouchableOpacity
                  onPress={handleClearTask}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.clearTaskText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {currentTask ? (
              <>
                <Text style={styles.taskJobName}>{currentTask.jobName || currentTask.workOrderName}</Text>
                <Text style={styles.taskWorkOrder}>{currentTask.workOrderName}</Text>
                <View style={styles.taskMetaRow}>
                  {currentTask.taskType ? (
                    <View style={styles.taskTypePill}>
                      <Text style={styles.taskTypePillText}>{currentTask.taskType}</Text>
                    </View>
                  ) : null}
                  <Text style={styles.taskTimeAgo}>{timeAgo(currentTask.startedAt)}</Text>
                </View>
              </>
            ) : (
              <Text style={styles.taskEmptyText}>No active task — scan a part to get started</Text>
            )}

            <TouchableOpacity
              style={styles.changeTaskBtn}
              onPress={handleOpenTaskModal}
              activeOpacity={0.8}
            >
              <Ionicons name="swap-horizontal-outline" size={15} color="#000" style={{ marginRight: 5 }} />
              <Text style={styles.changeTaskBtnText}>
                {currentTask ? 'Change Task' : 'Set Task'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

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

        {/* Recent Message Notifications */}
        {recentMessages.length > 0 && (
          <View style={styles.notifSection}>
            <Text style={styles.notifSectionLabel}>Recent Messages</Text>
            {recentMessages.map((msg) => {
              const isUnread = !lastSeenAt || msg.created_at > lastSeenAt;
              return (
                <TouchableOpacity
                  key={msg.id}
                  style={[styles.notifCard, isUnread && styles.notifCardUnread]}
                  onPress={handleNotifPress}
                  activeOpacity={0.7}
                >
                  <View style={styles.notifAvatar}>
                    <Text style={styles.notifAvatarText}>
                      {(msg.sender_name || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.notifBody}>
                    <View style={styles.notifHeaderRow}>
                      <Text style={styles.notifSender} numberOfLines={1}>
                        {msg.sender_name}
                        {msg.dept ? <Text style={styles.notifDept}> · {msg.dept}</Text> : null}
                      </Text>
                      <Text style={styles.notifTime}>{formatMsgTime(msg.created_at)}</Text>
                    </View>
                    <Text style={styles.notifPreview} numberOfLines={1}>
                      {(msg.body || '').slice(0, 40)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
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
                onPress={() =>
                  action.key === 'message'
                    ? handleNotifPress()
                    : navigation.navigate(action.screen, { userName, userDept })
                }
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
      </ScrollView>

      {/* Setup Modal */}
      <Modal
        visible={setupVisible}
        animationType="slide"
        transparent
        onRequestClose={() => { setSetupVisible(false); setDeptOnlyMode(false); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>
              {deptOnlyMode ? 'Switch Department' : 'Who are you?'}
            </Text>

            {!deptOnlyMode && (
              <>
                <Text style={styles.fieldLabel}>Your Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Jake Morris"
                  placeholderTextColor={C.muted}
                  value={draftName}
                  onChangeText={setDraftName}
                  autoFocus
                />
              </>
            )}

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
              style={[
                styles.saveBtn,
                (deptOnlyMode ? !draftDept : (!draftName.trim() || !draftDept)) && styles.saveBtnDisabled,
              ]}
              onPress={handleSaveSetup}
              disabled={deptOnlyMode ? !draftDept : (!draftName.trim() || !draftDept)}
            >
              <Text style={styles.saveBtnText}>
                {deptOnlyMode ? 'Switch Department' : "Let's Go"}
              </Text>
            </TouchableOpacity>

            {deptOnlyMode && (
              <TouchableOpacity
                style={{ alignItems: 'center', paddingTop: 14 }}
                onPress={() => { setSetupVisible(false); setDeptOnlyMode(false); }}
              >
                <Text style={{ color: C.muted, fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Change Task Modal */}
      <Modal
        visible={taskModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setTaskModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '85%' }]}>
            <Text style={styles.modalTitle}>Set Current Task</Text>

            {loadingWorkOrders ? (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <ActivityIndicator size="large" color={C.accent} />
                <Text style={{ color: C.muted, marginTop: 10, fontSize: 13 }}>Loading work orders…</Text>
              </View>
            ) : workOrders.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 32, gap: 10 }}>
                <Ionicons name="cloud-offline-outline" size={36} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center' }}>
                  No work orders found.{'\n'}Check your Innergy API connection.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Work Order</Text>
                <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {workOrders.map((wo, idx) => {
                    const woName = wo.name ?? wo.workOrderName ?? wo.title ?? `Work Order ${idx + 1}`;
                    const jobName = wo.jobName ?? wo.projectName ?? wo.job ?? '';
                    const isSelected = selectedWO === wo;
                    return (
                      <TouchableOpacity
                        key={wo.id ?? idx}
                        style={[styles.deptOption, isSelected && { borderColor: C.accent, backgroundColor: C.accent + '18' }]}
                        onPress={() => setSelectedWO(wo)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.deptOptionText, isSelected && { color: C.accent, fontWeight: '700' }]}>
                            {woName}
                          </Text>
                          {jobName ? (
                            <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{jobName}</Text>
                          ) : null}
                        </View>
                        {isSelected && <Ionicons name="checkmark-circle" size={18} color={C.accent} />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}

            {selectedWO ? (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Task Type</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                  {DEPARTMENTS.map((dept) => (
                    <TouchableOpacity
                      key={dept}
                      style={[
                        styles.deptOption,
                        { paddingVertical: 9, paddingHorizontal: 14, flex: 0 },
                        selectedTaskType === dept && { borderColor: C.accent, backgroundColor: C.accent + '18' },
                      ]}
                      onPress={() => setSelectedTaskType(dept)}
                    >
                      <Text style={[styles.deptOptionText, selectedTaskType === dept && { color: C.accent, fontWeight: '700' }]}>
                        {dept}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}

            <TouchableOpacity
              style={[styles.saveBtn, (!selectedWO) && styles.saveBtnDisabled]}
              onPress={handleSaveTask}
              disabled={!selectedWO}
            >
              <Text style={styles.saveBtnText}>Set as Current Task</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ alignItems: 'center', paddingTop: 14 }}
              onPress={() => setTaskModalVisible(false)}
            >
              <Text style={{ color: C.muted, fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Settings Modal — web fallback */}
      <Modal
        visible={settingsModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSettingsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Settings</Text>

            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={() => {
                setSettingsModalVisible(false);
                setDeptOnlyMode(true);
                setDraftDept(userDept);
                setSetupVisible(true);
              }}
            >
              <Text style={styles.settingsBtnText}>Switch Department</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingsBtn, styles.settingsBtnDanger]}
              onPress={() => {
                setSettingsModalVisible(false);
                setTimeout(() => {
                  if (window.confirm('Switch role? This will log you out.')) {
                    resetRole?.();
                  }
                }, 50);
              }}
            >
              <Text style={[styles.settingsBtnText, { color: C.danger }]}>Switch Role</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ alignItems: 'center', paddingTop: 14 }}
              onPress={() => setSettingsModalVisible(false)}
            >
              <Text style={{ color: C.muted, fontSize: 14 }}>Cancel</Text>
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

  flex: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  notifSection: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  notifSectionLabel: {
    fontSize: 10, fontWeight: '700', color: C.muted,
    letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 8,
  },
  notifCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: '#222',
    borderLeftWidth: 3, borderLeftColor: C.border,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  notifCardUnread: { borderLeftColor: C.accent },
  notifAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.accent + '22',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  notifAvatarText: { color: C.accent, fontSize: 15, fontWeight: '700' },
  notifBody: { flex: 1 },
  notifHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 2,
  },
  notifSender: { fontSize: 13, fontWeight: '700', color: C.text, flex: 1, marginRight: 8 },
  notifDept: { fontWeight: '400', color: C.muted },
  notifTime: { fontSize: 11, color: C.muted, flexShrink: 0 },
  notifPreview: { fontSize: 12, color: C.muted },

  grid: {
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

  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#2e1a1a',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#7f1d1d',
  },
  offlineBannerText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '500',
  },

  // Current Task card
  taskCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#222',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  taskCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  taskCardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  clearTaskText: { fontSize: 12, color: C.danger, fontWeight: '600' },
  taskJobName: { fontSize: 17, fontWeight: '800', color: C.text, marginBottom: 2 },
  taskWorkOrder: { fontSize: 13, color: C.muted, marginBottom: 8 },
  taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  taskTypePill: {
    backgroundColor: C.accent + '22',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.accent + '44',
  },
  taskTypePillText: { fontSize: 11, fontWeight: '700', color: C.accent },
  taskTimeAgo: { fontSize: 12, color: C.muted },
  taskEmptyText: { fontSize: 13, color: C.muted, fontStyle: 'italic', marginBottom: 12 },
  changeTaskBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 10,
  },
  changeTaskBtnText: { color: '#000', fontSize: 14, fontWeight: '700' },

  // Settings modal buttons
  settingsBtn: {
    marginTop: 14,
    backgroundColor: C.input,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    paddingVertical: 15,
    alignItems: 'center',
  },
  settingsBtnDanger: {
    borderColor: '#7f1d1d',
    backgroundColor: '#1a0a0a',
  },
  settingsBtnText: {
    color: C.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
