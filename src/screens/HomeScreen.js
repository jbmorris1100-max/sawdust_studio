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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { RoleContext } from '../lib/RoleContext';

// ── Constants ─────────────────────────────────────────────────
const STORAGE_KEY_NAME = '@sawdust_user_name';
const STORAGE_KEY_DEPT = '@sawdust_user_dept';
const CLOCK_IN_KEY     = '@sawdust_clock_in_time';
const CLOCK_ID_KEY     = '@sawdust_clock_record_id';
const BREAK_START_KEY  = '@sawdust_break_start';
const BREAK_MINS_KEY   = '@sawdust_break_minutes';
const LAST_READ_KEY    = '@sawdust_last_read';
const DEVICE_ID_KEY    = '@sawdust_device_id';

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

// ── Helpers ───────────────────────────────────────────────────
const formatMsgTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const fmtSecs = (secs) => {
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
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
  const [clockedIn,     setClockedIn]       = useState(false);
  const [clockInTime,   setClockInTime]     = useState(null);
  const [clockRecordId, setClockRecordId]   = useState(null);
  const [elapsed,       setElapsed]         = useState('00:00:00');
  const [clockLoading,  setClockLoading]    = useState(false);
  const [isOnBreak,         setIsOnBreak]         = useState(false);
  const [breakStartTime,    setBreakStartTime]    = useState(null);
  const [totalBreakMinutes, setTotalBreakMinutes] = useState(0);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);

  // Ref so the realtime subscription always reads the latest lastSeenAt
  const lastSeenAtRef = useRef('');
  useEffect(() => { lastSeenAtRef.current = lastSeenAt; }, [lastSeenAt]);

  // ── Load persisted state ──────────────────────────────────
  useEffect(() => {
    (async () => {
      const [name, dept, seen, ciTime, ciId, bStart, bMins] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_NAME),
        AsyncStorage.getItem(STORAGE_KEY_DEPT),
        AsyncStorage.getItem(LAST_READ_KEY),
        AsyncStorage.getItem(CLOCK_IN_KEY),
        AsyncStorage.getItem(CLOCK_ID_KEY),
        AsyncStorage.getItem(BREAK_START_KEY),
        AsyncStorage.getItem(BREAK_MINS_KEY),
      ]);
      if (seen) setLastSeenAt(seen);
      if (ciTime && ciId) {
        setClockedIn(true);
        setClockInTime(ciTime);
        setClockRecordId(ciId);
      }
      if (bStart) { setIsOnBreak(true); setBreakStartTime(bStart); }
      if (bMins)  setTotalBreakMinutes(parseInt(bMins, 10) || 0);
      if (name && dept) {
        setUserName(name);
        setUserDept(dept);
      } else {
        setSetupVisible(true);
      }
    })();
  }, []);

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

  useFocusEffect(
    useCallback(() => {
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

  // ── Elapsed timer (pauses during break) ──────────────────
  useEffect(() => {
    if (!clockedIn || !clockInTime) return;
    const breakSecs = totalBreakMinutes * 60;
    const compute = () => {
      if (isOnBreak && breakStartTime) {
        // Freeze display at the moment break started
        return Math.max(0, Math.floor(
          (new Date(breakStartTime).getTime() - new Date(clockInTime).getTime()) / 1000
        ) - breakSecs);
      }
      return Math.max(0, Math.floor(
        (Date.now() - new Date(clockInTime).getTime()) / 1000
      ) - breakSecs);
    };
    setElapsed(fmtSecs(compute()));
    if (isOnBreak) return;
    const id = setInterval(() => setElapsed(fmtSecs(compute())), 1000);
    return () => clearInterval(id);
  }, [clockedIn, clockInTime, isOnBreak, breakStartTime, totalBreakMinutes]);

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
      // Update dept on device_tokens so supervisor sees the change
      try {
        await supabase.from('device_tokens').update({ dept: draftDept }).eq('id', deviceId);
      } catch (e) {}
      // Audit log
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

  // ── Clock actions ─────────────────────────────────────────
  const handleClockIn = async () => {
    if (!userName || !userDept || clockLoading) return;
    setClockLoading(true);
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('time_clock')
        .insert({ worker_name: userName, dept: userDept, clock_in: now, date: now.slice(0, 10) })
        .select()
        .single();
      if (error || !data) throw new Error(error?.message || 'Insert failed');
      await Promise.all([
        AsyncStorage.setItem(CLOCK_IN_KEY, now),
        AsyncStorage.setItem(CLOCK_ID_KEY, data.id),
      ]);
      setClockInTime(now);
      setClockRecordId(data.id);
      setClockedIn(true);
    } catch (e) {
      if (Platform.OS === 'web') {
        window.alert('Clock In Failed: ' + (e.message || 'Could not record clock-in. Check network.'));
      } else {
        Alert.alert('Clock In Failed', e.message || 'Could not record clock-in. Check network.');
      }
    } finally {
      setClockLoading(false);
    }
  };

  const handleBreakStart = async () => {
    if (!clockedIn || isOnBreak || clockLoading) return;
    const now = new Date().toISOString();
    await AsyncStorage.setItem(BREAK_START_KEY, now);
    setBreakStartTime(now);
    setIsOnBreak(true);
  };

  const handleBreakEnd = async () => {
    if (!isOnBreak || clockLoading) return;
    setClockLoading(true);
    try {
      const breakDuration = Math.round((Date.now() - new Date(breakStartTime).getTime()) / 60000);
      const newTotal = totalBreakMinutes + breakDuration;
      await Promise.all([
        AsyncStorage.setItem(BREAK_MINS_KEY, String(newTotal)),
        AsyncStorage.removeItem(BREAK_START_KEY),
      ]);
      setTotalBreakMinutes(newTotal);
      setBreakStartTime(null);
      setIsOnBreak(false);
    } finally {
      setClockLoading(false);
    }
  };

  const doClockOut = async () => {
    setClockLoading(true);
    try {
      const now = new Date().toISOString();
      const currentBreakMs = isOnBreak && breakStartTime
        ? Math.round(Date.now() - new Date(breakStartTime).getTime())
        : 0;
      const finalBreakMinutes = totalBreakMinutes + Math.round(currentBreakMs / 60000);
      const netMs = Math.max(0,
        Date.now() - new Date(clockInTime).getTime()
        - totalBreakMinutes * 60000
        - currentBreakMs
      );
      const totalHours = +(netMs / 3600000).toFixed(4);
      const { error } = await supabase
        .from('time_clock')
        .update({ clock_out: now, total_hours: totalHours, break_minutes: finalBreakMinutes })
        .eq('id', clockRecordId);
      if (error) throw new Error(error.message);
      await Promise.all([
        AsyncStorage.removeItem(CLOCK_IN_KEY),
        AsyncStorage.removeItem(CLOCK_ID_KEY),
        AsyncStorage.removeItem(BREAK_START_KEY),
        AsyncStorage.removeItem(BREAK_MINS_KEY),
      ]);
      setClockedIn(false);
      setClockInTime(null);
      setClockRecordId(null);
      setElapsed('00:00:00');
      setIsOnBreak(false);
      setBreakStartTime(null);
      setTotalBreakMinutes(0);
    } catch (e) {
      if (Platform.OS === 'web') {
        window.alert('Could not record clock-out. Check network.');
      } else {
        Alert.alert('Clock Out Failed', 'Could not record clock-out. Check network.');
      }
    } finally {
      setClockLoading(false);
    }
  };

  const handleClockOut = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('End your shift?')) doClockOut();
    } else {
      Alert.alert('Clock Out', 'End your shift?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clock Out', style: 'destructive', onPress: doClockOut },
      ]);
    }
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
            onPress={() => { setDraftName(userName); setDraftDept(userDept); setSetupVisible(true); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="person-circle-outline" size={30} color={C.muted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Clock In / Out / Break */}
        {userName ? (
          clockedIn ? (
            isOnBreak ? (
              // ON BREAK card
              <View style={styles.breakCard}>
                <View style={styles.clockCardHeader}>
                  <View style={[styles.clockCardDot, styles.breakDot]} />
                  <Text style={styles.breakStatus}>ON BREAK</Text>
                </View>
                <Text style={styles.breakCardSub}>{userName} · {userDept}</Text>
                <TouchableOpacity
                  style={styles.returnBreakBtn}
                  onPress={handleBreakEnd}
                  disabled={clockLoading}
                  activeOpacity={0.8}
                >
                  {clockLoading
                    ? <ActivityIndicator size="small" color={C.accent} />
                    : <Text style={styles.returnBreakBtnText}>Return from Break</Text>
                  }
                </TouchableOpacity>
              </View>
            ) : (
              // CLOCKED IN card
              <View style={styles.clockCard}>
                <View style={styles.clockCardHeader}>
                  <View style={styles.clockCardDot} />
                  <Text style={styles.clockCardStatus}>CLOCKED IN</Text>
                </View>
                <Text style={styles.clockCardElapsed}>{elapsed}</Text>
                <Text style={styles.clockCardSub}>{userName} · {userDept}</Text>
                <View style={styles.clockBtnRow}>
                  <TouchableOpacity
                    style={styles.breakBtn}
                    onPress={handleBreakStart}
                    disabled={clockLoading}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.breakBtnText}>Take Break</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.clockOutBtn}
                    onPress={handleClockOut}
                    disabled={clockLoading}
                    activeOpacity={0.8}
                  >
                    {clockLoading
                      ? <ActivityIndicator size="small" color="#ef4444" />
                      : <Text style={styles.clockOutBtnText}>Clock Out</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            )
          ) : (
            <TouchableOpacity
              style={[styles.clockInBtn, clockLoading && { opacity: 0.6 }]}
              onPress={handleClockIn}
              disabled={clockLoading}
              activeOpacity={0.85}
            >
              {clockLoading
                ? <ActivityIndicator size="small" color="#000" />
                : <>
                    <Ionicons name="time-outline" size={20} color="#000" />
                    <Text style={styles.clockInBtnText}>CLOCK IN</Text>
                  </>
              }
            </TouchableOpacity>
          )
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

      {/* Settings Modal — used on web where Alert.alert silently fails */}
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

  flex: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  // Notification cards
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

  // Grid
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

  // Clock in / out
  clockInBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 16,
    backgroundColor: C.accent, borderRadius: 16, paddingVertical: 18,
  },
  clockInBtnText: { color: '#000', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },

  clockCard: {
    marginHorizontal: 16, marginTop: 16,
    backgroundColor: '#0a1f10', borderRadius: 16,
    borderWidth: 1.5, borderColor: '#14532d',
    paddingVertical: 16, paddingHorizontal: 20,
    alignItems: 'center',
  },
  clockCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  clockCardDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  clockCardStatus: { color: '#22c55e', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  clockCardElapsed:{ color: '#22c55e', fontSize: 38, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
  clockCardSub:    { color: '#555555', fontSize: 13, marginBottom: 16 },

  clockBtnRow: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
  },
  breakBtn: {
    borderRadius: 12, borderWidth: 1.5, borderColor: '#78350f',
    backgroundColor: '#1c1200', paddingVertical: 10, paddingHorizontal: 20,
  },
  breakBtnText: { color: C.accent, fontSize: 15, fontWeight: '700' },
  clockOutBtn: {
    borderRadius: 12, borderWidth: 1.5, borderColor: '#7f1d1d',
    backgroundColor: '#2e1a1a', paddingVertical: 10, paddingHorizontal: 20,
  },
  clockOutBtnText: { color: '#ef4444', fontSize: 15, fontWeight: '700' },

  // Break card
  breakCard: {
    marginHorizontal: 16, marginTop: 16,
    backgroundColor: '#1c1200', borderRadius: 16,
    borderWidth: 1.5, borderColor: '#78350f',
    paddingVertical: 16, paddingHorizontal: 20,
    alignItems: 'center',
  },
  breakDot:    { backgroundColor: C.accent },
  breakStatus: { color: C.accent, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  breakCardSub:{ color: '#555555', fontSize: 13, marginBottom: 16 },
  returnBreakBtn: {
    borderRadius: 12, borderWidth: 1.5, borderColor: '#78350f',
    backgroundColor: '#2a1a00', paddingVertical: 10, paddingHorizontal: 24,
  },
  returnBreakBtnText: { color: C.accent, fontSize: 15, fontWeight: '700' },

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
