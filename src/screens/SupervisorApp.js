import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

// ── Design tokens ─────────────────────────────────────────────
const C = {
  bg:            '#0d0d0d',
  surface:       '#141414',
  input:         '#1a1a1a',
  border:        '#2a2a2a',
  text:          '#e5e5e5',
  muted:         '#555555',
  accent:        '#f59e0b',
  success:       '#22c55e',
  successBg:     '#0a1f10',
  successBorder: '#14532d',
  error:         '#ef4444',
  errorBg:       '#1f0a0a',
  errorBorder:   '#450a0a',
  blue:          '#3b82f6',
  blueBg:        '#0d1f3c',
  blueBorder:    '#1e3a5f',
};

const DEPARTMENTS = ['Cutting', 'Edgebanding', 'Assembly', 'Finishing', 'Craftsman', 'Install'];

const DEPT_COLORS = {
  Cutting:     '#93c5fd',
  Edgebanding: '#c4b5fd',
  Assembly:    '#86efac',
  Finishing:   '#fdba74',
  Craftsman:   '#f9a8d4',
  Install:     '#fca5a5',
};

const STATUS_STYLES = {
  pending:   { bg: '#1a1000', text: '#f59e0b', border: '#3d2800' },
  ordered:   { bg: '#0d1f3c', text: '#3b82f6', border: '#1e3a5f' },
  received:  { bg: '#0a1f10', text: '#22c55e', border: '#14532d' },
  cancelled: { bg: '#1a1a1a', text: '#555555', border: '#2a2a2a' },
  open:      { bg: '#1f0a0a', text: '#ef4444', border: '#450a0a' },
  reviewed:  { bg: '#0d1f3c', text: '#3b82f6', border: '#1e3a5f' },
  resolved:  { bg: '#0a1f10', text: '#22c55e', border: '#14532d' },
};

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'grid-outline',      activeIcon: 'grid'         },
  { key: 'messages', label: 'Messages', icon: 'chatbubble-outline', activeIcon: 'chatbubbles'  },
  { key: 'needs',    label: 'Needs',    icon: 'cube-outline',       activeIcon: 'cube'         },
  { key: 'damage',   label: 'Damage',   icon: 'warning-outline',    activeIcon: 'warning'      },
];

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ── Status Pill ───────────────────────────────────────────────
const StatusPill = ({ status }) => {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <View style={[styles.pill, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Text style={[styles.pillText, { color: s.text }]}>{status.toUpperCase()}</Text>
    </View>
  );
};

// ── Filter Chips ──────────────────────────────────────────────
const FilterChips = ({ options, value, onChange }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    style={styles.filterRow}
    contentContainerStyle={styles.filterRowContent}
  >
    {options.map((opt) => (
      <TouchableOpacity
        key={opt}
        style={[styles.filterChip, value === opt && styles.filterChipActive]}
        onPress={() => onChange(opt)}
      >
        <Text style={[styles.filterChipText, value === opt && styles.filterChipTextActive]}>
          {opt}
        </Text>
      </TouchableOpacity>
    ))}
  </ScrollView>
);

// ── Overview Tab ──────────────────────────────────────────────
function OverviewTab({ needs, damage, messages, threads, userName, onSwitchRole, todayClockEntries }) {
  // Tick every second to keep elapsed times live
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const pendingNeeds = needs.filter((n) => n.status === 'pending').length;
  const openDamage   = damage.filter((d) => d.status === 'open').length;

  const activeClock = (todayClockEntries || []).filter((e) => !e.clock_out);
  const totalClockHours = (todayClockEntries || []).reduce((sum, e) => {
    if (e.clock_out) return sum + (e.total_hours || 0);
    return sum + (Date.now() - new Date(e.clock_in).getTime()) / 3600000;
  }, 0);
  const clockElapsed = (isoStart) => {
    const diff = Math.floor((Date.now() - new Date(isoStart).getTime()) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const deptNeeds   = {};
  const deptDamage  = {};
  DEPARTMENTS.forEach((d) => { deptNeeds[d] = 0; deptDamage[d] = 0; });
  needs.filter((n) => n.status === 'pending').forEach((n) => {
    if (deptNeeds[n.dept] !== undefined) deptNeeds[n.dept]++;
  });
  damage.filter((d) => d.status === 'open').forEach((d) => {
    if (deptDamage[d.dept] !== undefined) deptDamage[d.dept]++;
  });
  const maxNeeds = Math.max(...Object.values(deptNeeds), 1);

  const recent = [...messages].reverse().slice(0, 5);

  return (
    <ScrollView
      style={styles.flex}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.overviewScroll}
    >
      {/* Header */}
      <View style={styles.overviewHeader}>
        <View>
          <Text style={styles.overviewTitle}>Shop Supervisor</Text>
          <Text style={styles.overviewName}>{userName}</Text>
        </View>
        <View style={styles.overviewHeaderRight}>
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
          <TouchableOpacity
            onPress={onSwitchRole}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.gearBtn}
          >
            <Ionicons name="settings-outline" size={20} color={C.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Stat cards */}
      <View style={styles.statRow}>
        <View style={[styles.statCard, { borderTopColor: C.accent }]}>
          <Text style={[styles.statValue, { color: C.accent }]}>{pendingNeeds}</Text>
          <Text style={styles.statLabel}>Pending{'\n'}Needs</Text>
        </View>
        <View style={[styles.statCard, { borderTopColor: C.error }]}>
          <Text style={[styles.statValue, { color: C.error }]}>{openDamage}</Text>
          <Text style={styles.statLabel}>Open{'\n'}Damage</Text>
        </View>
        <View style={[styles.statCard, { borderTopColor: C.success }]}>
          <Text style={[styles.statValue, { color: C.success }]}>{threads.length}</Text>
          <Text style={styles.statLabel}>Crew{'\n'}Active</Text>
        </View>
      </View>

      {/* Who's Clocked In */}
      <Text style={styles.sectionLabel}>
        {`WHO'S CLOCKED IN${totalClockHours > 0 ? ` — ${totalClockHours.toFixed(1)}h today` : ''}`}
      </Text>
      {activeClock.length === 0 ? (
        <Text style={styles.clockNoneText}>No crew clocked in yet.</Text>
      ) : (
        activeClock.map((entry) => (
          <View key={entry.id} style={styles.clockCrewRow}>
            <View style={styles.clockCrewDot} />
            <View style={styles.clockCrewInfo}>
              <Text style={styles.clockCrewName}>{entry.worker_name}</Text>
              <Text style={styles.clockCrewDept}>{entry.dept}</Text>
            </View>
            <Text style={styles.clockCrewElapsed}>{clockElapsed(entry.clock_in)}</Text>
          </View>
        ))
      )}

      {/* Dept status grid */}
      <Text style={[styles.sectionLabel, { marginTop: 20 }]}>DEPT STATUS — PENDING NEEDS</Text>
      {DEPARTMENTS.map((dept) => {
        const n   = deptNeeds[dept];
        const dmg = deptDamage[dept];
        const color = DEPT_COLORS[dept];
        const barPct = (n / maxNeeds) * 100;
        return (
          <View key={dept} style={styles.deptRow}>
            <Text style={[styles.deptRowName, { color }]}>{dept}</Text>
            <View style={styles.deptBarTrack}>
              {n > 0 && (
                <View style={[styles.deptBarFill, { width: `${barPct}%`, backgroundColor: color }]} />
              )}
            </View>
            <View style={styles.deptRowBadges}>
              {n > 0 && (
                <View style={[styles.miniPill, { backgroundColor: C.accent + '22', borderColor: C.accent + '44' }]}>
                  <Text style={[styles.miniPillText, { color: C.accent }]}>{n} need{n !== 1 ? 's' : ''}</Text>
                </View>
              )}
              {dmg > 0 && (
                <View style={[styles.miniPill, { backgroundColor: C.error + '22', borderColor: C.error + '44' }]}>
                  <Text style={[styles.miniPillText, { color: C.error }]}>{dmg} dmg</Text>
                </View>
              )}
              {n === 0 && dmg === 0 && (
                <Text style={styles.deptOkText}>✓ clear</Text>
              )}
            </View>
          </View>
        );
      })}

      {/* Recent messages */}
      {recent.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>RECENT MESSAGES</Text>
          {recent.map((m) => (
            <View key={m.id} style={styles.activityRow}>
              <View style={[styles.activityDot, { backgroundColor: m.sender_name === 'Supervisor' ? C.accent : C.success }]} />
              <View style={styles.activityBody}>
                <Text style={styles.activitySender}>
                  {m.sender_name}
                  {m.dept ? <Text style={styles.activityDept}> · {m.dept}</Text> : null}
                </Text>
                <Text style={styles.activityMsg} numberOfLines={1}>{m.body}</Text>
              </View>
              <Text style={styles.activityTime}>{formatTime(m.created_at)}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

// ── Messages Tab ──────────────────────────────────────────────
function MessagesTab({ threads, threadMsgs, activeThread, setActiveThread, msgBody, setMsgBody, sending, sendMessage, listRef }) {
  if (!activeThread) {
    return (
      <View style={styles.flex}>
        <View style={styles.tabHeader}>
          <Text style={styles.tabHeaderTitle}>Messages</Text>
          <Text style={styles.tabHeaderSub}>{threads.length} crew member{threads.length !== 1 ? 's' : ''}</Text>
        </View>
        <FlatList
          data={threads}
          keyExtractor={(t) => t.name}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="chatbubbles-outline" size={48} color={C.border} />
              <Text style={styles.emptyText}>No crew messages yet.</Text>
            </View>
          }
          renderItem={({ item: t }) => {
            const last = t.messages[t.messages.length - 1];
            return (
              <TouchableOpacity
                style={styles.threadCard}
                onPress={() => setActiveThread({ name: t.name, dept: t.dept })}
                activeOpacity={0.7}
              >
                <View style={styles.threadAvatar}>
                  <Text style={styles.threadAvatarLetter}>{t.name[0].toUpperCase()}</Text>
                </View>
                <View style={styles.threadMain}>
                  <View style={styles.threadTopRow}>
                    <Text style={styles.threadName}>{t.name}</Text>
                    {t.dept ? (
                      <View style={styles.deptPill}>
                        <Text style={styles.deptPillText}>{t.dept}</Text>
                      </View>
                    ) : null}
                  </View>
                  {last ? (
                    <Text style={styles.threadPreview} numberOfLines={1}>{last.body}</Text>
                  ) : null}
                </View>
                <View style={styles.threadRight}>
                  <Text style={styles.threadTime}>{formatTime(t.lastTime)}</Text>
                  <Ionicons name="chevron-forward" size={14} color={C.border} style={{ marginTop: 4 }} />
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      {/* Thread header */}
      <View style={styles.threadHeader}>
        <TouchableOpacity
          onPress={() => setActiveThread(null)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.threadAvatar}>
          <Text style={styles.threadAvatarLetter}>{activeThread.name[0].toUpperCase()}</Text>
        </View>
        <View>
          <Text style={styles.threadHeaderName}>{activeThread.name}</Text>
          {activeThread.dept ? (
            <Text style={styles.threadHeaderDept}>{activeThread.dept}</Text>
          ) : null}
        </View>
      </View>

      {/* Message list */}
      <FlatList
        ref={listRef}
        data={threadMsgs}
        keyExtractor={(m) => String(m.id)}
        style={styles.flex}
        contentContainerStyle={styles.msgListContent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No messages yet.</Text>
          </View>
        }
        renderItem={({ item: m }) => {
          const isOwn = m.sender_name === 'Supervisor';
          return (
            <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOut : styles.bubbleRowIn]}>
              {!isOwn && (
                <Text style={styles.bubbleSender}>{m.sender_name}</Text>
              )}
              <View style={[styles.bubble, isOwn ? styles.bubbleOut : styles.bubbleIn]}>
                <Text style={[styles.bubbleText, isOwn ? styles.bubbleTextOut : styles.bubbleTextIn]}>
                  {m.body}
                </Text>
              </View>
              <Text style={[styles.bubbleTime, isOwn ? styles.bubbleTimeRight : styles.bubbleTimeLeft]}>
                {formatTime(m.created_at)}
              </Text>
            </View>
          );
        }}
      />

      {/* Compose */}
      <View style={styles.composeBar}>
        <TextInput
          style={styles.composeInput}
          value={msgBody}
          onChangeText={setMsgBody}
          placeholder={`Reply to ${activeThread.name}…`}
          placeholderTextColor={C.muted}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!msgBody.trim() || sending) && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!msgBody.trim() || sending}
          activeOpacity={0.7}
        >
          {sending
            ? <ActivityIndicator size="small" color="#000" />
            : <Ionicons name="arrow-up" size={20} color="#000" />
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Needs Tab ─────────────────────────────────────────────────
function NeedsTab({ allNeeds, filter, setFilter, onStatusChange }) {
  const filtered = filter === 'all' ? allNeeds : allNeeds.filter((n) => n.status === filter);

  const pendingByDept = {};
  DEPARTMENTS.forEach((d) => { pendingByDept[d] = 0; });
  allNeeds.filter((n) => n.status === 'pending').forEach((n) => {
    if (pendingByDept[n.dept] !== undefined) pendingByDept[n.dept]++;
  });

  return (
    <View style={styles.flex}>
      <View style={styles.tabHeader}>
        <Text style={styles.tabHeaderTitle}>Inventory Needs</Text>
        <Text style={styles.tabHeaderSub}>{allNeeds.filter((n) => n.status === 'pending').length} pending</Text>
      </View>

      {/* Dept counters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.deptCounterRow}
        contentContainerStyle={styles.deptCounterContent}
      >
        {DEPARTMENTS.map((dept) => {
          const n = pendingByDept[dept];
          const color = DEPT_COLORS[dept];
          return (
            <View
              key={dept}
              style={[
                styles.deptCounter,
                n > 0 && { borderColor: color + '50', backgroundColor: color + '15' },
              ]}
            >
              <Text style={[styles.deptCounterNum, { color: n > 0 ? color : C.muted }]}>{n}</Text>
              <Text style={[styles.deptCounterLabel, { color: n > 0 ? color : C.muted }]}>
                {dept.slice(0, 5)}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      <FilterChips
        options={['pending', 'ordered', 'received', 'all']}
        value={filter}
        onChange={setFilter}
      />

      <FlatList
        data={filtered}
        keyExtractor={(n) => String(n.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContentPadded}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="cube-outline" size={48} color={C.border} />
            <Text style={styles.emptyText}>No {filter} needs.</Text>
          </View>
        }
        renderItem={({ item: n }) => (
          <View style={[styles.dataCard, { borderLeftColor: n.status === 'pending' ? C.accent : C.success }]}>
            <View style={styles.cardTopRow}>
              <View style={styles.cardMainBlock}>
                <Text style={styles.cardTitle}>{n.item}</Text>
                <Text style={styles.cardMeta}>
                  {n.dept}{n.job_id ? ` · Job #${n.job_id}` : ''} · Qty: {n.qty}
                </Text>
                <Text style={styles.cardDate}>{formatDate(n.created_at)}</Text>
              </View>
              <StatusPill status={n.status} />
            </View>
            {(n.status === 'pending' || n.status === 'ordered') && (
              <View style={styles.cardActionRow}>
                {n.status === 'pending' && (
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: C.blueBorder }]}
                    onPress={() => onStatusChange(n.id, 'ordered')}
                  >
                    <Text style={[styles.actionBtnText, { color: C.blue }]}>ordered</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.actionBtn, { borderColor: C.successBorder }]}
                  onPress={() => onStatusChange(n.id, 'received')}
                >
                  <Text style={[styles.actionBtnText, { color: C.success }]}>received</Text>
                </TouchableOpacity>
                {n.status === 'pending' && (
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: C.errorBorder }]}
                    onPress={() => onStatusChange(n.id, 'cancelled')}
                  >
                    <Text style={[styles.actionBtnText, { color: C.error }]}>cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

// ── Damage Tab ────────────────────────────────────────────────
function DamageTab({ allDamage, filter, setFilter, onStatusChange }) {
  const filtered = filter === 'all' ? allDamage : allDamage.filter((d) => d.status === filter);

  return (
    <View style={styles.flex}>
      <View style={styles.tabHeader}>
        <Text style={styles.tabHeaderTitle}>Damage Reports</Text>
        <Text style={styles.tabHeaderSub}>{allDamage.filter((d) => d.status === 'open').length} open</Text>
      </View>

      <FilterChips
        options={['open', 'reviewed', 'resolved', 'all']}
        value={filter}
        onChange={setFilter}
      />

      <FlatList
        data={filtered}
        keyExtractor={(d) => String(d.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContentPadded}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="warning-outline" size={48} color={C.border} />
            <Text style={styles.emptyText}>No {filter} damage reports.</Text>
          </View>
        }
        renderItem={({ item: d }) => {
          const col =
            d.status === 'open'     ? C.error  :
            d.status === 'reviewed' ? C.accent :
            C.success;
          return (
            <View style={[styles.dataCard, { borderLeftColor: col }]}>
              <View style={styles.cardTopRow}>
                <View style={styles.cardMainBlock}>
                  <Text style={styles.cardTitle}>{d.part_name}</Text>
                  <Text style={styles.cardMeta}>
                    {d.dept}{d.job_id ? ` · Job #${d.job_id}` : ''}
                  </Text>
                  {d.notes ? (
                    <Text style={styles.cardNotes}>{d.notes}</Text>
                  ) : null}
                  <Text style={styles.cardDate}>{formatDate(d.created_at)}</Text>
                </View>
                <StatusPill status={d.status} />
              </View>
              {(d.status === 'open' || d.status === 'reviewed') && (
                <View style={styles.cardActionRow}>
                  {d.status === 'open' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: C.blueBorder }]}
                      onPress={() => onStatusChange(d.id, 'reviewed')}
                    >
                      <Text style={[styles.actionBtnText, { color: C.blue }]}>reviewed</Text>
                    </TouchableOpacity>
                  )}
                  {d.status === 'reviewed' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: C.successBorder }]}
                      onPress={() => onStatusChange(d.id, 'resolved')}
                    >
                      <Text style={[styles.actionBtnText, { color: C.success }]}>resolved</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────
export default function SupervisorApp({ route, userName: userNameProp, onResetRole: onResetRoleProp }) {
  const userName    = route?.params?.userName    ?? userNameProp    ?? 'Supervisor';
  const onResetRole = route?.params?.onResetRole ?? onResetRoleProp ?? null;

  const handleSwitchRole = () => {
    Alert.alert('Switch Role', 'Leave the supervisor dashboard?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Switch Role',
        style: 'destructive',
        onPress: async () => {
          await Promise.all([
            AsyncStorage.removeItem('@sawdust_user_name'),
            AsyncStorage.removeItem('@sawdust_user_dept'),
            AsyncStorage.removeItem('@sawdust_user_role'),
          ]);
          onResetRole?.();
        },
      },
    ]);
  };

  const [messages,     setMessages]     = useState([]);
  const [needs,        setNeeds]        = useState([]);
  const [damage,       setDamage]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [activeTab,    setActiveTab]    = useState('overview');
  const [unreadMsgs,   setUnreadMsgs]   = useState(0);
  const [activeThread, setActiveThread] = useState(null);
  const [msgBody,      setMsgBody]      = useState('');
  const [sending,      setSending]      = useState(false);
  const [needsFilter,       setNeedsFilter]       = useState('pending');
  const [damageFilter,      setDamageFilter]      = useState('open');
  const [todayClockEntries, setTodayClockEntries] = useState([]);

  const msgListRef = useRef(null);
  const channels   = useRef([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const todayStr = new Date().toISOString().slice(0, 10);
    const [msgsRes, needsRes, dmgRes, clockRes] = await Promise.all([
      supabase.from('messages').select('*').order('created_at', { ascending: true }).limit(300),
      supabase.from('inventory_needs').select('*').order('created_at', { ascending: false }),
      supabase.from('damage_reports').select('*').order('created_at', { ascending: false }),
      supabase.from('time_clock').select('*').eq('date', todayStr).order('clock_in', { ascending: true }),
    ]);
    if (msgsRes.data)   setMessages(msgsRes.data);
    if (needsRes.data)  setNeeds(needsRes.data);
    if (dmgRes.data)    setDamage(dmgRes.data);
    if (clockRes.data)  setTodayClockEntries(clockRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();

    const msgCh = supabase.channel('sup-app-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === p.new.id)) return prev;
          return [...prev, p.new];
        });
        if (p.new.sender_name !== 'Supervisor') setUnreadMsgs((n) => n + 1);
      })
      .subscribe();

    const needsCh = supabase.channel('sup-app-needs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_needs' }, (p) => {
        if      (p.eventType === 'INSERT') setNeeds((prev) => [p.new, ...prev]);
        else if (p.eventType === 'UPDATE') setNeeds((prev) => prev.map((r) => r.id === p.new.id ? p.new : r));
        else if (p.eventType === 'DELETE') setNeeds((prev) => prev.filter((r) => r.id !== p.old.id));
      })
      .subscribe();

    const dmgCh = supabase.channel('sup-app-damage')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'damage_reports' }, (p) => {
        if      (p.eventType === 'INSERT') setDamage((prev) => [p.new, ...prev]);
        else if (p.eventType === 'UPDATE') setDamage((prev) => prev.map((r) => r.id === p.new.id ? p.new : r));
        else if (p.eventType === 'DELETE') setDamage((prev) => prev.filter((r) => r.id !== p.old.id));
      })
      .subscribe();

    const clockCh = supabase.channel('sup-app-timeclock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_clock' }, (p) => {
        const todayStr = new Date().toISOString().slice(0, 10);
        if (p.eventType === 'INSERT' && p.new.date === todayStr) {
          setTodayClockEntries((prev) => [...prev, p.new]);
        } else if (p.eventType === 'UPDATE') {
          setTodayClockEntries((prev) => prev.map((e) => e.id === p.new.id ? p.new : e));
        } else if (p.eventType === 'DELETE') {
          setTodayClockEntries((prev) => prev.filter((e) => e.id !== p.old.id));
        }
      })
      .subscribe();

    channels.current = [msgCh, needsCh, dmgCh, clockCh];
    return () => channels.current.forEach((ch) => supabase.removeChannel(ch));
  }, []);

  useEffect(() => {
    if (activeThread) {
      setTimeout(() => msgListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length, activeThread]);

  const sendMessage = async () => {
    const trimmed = msgBody.trim();
    if (!trimmed || sending) return;

    const optimistic = {
      id:          `opt-${Date.now()}`,
      sender_name: 'Supervisor',
      dept:        'Management',
      body:        trimmed,
      created_at:  new Date().toISOString(),
    };

    setMsgBody('');
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);

    const { data, error } = await supabase
      .from('messages')
      .insert({ sender_name: 'Supervisor', dept: 'Management', body: trimmed })
      .select()
      .single();

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setMsgBody(trimmed);
    } else {
      setMessages((prev) => {
        const without = prev.filter((m) => m.id !== optimistic.id);
        if (without.some((m) => m.id === data.id)) return without;
        return [...without, data];
      });
    }
    setSending(false);
  };

  const updateNeedStatus = async (id, status) => {
    setNeeds((prev) => prev.map((n) => n.id === id ? { ...n, status } : n));
    await supabase.from('inventory_needs').update({ status }).eq('id', id);
  };

  const updateDamageStatus = async (id, status) => {
    setDamage((prev) => prev.map((d) => d.id === id ? { ...d, status } : d));
    await supabase.from('damage_reports').update({ status }).eq('id', id);
  };

  const handleTabPress = (key) => {
    if (key === 'messages') setUnreadMsgs(0);
    if (key !== 'messages' && activeThread) setActiveThread(null);
    setActiveTab(key);
  };

  // Thread map
  const threadMap = {};
  messages.forEach((m) => {
    if (m.sender_name === 'Supervisor') return;
    const key = m.sender_name;
    if (!threadMap[key]) {
      threadMap[key] = { name: m.sender_name, dept: m.dept, messages: [], lastTime: m.created_at };
    }
    threadMap[key].messages.push(m);
    if (m.created_at > threadMap[key].lastTime) threadMap[key].lastTime = m.created_at;
  });
  const threads = Object.values(threadMap).sort((a, b) => b.lastTime.localeCompare(a.lastTime));

  const threadMsgs = activeThread
    ? messages
        .filter((m) => m.sender_name === activeThread.name || m.sender_name === 'Supervisor')
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    : [];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={styles.flex}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={C.accent} />
          </View>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewTab
                needs={needs}
                damage={damage}
                messages={messages}
                threads={threads}
                userName={userName}
                onSwitchRole={handleSwitchRole}
                todayClockEntries={todayClockEntries}
              />
            )}
            {activeTab === 'messages' && (
              <MessagesTab
                threads={threads}
                threadMsgs={threadMsgs}
                activeThread={activeThread}
                setActiveThread={setActiveThread}
                msgBody={msgBody}
                setMsgBody={setMsgBody}
                sending={sending}
                sendMessage={sendMessage}
                listRef={msgListRef}
              />
            )}
            {activeTab === 'needs' && (
              <NeedsTab
                allNeeds={needs}
                filter={needsFilter}
                setFilter={setNeedsFilter}
                onStatusChange={updateNeedStatus}
              />
            )}
            {activeTab === 'damage' && (
              <DamageTab
                allDamage={damage}
                filter={damageFilter}
                setFilter={setDamageFilter}
                onStatusChange={updateDamageStatus}
              />
            )}
          </>
        )}
      </View>

      {/* Custom tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          const badge  = tab.key === 'messages' ? unreadMsgs : 0;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tabItem}
              onPress={() => handleTabPress(tab.key)}
              activeOpacity={0.7}
            >
              {active && <View style={styles.tabAccent} />}
              <View>
                <Ionicons
                  name={active ? tab.activeIcon : tab.icon}
                  size={22}
                  color={active ? C.accent : C.muted}
                />
                {badge > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{badge > 9 ? '9+' : badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.bg },
  flex:    { flex: 1 },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Overview
  overviewScroll: { paddingHorizontal: 16, paddingBottom: 32 },
  overviewHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingTop: 16, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 16,
  },
  overviewTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  overviewName:  { fontSize: 13, color: C.muted, marginTop: 2 },
  overviewHeaderRight: { alignItems: 'flex-end', gap: 8 },
  liveRow:       { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: C.success },
  liveText:      { fontSize: 11, color: C.success, fontWeight: '600' },
  gearBtn:       { padding: 2 },

  // Stat cards
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderTopWidth: 3, alignItems: 'flex-start',
  },
  statValue: { fontSize: 32, fontWeight: '700', marginBottom: 4 },
  statLabel: { fontSize: 11, color: C.muted, fontWeight: '600', lineHeight: 15 },

  // Dept rows
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: C.muted,
    letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 10,
  },
  deptRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10,
  },
  deptRowName:   { width: 80, fontSize: 12, fontWeight: '600' },
  deptBarTrack:  { flex: 1, height: 4, backgroundColor: C.surface, borderRadius: 2, overflow: 'hidden' },
  deptBarFill:   { height: '100%', borderRadius: 2 },
  deptRowBadges: { flexDirection: 'row', gap: 4, minWidth: 70, justifyContent: 'flex-end' },
  miniPill: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 99, borderWidth: 1,
  },
  miniPillText: { fontSize: 10, fontWeight: '700' },
  deptOkText:   { fontSize: 10, color: C.success, fontWeight: '600' },

  // Activity
  activityRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  activityDot:   { width: 7, height: 7, borderRadius: 4, marginTop: 5 },
  activityBody:  { flex: 1 },
  activitySender:{ fontSize: 12, fontWeight: '700', color: C.text, marginBottom: 1 },
  activityDept:  { fontWeight: '400', color: C.muted },
  activityMsg:   { fontSize: 12, color: C.muted },
  activityTime:  { fontSize: 11, color: C.muted, flexShrink: 0 },

  // Tab header (inside each section)
  tabHeader: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tabHeaderTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  tabHeaderSub:   { fontSize: 13, color: C.muted },

  // Filter chips
  filterRow:        { paddingLeft: 16, marginBottom: 4, marginTop: 8, flexGrow: 0 },
  filterRowContent: { gap: 8, paddingRight: 16 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: C.surface,
    borderWidth: 1.5, borderColor: C.border,
  },
  filterChipActive:     { backgroundColor: C.accent, borderColor: C.accent },
  filterChipText:       { fontSize: 13, fontWeight: '600', color: C.muted },
  filterChipTextActive: { color: '#000' },

  // Dept counters (Needs tab)
  deptCounterRow:    { paddingLeft: 16, marginBottom: 4, marginTop: 8, flexGrow: 0 },
  deptCounterContent:{ gap: 8, paddingRight: 16 },
  deptCounter: {
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 10, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', minWidth: 52,
  },
  deptCounterNum:   { fontSize: 18, fontWeight: '700', marginBottom: 2 },
  deptCounterLabel: { fontSize: 9,  fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },

  // Lists
  listContent:       { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  listContentPadded: { paddingHorizontal: 16, paddingTop: 8,  paddingBottom: 100 },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: C.muted, fontSize: 15, textAlign: 'center' },

  // Threads
  threadCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: '#222',
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 10,
  },
  threadAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: C.accent + '33',
    justifyContent: 'center', alignItems: 'center',
  },
  threadAvatarLetter: { fontSize: 17, fontWeight: '700', color: C.accent },
  threadMain:         { flex: 1 },
  threadTopRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  threadName:         { fontSize: 15, fontWeight: '700', color: C.text },
  threadPreview:      { fontSize: 13, color: C.muted },
  threadRight:        { alignItems: 'flex-end' },
  threadTime:         { fontSize: 11, color: C.muted },
  deptPill: {
    backgroundColor: C.surface, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: C.border,
  },
  deptPillText: { fontSize: 10, color: C.muted, fontWeight: '600' },

  // Thread conversation
  threadHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
  threadHeaderName: { fontSize: 15, fontWeight: '700', color: C.text },
  threadHeaderDept: { fontSize: 12, color: C.muted, marginTop: 1 },

  // Message bubbles
  msgListContent: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, flexGrow: 1,
  },
  bubbleRow:     { marginBottom: 12, maxWidth: '78%' },
  bubbleRowOut:  { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleRowIn:   { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubbleSender:  { fontSize: 11, color: C.muted, fontWeight: '600', marginBottom: 3, marginLeft: 2 },
  bubble:        { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOut:     { backgroundColor: '#1a3a1a', borderBottomRightRadius: 4 },
  bubbleIn:      { backgroundColor: '#1e1e1e', borderBottomLeftRadius: 4 },
  bubbleText:    { fontSize: 15, lineHeight: 21 },
  bubbleTextOut: { color: '#86efac' },
  bubbleTextIn:  { color: C.text },
  bubbleTime:    { fontSize: 10, color: C.muted, marginTop: 3 },
  bubbleTimeRight: { marginRight: 2 },
  bubbleTimeLeft:  { marginLeft: 2 },

  // Compose bar
  composeBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg,
  },
  composeInput: {
    flex: 1, backgroundColor: C.input, borderRadius: 24,
    borderWidth: 1.5, borderColor: C.border, color: C.text,
    fontSize: 16, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    maxHeight: 120,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: C.border },

  // Data cards (Needs / Damage)
  dataCard: {
    backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: '#222',
    borderLeftWidth: 4, padding: 14, marginBottom: 10,
  },
  cardTopRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardMainBlock: { flex: 1, marginRight: 12 },
  cardTitle:     { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 4 },
  cardMeta:      { fontSize: 12, color: C.muted, marginBottom: 2 },
  cardNotes:     { fontSize: 12, color: C.text, fontStyle: 'italic', opacity: 0.7, marginTop: 2, marginBottom: 2 },
  cardDate:      { fontSize: 11, color: C.muted, marginTop: 2 },
  cardActionRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  actionBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, backgroundColor: C.input,
    borderWidth: 1.5, borderColor: C.border,
  },
  actionBtnText: { fontSize: 12, fontWeight: '700' },

  // Status pill
  pill: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1, alignSelf: 'flex-start',
  },
  pillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  // Bottom tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    borderTopWidth: 1, borderTopColor: C.border,
    paddingBottom: 6, paddingTop: 4, height: 62,
  },
  tabItem: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'visible',
  },
  tabAccent: {
    position: 'absolute', top: 0, left: 10, right: 10,
    height: 2.5, backgroundColor: C.accent,
    borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
  },
  tabLabel:       { fontSize: 10, fontWeight: '600', color: C.muted, marginTop: 3 },
  tabLabelActive: { color: C.accent },
  tabBadge: {
    position: 'absolute', top: -4, right: -6,
    backgroundColor: '#ef4444', borderRadius: 8,
    minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3,
  },
  tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },

  // Clock crew rows (Overview tab)
  clockNoneText: { fontSize: 12, color: C.muted, marginBottom: 12 },
  clockCrewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: C.surface, borderRadius: 10,
    borderWidth: 1, borderColor: '#222',
    borderLeftWidth: 3, borderLeftColor: '#22c55e',
    marginBottom: 6,
  },
  clockCrewDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },
  clockCrewInfo:    { flex: 1 },
  clockCrewName:    { fontSize: 13, fontWeight: '700', color: C.text },
  clockCrewDept:    { fontSize: 11, color: C.muted, marginTop: 1 },
  clockCrewElapsed: { fontSize: 13, color: '#22c55e', fontWeight: '600' },
});
