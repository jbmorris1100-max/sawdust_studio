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
  Switch,
  Animated,
  PanResponder,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { getTenantId } from '../lib/tenant';
import MorningBriefScreen from './MorningBriefScreen';
import { T, DEPT_COLORS as BASE_DEPT_COLORS, STATUS_COLORS, DEPARTMENTS } from '../lib/theme';

// ── Design tokens ─────────────────────────────────────────────
const C = {
  ...T,
  // Backward-compatible aliases
  error:      T.danger,
  errorBg:    T.dangerBg,
  errorBorder:T.dangerBorder,
  blue:       T.violet,
  blueBg:     T.violetBg,
  blueBorder: T.violetBorder,
};

const DEPT_COLORS = {
  Production: '#5EEAD4',
  Assembly:   '#34D399',
  Finishing:  '#FBBF24',
  Craftsman:  '#A78BFA',
};

const STATUS_STYLES = STATUS_COLORS;

const TABS = [
  { key: 'brief',    label: 'Brief',    icon: 'newspaper-outline',     activeIcon: 'newspaper'     },
  { key: 'overview', label: 'Overview', icon: 'grid-outline',          activeIcon: 'grid'          },
  { key: 'messages', label: 'Messages', icon: 'chatbubble-outline',    activeIcon: 'chatbubbles'   },
  { key: 'needs',    label: 'Needs',    icon: 'cube-outline',           activeIcon: 'cube'          },
  { key: 'damage',   label: 'Damage',   icon: 'warning-outline',        activeIcon: 'warning'       },
  { key: 'ai',       label: 'AI',       icon: 'hardware-chip-outline',  activeIcon: 'hardware-chip' },
];

const BOTTLENECK_OPTIONS = [
  'Material delay', 'Machine down', 'Understaffed', 'Design change',
  'QC rework', 'Install issue', 'Supply shortage', 'Weather',
];

const RESOLUTION_TYPES = [
  'Rework Order', 'Material Ordered', 'Repaired On Site',
  'Credited to Client', 'Written Off', 'Other',
];

const MODE_INFO = {
  observation: { label: 'Observation',  desc: 'Silently logs data. No suggestions.',       color: '#22c55e' },
  assist:      { label: 'Assist',       desc: 'Surfaces insights. You decide.',             color: '#00C5CC' },
  autonomous:  { label: 'Autonomous',   desc: 'Proactively flags bottlenecks & schedules.', color: '#ef4444' },
};

const FEATURE_LABELS = {
  learning_active:           'Learning Active',
  daily_standup_active:      'Daily Standup',
  bottleneck_alerts_active:  'Bottleneck Alerts',
  cost_forecasting_active:   'Cost Forecasting',
  crew_scheduling_active:    'Crew Scheduling',
  inventory_patterns_active: 'Inventory Patterns',
  qc_failure_alerts_active:  'QC Failure Alerts',
};

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

// ── Swipeable row with Alert confirmation (for messages) ──────
function SwipeableMessageRow({ onDelete, children }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const DELETE_WIDTH = 72;

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 6,
    onPanResponderMove: (_, g) => {
      if (g.dx < 0) translateX.setValue(Math.max(g.dx, -DELETE_WIDTH - 20));
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < -DELETE_WIDTH / 2) {
        Animated.spring(translateX, { toValue: -DELETE_WIDTH, useNativeDriver: true }).start();
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  const snapBack = () =>
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();

  const handleDeleteTap = () => {
    Alert.alert(
      'Delete message?',
      'This message will be permanently removed for everyone.',
      [
        { text: 'Cancel', style: 'cancel', onPress: snapBack },
        {
          text: 'Delete', style: 'destructive',
          onPress: () =>
            Animated.timing(translateX, { toValue: -400, duration: 180, useNativeDriver: true })
              .start(() => onDelete()),
        },
      ]
    );
  };

  return (
    <View style={{ overflow: 'hidden' }}>
      <View style={[styles.swipeDeleteBg, { width: DELETE_WIDTH }]}>
        <TouchableOpacity onPress={handleDeleteTap} style={styles.swipeDeleteBtn}>
          <Text style={styles.swipeDeleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }], backgroundColor: C.bg }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

// ── Swipeable row (left-swipe to reveal Delete) ───────────────
function SwipeableRow({ onDelete, children }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const DELETE_WIDTH = 72;

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 6,
    onPanResponderMove: (_, g) => {
      if (g.dx < 0) translateX.setValue(Math.max(g.dx, -DELETE_WIDTH - 20));
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < -DELETE_WIDTH / 2) {
        Animated.spring(translateX, { toValue: -DELETE_WIDTH, useNativeDriver: true }).start();
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  const handleDelete = () => {
    Animated.timing(translateX, { toValue: -400, duration: 180, useNativeDriver: true })
      .start(() => onDelete());
  };

  return (
    <View style={{ overflow: 'hidden' }}>
      <View style={[styles.swipeDeleteBg, { width: DELETE_WIDTH }]}>
        <TouchableOpacity onPress={handleDelete} style={styles.swipeDeleteBtn}>
          <Text style={styles.swipeDeleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }], backgroundColor: C.bg }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

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
const SCAN_STATUS_COLORS = {
  'In Progress':              { color: '#2DE1C9', bg: 'rgba(45,225,201,0.06)'  },
  'QC Check':                 { color: '#A78BFA', bg: 'rgba(167,139,250,0.06)' },
  'Passed QC':                { color: '#34D399', bg: 'rgba(52,211,153,0.06)'  },
  'Failed QC — Rework':       { color: '#F87171', bg: 'rgba(248,113,113,0.06)' },
  'Moving to Next Stage':     { color: '#5EEAD4', bg: 'rgba(94,234,212,0.06)'  },
  'approved_incoming':        { color: '#34D399', bg: 'rgba(52,211,153,0.06)'  },
};

function scanColor(status) {
  return SCAN_STATUS_COLORS[status] ?? { color: '#555', bg: '#141414' };
}

function OverviewTab({ needs, damage, messages, threads, timeClock, userName, onSwitchRole, dismissedMsgIds, onDismissMsg, onOpenThread, partScans, unreadNeeds, unreadDamage, unreadMsgs, onNavigateTab }) {
  const pendingNeeds = needs.filter((n) => n.status === 'pending').length;
  const openDamage   = damage.filter((d) => d.status === 'open').length;

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
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Notification banner */}
      {(unreadNeeds > 0 || unreadDamage > 0 || unreadMsgs > 0) && (
        <View style={styles.notifBanner}>
          <Ionicons name="notifications" size={13} color={C.error} style={{ marginTop: 1 }} />
          {unreadNeeds > 0 && (
            <TouchableOpacity onPress={() => onNavigateTab('needs')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.notifItem, { color: C.accent }]}>
                {unreadNeeds} new need{unreadNeeds !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          )}
          {unreadDamage > 0 && (
            <TouchableOpacity onPress={() => onNavigateTab('damage')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.notifItem, { color: C.error }]}>
                {unreadDamage} damage report{unreadDamage !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          )}
          {unreadMsgs > 0 && (
            <TouchableOpacity onPress={() => onNavigateTab('messages')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.notifItem, { color: C.success }]}>
                {unreadMsgs} message{unreadMsgs !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* KPI stat cards */}
      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <View style={[styles.statAccent, { backgroundColor: C.accent }]} />
          <Text style={styles.statLabel}>PENDING NEEDS</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={styles.statValue}>{pendingNeeds}</Text>
          </View>
        </View>
        <View style={styles.statCard}>
          <View style={[styles.statAccent, { backgroundColor: C.error }]} />
          <Text style={styles.statLabel}>OPEN DAMAGE</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={[styles.statValue, { color: openDamage > 0 ? C.error : C.text }]}>{openDamage}</Text>
          </View>
        </View>
        <View style={styles.statCard}>
          <View style={[styles.statAccent, { backgroundColor: C.success }]} />
          <Text style={styles.statLabel}>CREW ACTIVE</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={[styles.statValue, { color: C.success }]}>{(timeClock || []).length}</Text>
          </View>
        </View>
      </View>

      {/* Parts In Progress */}
      {(partScans || []).length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>PARTS IN PROGRESS</Text>
          {(() => {
            const grouped = {};
            (partScans || []).slice(0, 20).forEach((s) => {
              const key = s.job_id || '—';
              if (!grouped[key]) grouped[key] = [];
              grouped[key].push(s);
            });
            return Object.entries(grouped).map(([jobKey, scans]) => (
              <View key={jobKey} style={styles.partJobGroup}>
                {jobKey !== '—' && (
                  <Text style={styles.partJobLabel}>Job #{jobKey}</Text>
                )}
                {scans.map((s) => {
                  const sc = scanColor(s.status);
                  const label = s.status === 'approved_incoming' ? 'Approved In' : (s.status || 'logged');
                  return (
                    <View key={s.id} style={[styles.partScanRow, { borderLeftColor: sc.color, backgroundColor: sc.bg }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.partScanNum}>{s.part_num}</Text>
                        <Text style={styles.partScanMeta}>
                          {s.dept}
                          {s.scanned_by ? ` · ${s.scanned_by}` : ''}
                          {s.next_dept ? ` → ${s.next_dept}` : ''}
                        </Text>
                        {s.notes ? <Text style={styles.partScanNotes}>{s.notes}</Text> : null}
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <View style={[styles.partStatusPill, { borderColor: sc.color + '60' }]}>
                          <Text style={[styles.partStatusText, { color: sc.color }]}>{label.toUpperCase()}</Text>
                        </View>
                        <Text style={styles.partScanTime}>
                          {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ));
          })()}
        </>
      )}

      {/* Who's Working Now */}
      {(timeClock || []).length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>WHO'S WORKING NOW</Text>
          {(timeClock || []).map((entry) => (
            <View key={entry.id} style={[styles.dataCard, { borderLeftColor: C.success, marginBottom: 8 }]}>
              <View style={styles.cardTopRow}>
                <View style={styles.cardMainBlock}>
                  <Text style={styles.cardTitle}>{entry.employee_name || entry.worker_name || '—'}</Text>
                  <Text style={styles.cardMeta}>
                    {entry.dept || ''}
                    {entry.job_name ? ` · ${entry.job_name}` : ''}
                  </Text>
                </View>
                <Text style={[styles.cardDate, { color: C.success }]}>
                  {entry.clock_in ? `In ${formatTime(entry.clock_in)}` : ''}
                </Text>
              </View>
            </View>
          ))}
        </>
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
          {recent
            .filter((m) => !dismissedMsgIds?.includes(m.id))
            .map((m) => {
              const thread = threads.find((t) => t.name === m.sender_name);
              return (
                <SwipeableRow key={m.id} onDelete={() => onDismissMsg(m.id)}>
                  <TouchableOpacity
                    style={styles.activityRow}
                    onPress={() => thread && onOpenThread({ name: thread.name, dept: thread.dept })}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.activityDot, { backgroundColor: m.sender_name === 'Supervisor' ? C.accent : C.success }]} />
                    <View style={styles.activityBody}>
                      <Text style={styles.activitySender}>
                        {m.sender_name}
                        {m.dept ? <Text style={styles.activityDept}> · {m.dept}</Text> : null}
                      </Text>
                      <Text style={styles.activityMsg} numberOfLines={1}>{m.body}</Text>
                    </View>
                    <Text style={styles.activityTime}>{formatTime(m.created_at)}</Text>
                    <Ionicons name="chevron-forward" size={14} color={C.border} style={{ marginLeft: 2 }} />
                  </TouchableOpacity>
                </SwipeableRow>
              );
            })}
        </>
      )}
    </ScrollView>
  );
}

// ── Messages Tab ──────────────────────────────────────────────
function MessagesTab({ threads, threadMsgs, activeThread, setActiveThread, msgBody, setMsgBody, sending, sendMessage, listRef, onDeleteMsg, onDeleteThread }) {
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
              <View style={styles.threadCard}>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
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
                <TouchableOpacity
                  onPress={() => onDeleteThread(t)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{ paddingLeft: 10 }}
                >
                  <Ionicons name="trash-outline" size={18} color="#F87171" />
                </TouchableOpacity>
              </View>
            );
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
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
          const bubble = (
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
          return bubble;
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
    </View>
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
function DamageTab({ allDamage, filter, setFilter, onStatusChange, onResolve, onArchive, userName }) {
  const filtered = (filter === 'all' ? allDamage : allDamage.filter((d) => d.status === filter));
  const [resolveItem, setResolveItem] = useState(null);
  const [resType,     setResType]     = useState('');
  const [resNotes,    setResNotes]    = useState('');
  const [resBy,       setResBy]       = useState('');
  const [resolving,   setResolving]   = useState(false);

  const openResolve = (item) => {
    setResolveItem(item);
    setResType('Rework Order');
    setResNotes('');
    setResBy(userName || '');
  };

  const submitResolve = async () => {
    if (!resType || !resolveItem || resolving) return;
    setResolving(true);
    await onResolve(resolveItem.id, {
      resolution_type:  resType,
      resolution_notes: resNotes.trim() || null,
      resolved_by:      resBy.trim() || null,
      resolved_at:      new Date().toISOString(),
      status:           'resolved',
    });
    setResolving(false);
    setResolveItem(null);
  };

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
            <View style={[styles.dataCard, { borderLeftColor: col, opacity: d.archived ? 0.45 : 1 }]}>
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
                  {d.archived ? (
                    <Text style={{ fontSize: 10, color: C.muted, marginTop: 4, fontStyle: 'italic' }}>archived by crew</Text>
                  ) : null}
                  {d.resolution_type ? (
                    <View style={{ marginTop: 8, backgroundColor: C.successBg, borderRadius: 8, borderWidth: 1, borderColor: C.successBorder, padding: 8 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: C.success, marginBottom: 2 }}>{d.resolution_type}</Text>
                      {d.resolution_notes ? (
                        <Text style={{ fontSize: 12, color: C.success, fontStyle: 'italic', opacity: 0.8 }}>{d.resolution_notes}</Text>
                      ) : null}
                      {d.resolved_by ? (
                        <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Resolved by {d.resolved_by}</Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 8 }}>
                  <StatusPill status={d.status} />
                  {d.status === 'resolved' && !d.archived && onArchive ? (
                    <TouchableOpacity
                      onPress={() => Alert.alert(
                        'Archive report?',
                        'This will be hidden from the crew view but remain in the supervisor report.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Archive', style: 'destructive', onPress: () => onArchive(d.id) },
                        ]
                      )}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="trash-outline" size={16} color={C.error} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
              {!d.archived && (
                <View style={styles.cardActionRow}>
                  {d.status === 'open' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: C.blueBorder }]}
                      onPress={() => onStatusChange(d.id, 'reviewed')}
                    >
                      <Text style={[styles.actionBtnText, { color: C.blue }]}>reviewed</Text>
                    </TouchableOpacity>
                  )}
                  {d.status !== 'resolved' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: C.successBorder }]}
                      onPress={() => openResolve(d)}
                    >
                      <Text style={[styles.actionBtnText, { color: C.success }]}>Resolve</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        }}
      />

      {resolveItem ? (
        <Modal visible animationType="slide" transparent>
          <KeyboardAvoidingView
            style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.8)' }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40, maxHeight: '90%', borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 14 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, letterSpacing: -0.3 }}>Resolve Report</Text>
                <TouchableOpacity onPress={() => setResolveItem(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color={C.muted} />
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 13, color: C.muted, marginBottom: 16 }} numberOfLines={1}>
                {resolveItem.part_name}{resolveItem.job_id ? ` · Job #${resolveItem.job_id}` : ''}
              </Text>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={{ fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>Resolution Type</Text>
                <View style={styles.bottleneckGrid}>
                  {RESOLUTION_TYPES.map((t) => {
                    const sel = resType === t;
                    return (
                      <TouchableOpacity
                        key={t}
                        style={[styles.bChip, sel && styles.bChipActive]}
                        onPress={() => setResType(t)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.bChipText, sel && styles.bChipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={{ fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 }}>Notes (Optional)</Text>
                <TextInput
                  placeholder="Additional details..."
                  placeholderTextColor={C.muted}
                  value={resNotes}
                  onChangeText={setResNotes}
                  multiline
                  numberOfLines={3}
                  style={[styles.aiInput, { minHeight: 70, textAlignVertical: 'top', paddingTop: 10 }]}
                />
                <Text style={{ fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 14, marginBottom: 8 }}>Resolved By</Text>
                <TextInput
                  style={styles.aiInput}
                  value={resBy}
                  onChangeText={setResBy}
                  placeholder="Supervisor name"
                  placeholderTextColor={C.muted}
                />
                <TouchableOpacity
                  style={[styles.aiSubmitBtn, { marginTop: 20 }, (!resType || resolving) && { opacity: 0.4 }]}
                  onPress={submitResolve}
                  disabled={!resType || resolving}
                  activeOpacity={0.8}
                >
                  {resolving
                    ? <ActivityIndicator size="small" color="#000" />
                    : <Text style={styles.aiSubmitBtnText}>Save Resolution</Text>
                  }
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </View>
  );
}

// ── AI Control Center Tab ─────────────────────────────────────
function AIControlCenterTab({ userName, needs, damage, messages, timeClock }) {
  const [panel, setPanel] = useState('assistant');

  // Panel 1: Assistant
  const [chatHistory,  setChatHistory]  = useState([]);
  const [chatInput,    setChatInput]    = useState('');
  const [chatLoading,  setChatLoading]  = useState(false);
  const chatListRef = useRef(null);

  // Panel 2: Learning
  const [settings,        setSettings]        = useState(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingToggle,    setSavingToggle]    = useState(null);
  const [dailyBottlenecks, setDailyBottlenecks] = useState([]);
  const [externalFactors,  setExternalFactors]  = useState('');
  const [outputRating,     setOutputRating]     = useState(0);
  const [dailyNotes,       setDailyNotes]       = useState('');
  const [submittingDaily,  setSubmittingDaily]  = useState(false);
  const [dailySubmitted,   setDailySubmitted]   = useState(false);
  const [logCount,   setLogCount]   = useState(null);
  const [inputCount, setInputCount] = useState(null);

  // Panel 3: Insights
  const [insights,        setInsights]        = useState([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('ai_settings').select('*').limit(1).maybeSingle();
      setSettings(data);
      setLoadingSettings(false);
      const today = new Date().toISOString().slice(0, 10);
      const [logRes, inputRes, todayInputRes] = await Promise.all([
        supabase.from('ai_learning_log').select('id', { count: 'exact', head: true }),
        supabase.from('ai_daily_input').select('id', { count: 'exact', head: true }),
        supabase.from('ai_daily_input').select('id').eq('date', today).limit(1),
      ]);
      setLogCount(logRes.count ?? 0);
      setInputCount(inputRes.count ?? 0);
      if (todayInputRes.data?.length > 0) setDailySubmitted(true);
    })();
  }, []);

  const toggleFeature = async (key) => {
    if (!settings) return;
    setSavingToggle(key);
    const newVal = !settings[key];
    const updated = { ...settings, [key]: newVal, updated_by: userName, updated_at: new Date().toISOString() };
    setSettings(updated);
    await supabase.from('ai_settings').update({ [key]: newVal, updated_by: userName, updated_at: updated.updated_at }).eq('id', settings.id);
    setSavingToggle(null);
  };

  const submitDailyInput = async () => {
    if (outputRating === 0) {
      Alert.alert('Rating required', 'Please select an output rating.');
      return;
    }
    setSubmittingDaily(true);
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('ai_daily_input').insert({
      date: today, supervisor_name: userName,
      bottlenecks: JSON.stringify(dailyBottlenecks),
      external_factors: externalFactors.trim() || null,
      output_rating: outputRating,
      notes: dailyNotes.trim() || null,
    });
    setSubmittingDaily(false);
    setDailySubmitted(true);
    setInputCount((n) => (n ?? 0) + 1);
  };

  const buildSystemPrompt = () => {
    const openDmg     = damage.filter(d => d.status === 'open');
    const pendingMats = needs.filter(n => n.status === 'pending');
    const yesterday   = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentMsgs  = messages.filter(m => new Date(m.created_at) > yesterday);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const dmgList   = openDmg.slice(0, 5).map(d => `  - ${d.part_name} (${d.dept}${d.job_id ? `, Job #${d.job_id}` : ''})`).join('\n');
    const needsList = pendingMats.slice(0, 5).map(n => `  - ${n.item} ×${n.qty} (${n.dept}${n.job_id ? `, Job #${n.job_id}` : ''})`).join('\n');
    const crewList  = (timeClock || []).slice(0, 10).map(e => `  - ${e.worker_name || e.employee_name || '?'} (${e.dept || '?'})`).join('\n');
    return `You are InlineIQ, an AI assistant for a cabinet manufacturing shop floor. You have access to real-time data from this shop including work orders, crew time logs, damage reports, inventory needs, and production metrics. Answer questions concisely and practically. Focus on actionable insights that help the supervisor run a more efficient and profitable shop.

Today is ${today}.

ACTIVE CREW (${(timeClock || []).length} clocked in):
${crewList || '  None'}

OPEN DAMAGE REPORTS (${openDmg.length}):
${dmgList || '  None'}

PENDING INVENTORY NEEDS (${pendingMats.length}):
${needsList || '  None'}

RECENT MESSAGES: ${recentMsgs.length} crew messages in the last 24h

Keep answers short and actionable. If you don't have enough data, say so.`;
  };

  const callClaude = async (msgs, system, maxTokens = 1024) => {
    const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_KEY;
    if (!apiKey) throw new Error('EXPO_PUBLIC_ANTHROPIC_KEY not set in .env.local');
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system, messages: msgs }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    return data.content?.[0]?.text ?? '';
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const newHistory = [...chatHistory, { role: 'user', content: text }];
    setChatHistory(newHistory);
    setChatInput('');
    setChatLoading(true);
    try {
      const reply = await callClaude(newHistory, buildSystemPrompt());
      setChatHistory(h => [...h, { role: 'assistant', content: reply }]);
    } catch (e) {
      setChatHistory(h => [...h, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    }
    setChatLoading(false);
  };

  const generateInsights = async () => {
    setInsightsLoading(true);
    setInsights([]);
    try {
      const { data: recentInputs } = await supabase
        .from('ai_daily_input').select('*').order('date', { ascending: false }).limit(30);

      const openDmg     = damage.filter(d => d.status === 'open');
      const pendingMats = needs.filter(n => n.status === 'pending');

      const deptDmg = {};
      damage.forEach(d => { deptDmg[d.dept] = (deptDmg[d.dept] || 0) + 1; });
      const topDmgDept = Object.entries(deptDmg).sort((a, b) => b[1] - a[1])[0];

      const itemFreq = {};
      needs.forEach(n => { itemFreq[n.item] = (itemFreq[n.item] || 0) + 1; });
      const topItem = Object.entries(itemFreq).sort((a, b) => b[1] - a[1])[0];

      const dayFreq = {};
      needs.forEach(n => {
        const day = new Date(n.created_at).toLocaleDateString('en-US', { weekday: 'long' });
        dayFreq[day] = (dayFreq[day] || 0) + 1;
      });
      const busyDay = Object.entries(dayFreq).sort((a, b) => b[1] - a[1])[0];

      const bottlenecks = recentInputs?.length > 0
        ? [...new Set(recentInputs.flatMap(d => { try { return JSON.parse(d.bottlenecks || '[]'); } catch { return []; } }))]
        : [];
      const avgRating = recentInputs?.length > 0
        ? (recentInputs.reduce((s, d) => s + (d.output_rating || 0), 0) / recentInputs.length).toFixed(1)
        : null;

      const openDmgByDept = openDmg.reduce((acc, d) => ({ ...acc, [d.dept]: (acc[d.dept] || 0) + 1 }), {});

      const context = [
        `Damage reports: total=${damage.length}, open=${openDmg.length}`,
        topDmgDept ? `Most damage dept: ${topDmgDept[0]} (${topDmgDept[1]} reports)` : '',
        `Open damage by dept: ${Object.entries(openDmgByDept).map(([k,v]) => `${k}:${v}`).join(', ') || 'none'}`,
        `Inventory needs: total=${needs.length}, pending=${pendingMats.length}`,
        topItem ? `Most requested item: "${topItem[0]}" (${topItem[1]} times)` : '',
        busyDay ? `Busiest day for requests: ${busyDay[0]} (${busyDay[1]} requests)` : '',
        recentInputs?.length > 0
          ? `Supervisor check-ins (${recentInputs.length} days): avg rating=${avgRating}/5, bottlenecks=[${bottlenecks.join(', ')}]`
          : 'No supervisor check-in data yet.',
      ].filter(Boolean).join('\n');

      const raw = await callClaude(
        [{ role: 'user', content: context }],
        'You are an operations analyst for a cabinet manufacturing shop. Generate 3-4 specific, actionable insights based on the provided data. Format as JSON array only: [{"text":"...","confidence":"High|Medium|Low","basis":"..."}]',
        1200
      );
      const match = raw.match(/\[[\s\S]*\]/);
      const parsed = JSON.parse(match ? match[0] : '[]');
      setInsights(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
      setInsights([{ text: `⚠️ ${e.message}`, confidence: 'N/A', basis: 'Error' }]);
    }
    setInsightsLoading(false);
  };

  const PANELS = [
    { key: 'assistant', label: 'Assistant' },
    { key: 'learning',  label: 'Learning'  },
    { key: 'insights',  label: 'Insights'  },
  ];

  return (
    <View style={styles.flex}>
      {/* Header + panel switcher */}
      <View style={styles.aiTabHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="hardware-chip" size={18} color={C.accent} />
          <Text style={styles.aiHeaderTitle}>InlineIQ</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {PANELS.map(p => (
            <TouchableOpacity
              key={p.key}
              style={[styles.aiPanelBtn, panel === p.key && styles.aiPanelBtnActive]}
              onPress={() => setPanel(p.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.aiPanelBtnText, panel === p.key && styles.aiPanelBtnTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── PANEL 1: ASSISTANT ── */}
      {panel === 'assistant' && (
        <>
          <FlatList
            ref={chatListRef}
            data={chatHistory}
            keyExtractor={(_, i) => String(i)}
            style={styles.flex}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => chatListRef.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 40, gap: 14, paddingHorizontal: 24 }}>
                <Ionicons name="hardware-chip-outline" size={52} color={C.muteDark} />
                <Text style={{ color: C.muted, fontSize: 15, fontWeight: '600', textAlign: 'center', letterSpacing: -0.3 }}>
                  Ask InlineIQ anything
                </Text>
                <Text style={{ color: C.muteDark, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                  "Which jobs are most at risk this week?"{'\n'}
                  "What materials need ordering?"{'\n'}
                  "How many hours did Production log yesterday?"
                </Text>
              </View>
            }
            renderItem={({ item: msg }) => {
              const isUser = msg.role === 'user';
              return (
                <View style={{ marginBottom: 12, alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                  {!isUser && (
                    <Text style={{ fontSize: 10, color: C.accent, fontWeight: '700', marginBottom: 3, marginLeft: 2 }}>
                      INLINEIQ
                    </Text>
                  )}
                  <View style={[
                    { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
                    isUser
                      ? { backgroundColor: C.accent, borderBottomRightRadius: 4 }
                      : { backgroundColor: C.input, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
                  ]}>
                    <Text style={{ fontSize: 14, lineHeight: 20, color: isUser ? '#001917' : C.text }}>
                      {msg.content}
                    </Text>
                  </View>
                </View>
              );
            }}
          />

          {chatLoading && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={{ color: C.muted, fontSize: 12 }}>InlineIQ is thinking…</Text>
            </View>
          )}

          <View style={[styles.composeBar, { paddingHorizontal: 12 }]}>
            {chatHistory.length > 0 && (
              <TouchableOpacity
                onPress={() => setChatHistory([])}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ paddingBottom: 8 }}
              >
                <Ionicons name="trash-outline" size={18} color={C.muted} />
              </TouchableOpacity>
            )}
            <TextInput
              style={styles.composeInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Ask InlineIQ anything…"
              placeholderTextColor={C.muted}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!chatInput.trim() || chatLoading) && styles.sendBtnDisabled]}
              onPress={sendChat}
              disabled={!chatInput.trim() || chatLoading}
              activeOpacity={0.7}
            >
              {chatLoading
                ? <ActivityIndicator size="small" color="#000" />
                : <Ionicons name="arrow-up" size={20} color="#000" />
              }
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ── PANEL 2: LEARNING ── */}
      {panel === 'learning' && (
        <ScrollView style={styles.flex} showsVerticalScrollIndicator={false} contentContainerStyle={styles.aiScroll}>
          {loadingSettings ? (
            <ActivityIndicator size="large" color={C.accent} style={{ marginTop: 40 }} />
          ) : !settings ? (
            <View style={[styles.centered, { paddingTop: 40 }]}>
              <Text style={{ color: C.muted, textAlign: 'center', lineHeight: 20 }}>
                AI settings not found.{'\n'}Run ai_tables.sql migration.
              </Text>
            </View>
          ) : (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 0 }]}>LEARNING MODE</Text>
              <View style={styles.aiCard}>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Learning Active</Text>
                    <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {settings.learning_active
                        ? 'AI is observing patterns and building insights'
                        : 'Learning paused — AI only answers direct questions'}
                    </Text>
                  </View>
                  {savingToggle === 'learning_active'
                    ? <ActivityIndicator size="small" color={C.accent} style={{ marginRight: 4 }} />
                    : <Switch
                        value={!!settings.learning_active}
                        onValueChange={() => toggleFeature('learning_active')}
                        trackColor={{ false: C.border, true: C.accent + '80' }}
                        thumbColor={settings.learning_active ? C.accent : C.muted}
                      />
                  }
                </View>
              </View>

              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>ACTIVE MODULES</Text>
              <View style={styles.aiCard}>
                {Object.entries(FEATURE_LABELS).filter(([k]) => k !== 'learning_active').map(([key, label], idx, arr) => (
                  <View key={key} style={[styles.toggleRow, idx < arr.length - 1 && styles.toggleRowBorder]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.toggleLabel}>{label}</Text>
                    </View>
                    {savingToggle === key
                      ? <ActivityIndicator size="small" color={C.accent} style={{ marginRight: 4 }} />
                      : <Switch
                          value={!!settings[key]}
                          onValueChange={() => toggleFeature(key)}
                          trackColor={{ false: C.border, true: C.accent + '80' }}
                          thumbColor={settings[key] ? C.accent : C.muted}
                        />
                    }
                  </View>
                ))}
              </View>

              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>END-OF-SHIFT CHECK-IN</Text>
              {dailySubmitted ? (
                <View style={[styles.aiCard, { alignItems: 'center', paddingVertical: 20, gap: 8 }]}>
                  <Ionicons name="checkmark-circle" size={36} color={C.success} />
                  <Text style={{ color: C.success, fontWeight: '700', fontSize: 15 }}>Today's check-in submitted</Text>
                  <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center' }}>Come back tomorrow.</Text>
                </View>
              ) : (
                <View style={styles.aiCard}>
                  <Text style={styles.toggleLabel}>What slowed us down today?</Text>
                  <View style={styles.bottleneckGrid}>
                    {BOTTLENECK_OPTIONS.map(opt => {
                      const sel = dailyBottlenecks.includes(opt);
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[styles.bChip, sel && styles.bChipActive]}
                          onPress={() => setDailyBottlenecks(prev => sel ? prev.filter(o => o !== opt) : [...prev, opt])}
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.bChipText, sel && styles.bChipTextActive]}>{opt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={[styles.toggleLabel, { marginTop: 14 }]}>External factors</Text>
                  <TextInput
                    style={styles.aiInput}
                    value={externalFactors}
                    onChangeText={setExternalFactors}
                    placeholder="Weather, rush orders…"
                    placeholderTextColor={C.muted}
                    multiline
                  />

                  <Text style={[styles.toggleLabel, { marginTop: 14 }]}>Overall output rating</Text>
                  <View style={styles.ratingRow}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <TouchableOpacity key={n} onPress={() => setOutputRating(n)} style={styles.ratingBtn}>
                        <Ionicons name={n <= outputRating ? 'star' : 'star-outline'} size={28} color={n <= outputRating ? C.accent : C.muted} />
                      </TouchableOpacity>
                    ))}
                    {outputRating > 0 && (
                      <Text style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>
                        {['', 'Rough day', 'Below avg', 'Average', 'Good day', 'Great day'][outputRating]}
                      </Text>
                    )}
                  </View>

                  <Text style={[styles.toggleLabel, { marginTop: 14 }]}>Notes</Text>
                  <TextInput
                    style={styles.aiInput}
                    value={dailyNotes}
                    onChangeText={setDailyNotes}
                    placeholder="Anything the AI should know about today…"
                    placeholderTextColor={C.muted}
                    multiline
                  />

                  <TouchableOpacity
                    style={[styles.aiSubmitBtn, submittingDaily && { opacity: 0.5 }]}
                    onPress={submitDailyInput}
                    disabled={submittingDaily}
                    activeOpacity={0.8}
                  >
                    {submittingDaily
                      ? <ActivityIndicator size="small" color="#000" />
                      : <Text style={styles.aiSubmitBtnText}>Submit Check-In</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}

              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>LEARNING STATUS</Text>
              <View style={[styles.aiCard, { gap: 12 }]}>
                <View style={styles.statLineRow}>
                  <Text style={styles.statLineLabel}>Data points logged</Text>
                  <Text style={styles.statLineValue}>{logCount ?? '…'}</Text>
                </View>
                <View style={styles.statLineRow}>
                  <Text style={styles.statLineLabel}>Daily check-ins recorded</Text>
                  <Text style={styles.statLineValue}>{inputCount ?? '…'}</Text>
                </View>
                <View style={[styles.aiInfoBox, { marginTop: 4 }]}>
                  <Ionicons name="information-circle-outline" size={14} color={C.blue} style={{ marginTop: 1 }} />
                  <Text style={styles.aiInfoText}>
                    Auto-capture activates when QC checks are submitted. Stage, department, job type, and outcome are logged automatically.
                  </Text>
                </View>
              </View>
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ── PANEL 3: INSIGHTS ── */}
      {panel === 'insights' && (
        <ScrollView style={styles.flex} showsVerticalScrollIndicator={false} contentContainerStyle={styles.aiScroll}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 13, color: C.muted }}>
              {insights.length > 0 ? `${insights.length} insights` : 'Based on your shop data'}
            </Text>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, shadowColor: C.accent, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } }}
              onPress={generateInsights}
              disabled={insightsLoading}
              activeOpacity={0.8}
            >
              {insightsLoading
                ? <ActivityIndicator size="small" color="#001917" />
                : <Ionicons name="refresh" size={14} color="#001917" />
              }
              <Text style={{ color: '#001917', fontWeight: '700', fontSize: 12 }}>
                {insightsLoading ? 'Analyzing…' : insights.length > 0 ? 'Refresh' : 'Generate Insights'}
              </Text>
            </TouchableOpacity>
          </View>

          {insightsLoading && insights.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 40, gap: 12 }}>
              <ActivityIndicator size="large" color={C.accent} />
              <Text style={{ color: C.muted, fontSize: 13 }}>Analyzing shop patterns…</Text>
            </View>
          )}

          {!insightsLoading && insights.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 40, gap: 14, paddingHorizontal: 24 }}>
              <Ionicons name="bulb-outline" size={52} color={C.border} />
              <Text style={{ color: C.muted, fontSize: 15, fontWeight: '700', textAlign: 'center' }}>No insights yet</Text>
              <Text style={{ color: C.border, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                Tap "Generate Insights" to analyze your shop data and surface patterns.
              </Text>
            </View>
          )}

          {insights.map((insight, i) => {
            const confColor =
              insight.confidence === 'High'   ? C.success :
              insight.confidence === 'Medium' ? C.accent  : C.muted;
            return (
              <View key={i} style={[styles.dataCard, { borderLeftColor: confColor, marginBottom: 12 }]}>
                <Text style={{ fontSize: 14, color: C.text, lineHeight: 21, marginBottom: 8 }}>
                  {insight.text}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <View style={{ backgroundColor: confColor + '22', borderRadius: 99, borderWidth: 1, borderColor: confColor + '44', paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: confColor }}>
                      {insight.confidence ?? '?'} CONFIDENCE
                    </Text>
                  </View>
                  {insight.basis ? (
                    <Text style={{ fontSize: 11, color: C.muted, flex: 1 }} numberOfLines={2}>
                      {insight.basis}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────
export default function SupervisorApp({ route, userName: userNameProp }) {
  const userName  = route?.params?.userName ?? userNameProp ?? 'Supervisor';

  const handleSignOut = async () => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm('Sign out of supervisor dashboard?')
      : await new Promise(resolve => Alert.alert(
          'Sign Out',
          'Sign out of supervisor dashboard?',
          [
            { text: 'Cancel',   onPress: () => resolve(false), style: 'cancel'      },
            { text: 'Sign Out', onPress: () => resolve(true),  style: 'destructive' },
          ]
        ));

    if (!confirmed) return;

    try {
      await AsyncStorage.multiRemove([
        '@inline_user_name',
        '@inline_user_dept',
        '@inline_user_role',
        '@inline_current_task',
      ]);
      await supabase
        .from('supervisor_sessions')
        .update({ is_active: false, logged_out_at: new Date().toISOString() })
        .eq('is_active', true);
    } catch (e) {}

    if (Platform.OS === 'web') {
      window.location.reload();
    } else {
      if (global.inlineSignOut) global.inlineSignOut();
    }
  };

  const [messages,     setMessages]     = useState([]);
  const [needs,        setNeeds]        = useState([]);
  const [damage,       setDamage]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [activeTab,    setActiveTab]    = useState('brief');
  const [unreadMsgs,   setUnreadMsgs]   = useState(0);
  const [activeThread, setActiveThread] = useState(null);
  const [msgBody,      setMsgBody]      = useState('');
  const [sending,      setSending]      = useState(false);
  const [needsFilter,  setNeedsFilter]  = useState('pending');
  const [damageFilter, setDamageFilter] = useState('open');

  const [dismissedMsgIds,    setDismissedMsgIds]    = useState([]);
  const [partScans,          setPartScans]          = useState([]);
  const [timeClock,          setTimeClock]          = useState([]);
  const [unreadNeeds,        setUnreadNeeds]        = useState(0);
  const [unreadDamage,       setUnreadDamage]       = useState(0);

  const msgListRef   = useRef(null);
  const channels     = useRef([]);
  const tenantIdRef  = useRef(null);
  const activeTabRef = useRef('brief');

  const fetchAll = useCallback(async (tid) => {
    setLoading(true);
    const tf = (q) => tid ? q.eq('tenant_id', tid) : q;
    const [msgsRes, needsRes, dmgRes, scansRes, clockRes] = await Promise.all([
      tf(supabase.from('messages').select('*')).order('created_at', { ascending: true }).limit(300),
      tf(supabase.from('inventory_needs').select('*')).order('created_at', { ascending: false }),
      tf(supabase.from('damage_reports').select('*')).order('created_at', { ascending: false }),
      tf(supabase.from('part_scans').select('*')).order('created_at', { ascending: false }).limit(60),
      tf(supabase.from('time_clock').select('*')).is('clock_out', null).order('clock_in', { ascending: false }),
    ]);
    if (msgsRes.data)   setMessages(msgsRes.data);
    if (needsRes.data)  setNeeds(needsRes.data);
    if (dmgRes.data)    setDamage(dmgRes.data);
    if (scansRes.data)  setPartScans(scansRes.data);
    if (clockRes.data)  setTimeClock(clockRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('@inline_dismissed_msgs').then((val) => {
      if (val) setDismissedMsgIds(JSON.parse(val));
    });

    (async () => {
      const tid = await getTenantId();
      tenantIdRef.current = tid;
      await fetchAll(tid);

      const tFilter = tid ? `tenant_id=eq.${tid}` : undefined;
      const withFilter = (cfg) => tFilter ? { ...cfg, filter: tFilter } : cfg;

      const msgCh = supabase.channel('sup-app-messages')
        .on('postgres_changes', withFilter({ event: 'INSERT', schema: 'public', table: 'messages' }), (p) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === p.new.id)) return prev;
            return [...prev, p.new];
          });
          if (p.new.sender_name !== 'Supervisor') setUnreadMsgs((n) => n + 1);
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => {
          setMessages((prev) => prev.filter((m) => m.id !== p.old.id));
        })
        .subscribe();

      const needsCh = supabase.channel('sup-app-needs')
        .on('postgres_changes', withFilter({ event: '*', schema: 'public', table: 'inventory_needs' }), (p) => {
          if (p.eventType === 'INSERT') {
            setNeeds((prev) => [p.new, ...prev]);
            if (activeTabRef.current !== 'needs') setUnreadNeeds((n) => n + 1);
          } else if (p.eventType === 'UPDATE') {
            setNeeds((prev) => prev.map((r) => r.id === p.new.id ? p.new : r));
          } else if (p.eventType === 'DELETE') {
            setNeeds((prev) => prev.filter((r) => r.id !== p.old.id));
          }
        })
        .subscribe();

      const dmgCh = supabase.channel('sup-app-damage')
        .on('postgres_changes', withFilter({ event: '*', schema: 'public', table: 'damage_reports' }), (p) => {
          if (p.eventType === 'INSERT') {
            setDamage((prev) => [p.new, ...prev]);
            if (activeTabRef.current !== 'damage') setUnreadDamage((n) => n + 1);
          } else if (p.eventType === 'UPDATE') {
            setDamage((prev) => prev.map((r) => r.id === p.new.id ? p.new : r));
          } else if (p.eventType === 'DELETE') {
            setDamage((prev) => prev.filter((r) => r.id !== p.old.id));
          }
        })
        .subscribe();

      const scanCh = supabase.channel('sup-app-partscans')
        .on('postgres_changes', withFilter({ event: 'INSERT', schema: 'public', table: 'part_scans' }), (p) => {
          setPartScans((prev) => [p.new, ...prev].slice(0, 60));
        })
        .subscribe();

      const clockCh = supabase.channel('sup-app-timeclock')
        .on('postgres_changes', withFilter({ event: '*', schema: 'public', table: 'time_clock' }), (p) => {
          if (p.eventType === 'INSERT') {
            if (!p.new.clock_out) setTimeClock((prev) => [p.new, ...prev]);
          } else if (p.eventType === 'UPDATE') {
            setTimeClock((prev) =>
              p.new.clock_out
                ? prev.filter((r) => r.id !== p.new.id)
                : prev.map((r) => r.id === p.new.id ? p.new : r)
            );
          } else if (p.eventType === 'DELETE') {
            setTimeClock((prev) => prev.filter((r) => r.id !== p.old.id));
          }
        })
        .subscribe();

      channels.current = [msgCh, needsCh, dmgCh, scanCh, clockCh];
    })();

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

    const replyDept = activeThread?.dept || 'Management';
    const optimistic = {
      id:          `opt-${Date.now()}`,
      sender_name: 'Supervisor',
      dept:        replyDept,
      body:        trimmed,
      created_at:  new Date().toISOString(),
    };

    setMsgBody('');
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);

    const { data, error } = await supabase
      .from('messages')
      .insert({ sender_name: 'Supervisor', dept: replyDept, body: trimmed, tenant_id: tenantIdRef.current })
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

  const updateDamageResolution = async (id, fields) => {
    setDamage((prev) => prev.map((d) => d.id === id ? { ...d, ...fields } : d));
    await supabase.from('damage_reports').update(fields).eq('id', id);
  };

  const archiveDamage = async (id) => {
    setDamage((prev) => prev.map((d) => d.id === id ? { ...d, archived: true } : d));
    await supabase.from('damage_reports').update({ archived: true }).eq('id', id);
  };

  const deleteMessage = useCallback(async (id) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    await supabase.from('messages').delete().eq('id', id);
  }, []);

  const deleteThread = useCallback((thread) => {
    Alert.alert(
      'Delete thread',
      `Delete all messages with ${thread.name}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setMessages((prev) =>
              prev.filter((m) =>
                m.sender_name !== thread.name &&
                !(m.sender_name === 'Supervisor' && m.dept === thread.dept)
              )
            );
            setActiveThread(null);
            await supabase.from('messages').delete()
              .eq('tenant_id', tenantIdRef.current)
              .eq('sender_name', thread.name);
            if (thread.dept) {
              await supabase.from('messages').delete()
                .eq('tenant_id', tenantIdRef.current)
                .eq('sender_name', 'Supervisor')
                .eq('dept', thread.dept);
            }
          },
        },
      ]
    );
  }, []);

  const dismissMessage = useCallback((id) => {
    setDismissedMsgIds((prev) => {
      const next = [...prev, id];
      AsyncStorage.setItem('@inline_dismissed_msgs', JSON.stringify(next));
      return next;
    });
  }, []);

  const openThread = useCallback((thread) => {
    setActiveThread(thread);
    setActiveTab('messages');
    setUnreadMsgs(0);
  }, []);

  const handleTabPress = (key) => {
    activeTabRef.current = key;
    if (key === 'messages') setUnreadMsgs(0);
    if (key === 'needs')    setUnreadNeeds(0);
    if (key === 'damage')   setUnreadDamage(0);
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.flex}>
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={C.accent} />
            </View>
          ) : (
            <>
            {activeTab === 'brief' && (
              <MorningBriefScreen userName={userName} />
            )}
            {activeTab === 'overview' && (
              <OverviewTab
                needs={needs}
                damage={damage}
                messages={messages}
                threads={threads}
                timeClock={timeClock}
                userName={userName}
                onSwitchRole={handleSignOut}
                dismissedMsgIds={dismissedMsgIds}
                onDismissMsg={dismissMessage}
                onOpenThread={openThread}
                partScans={partScans}
                unreadNeeds={unreadNeeds}
                unreadDamage={unreadDamage}
                unreadMsgs={unreadMsgs}
                onNavigateTab={handleTabPress}
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
                onDeleteMsg={deleteMessage}
                onDeleteThread={deleteThread}
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
                onResolve={updateDamageResolution}
                onArchive={archiveDamage}
                userName={userName}
              />
            )}
            {activeTab === 'ai' && (
              <AIControlCenterTab
                userName={userName}
                needs={needs}
                damage={damage}
                messages={messages}
                timeClock={timeClock}
              />
            )}
          </>
        )}
      </View>

      {/* Custom tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          const badge  = tab.key === 'messages' ? unreadMsgs
                     : tab.key === 'needs'    ? unreadNeeds
                     : tab.key === 'damage'   ? unreadDamage
                     : 0;
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
      </KeyboardAvoidingView>
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
  overviewTitle: { fontSize: 19, fontWeight: '700', color: C.text, letterSpacing: -0.5 },
  overviewName:  { fontSize: 12, color: C.muted, marginTop: 2, letterSpacing: 0.2 },
  overviewHeaderRight: { alignItems: 'flex-end', gap: 8 },
  liveRow:       { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  liveText:      { fontSize: 10, color: C.success, fontWeight: '600', letterSpacing: 0.5 },
  gearBtn:       { padding: 2, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  signOutText:   { fontSize: 12, color: C.error, fontWeight: '600', paddingHorizontal: 4, paddingVertical: 2 },

  // KPI stat cards
  statRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  statAccent: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 2,
  },
  statLabel: { fontSize: 8, color: C.muteDark, fontWeight: '600', letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 5 },
  statValue: { fontSize: 26, fontWeight: '600', letterSpacing: -0.8, color: C.text },
  statSub:   { fontSize: 10, color: C.accentDim, fontWeight: '500', marginLeft: 3 },

  // Dept rows
  sectionLabel: {
    fontSize: 9, fontWeight: '600', color: C.muteDark,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10,
  },
  deptRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10,
  },
  deptRowName:   { width: 82, fontSize: 12, fontWeight: '500', color: C.text },
  deptBarTrack:  { flex: 1, height: 5, backgroundColor: 'rgba(94,234,212,0.06)', borderRadius: 3, overflow: 'hidden' },
  deptBarFill:   { height: '100%', borderRadius: 3 },
  deptRowBadges: { flexDirection: 'row', gap: 4, minWidth: 72, justifyContent: 'flex-end' },
  miniPill: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 99, borderWidth: 1,
  },
  miniPillText: { fontSize: 9, fontWeight: '700' },
  deptOkText:   { fontSize: 10, color: C.success, fontWeight: '600' },

  // Activity
  activityRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  activityDot:   { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  activityBody:  { flex: 1 },
  activitySender:{ fontSize: 12, fontWeight: '600', color: C.text, marginBottom: 1 },
  activityDept:  { fontWeight: '400', color: C.muted },
  activityMsg:   { fontSize: 12, color: C.muted },
  activityTime:  { fontSize: 11, color: C.muteDark, flexShrink: 0 },

  // Tab header (inside each section)
  tabHeader: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tabHeaderTitle: { fontSize: 19, fontWeight: '700', color: C.text, letterSpacing: -0.4 },
  tabHeaderSub:   { fontSize: 12, color: C.muted },

  // Filter chips
  filterRow:        { paddingLeft: 16, marginBottom: 4, marginTop: 8, flexGrow: 0 },
  filterRowContent: { gap: 8, paddingRight: 16 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 999, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
  },
  filterChipActive:     { backgroundColor: 'rgba(45,225,201,0.12)', borderColor: C.accentDim },
  filterChipText:       { fontSize: 13, fontWeight: '500', color: C.muted },
  filterChipTextActive: { color: C.accent },

  // Dept counters (Needs tab)
  deptCounterRow:    { paddingLeft: 16, marginBottom: 4, marginTop: 8, flexGrow: 0 },
  deptCounterContent:{ gap: 8, paddingRight: 16 },
  deptCounter: {
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 10, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', minWidth: 52,
  },
  deptCounterNum:   { fontSize: 18, fontWeight: '600', marginBottom: 2 },
  deptCounterLabel: { fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Lists
  listContent:       { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  listContentPadded: { paddingHorizontal: 16, paddingTop: 8,  paddingBottom: 100 },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: C.muted, fontSize: 15, textAlign: 'center' },

  // Threads
  threadCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8,
  },
  threadAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(94,234,212,0.1)',
    borderWidth: 1, borderColor: 'rgba(94,234,212,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  threadAvatarLetter: { fontSize: 16, fontWeight: '700', color: C.accentDim },
  threadMain:         { flex: 1 },
  threadTopRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  threadName:         { fontSize: 14, fontWeight: '600', color: C.text },
  threadPreview:      { fontSize: 13, color: C.muted },
  threadRight:        { alignItems: 'flex-end' },
  threadTime:         { fontSize: 11, color: C.muteDark },
  deptPill: {
    backgroundColor: 'rgba(94,234,212,0.06)', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: C.border,
  },
  deptPillText: { fontSize: 9, color: C.muted, fontWeight: '600', letterSpacing: 0.3 },

  // Thread conversation
  threadHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
  threadHeaderName: { fontSize: 14, fontWeight: '600', color: C.text },
  threadHeaderDept: { fontSize: 12, color: C.muted, marginTop: 1 },

  // Message bubbles
  msgListContent: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, flexGrow: 1,
  },
  bubbleRow:     { marginBottom: 12, maxWidth: '78%' },
  bubbleRowOut:  { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleRowIn:   { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubbleSender:  { fontSize: 10, color: C.muted, fontWeight: '600', marginBottom: 3, marginLeft: 2, letterSpacing: 0.2 },
  bubble:        { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOut:     { backgroundColor: C.accent, borderBottomRightRadius: 4 },
  bubbleIn:      { backgroundColor: C.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  bubbleText:    { fontSize: 15, lineHeight: 21 },
  bubbleTextOut: { color: '#001917' },
  bubbleTextIn:  { color: C.text },
  bubbleTime:    { fontSize: 10, color: C.muteDark, marginTop: 3 },
  bubbleTimeRight: { marginRight: 2 },
  bubbleTimeLeft:  { marginLeft: 2 },

  // Compose bar
  composeBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg,
  },
  composeInput: {
    flex: 1, backgroundColor: C.surface, borderRadius: 22,
    borderWidth: 1, borderColor: C.border, color: C.text,
    fontSize: 15, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center',
    shadowColor: C.accent, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  sendBtnDisabled: { backgroundColor: C.surface, shadowOpacity: 0 },

  // Data cards (Needs / Damage)
  dataCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 3, padding: 14, marginBottom: 8,
  },
  cardTopRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardMainBlock: { flex: 1, marginRight: 12 },
  cardTitle:     { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 4 },
  cardMeta:      { fontSize: 12, color: C.muted, marginBottom: 2 },
  cardNotes:     { fontSize: 12, color: C.text, fontStyle: 'italic', opacity: 0.7, marginTop: 2, marginBottom: 2 },
  cardDate:      { fontSize: 11, color: C.muteDark, marginTop: 2 },
  cardActionRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  actionBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 999, backgroundColor: 'transparent',
    borderWidth: 1, borderColor: C.border,
  },
  actionBtnText: { fontSize: 12, fontWeight: '600' },

  // Status pill
  pill: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start',
  },
  pillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },

  // Bottom tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderTopWidth: 1, borderTopColor: C.border,
    paddingBottom: 6, paddingTop: 6, height: 64,
  },
  tabItem: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'visible',
  },
  tabAccent: {
    position: 'absolute', top: 0, left: 14, right: 14,
    height: 2, backgroundColor: C.accent, borderRadius: 1,
    shadowColor: C.accent, shadowOpacity: 0.7, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
  },
  tabLabel:       { fontSize: 10, fontWeight: '500', color: C.muteDark, marginTop: 3 },
  tabLabelActive: { color: C.accent, fontWeight: '600' },
  tabBadge: {
    position: 'absolute', top: -4, right: -6,
    backgroundColor: C.error, borderRadius: 8,
    minWidth: 15, height: 15, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3,
  },
  tabBadgeText: { color: '#fff', fontSize: 8, fontWeight: '700' },

  // AI Control Center
  aiScroll: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 16 },
  aiTabHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  aiHeaderTitle: { fontSize: 15, fontWeight: '700', color: C.text, letterSpacing: -0.3 },
  aiHeaderSub:   { fontSize: 12, color: C.muted, marginTop: 2 },
  aiPanelBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border,
  },
  aiPanelBtnActive:     { backgroundColor: 'rgba(45,225,201,0.1)', borderColor: C.accentDim },
  aiPanelBtnText:       { fontSize: 12, fontWeight: '500', color: C.muted },
  aiPanelBtnTextActive: { color: C.accent, fontWeight: '600' },
  aiHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  aiCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 8,
  },
  modeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 8,
  },
  modeRadio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: C.muted,
    justifyContent: 'center', alignItems: 'center',
  },
  modeRadioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#001917' },
  modeLabel: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 },
  modeDesc:  { fontSize: 12, color: C.muted },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
  },
  toggleRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  toggleLabel: { fontSize: 13, fontWeight: '600', color: C.text },
  bottleneckGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  bChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border,
  },
  bChipActive:     { backgroundColor: 'rgba(94,234,212,0.08)', borderColor: C.accentDim },
  bChipText:       { fontSize: 12, fontWeight: '500', color: C.muted },
  bChipTextActive: { color: C.accentDim },
  aiInput: {
    backgroundColor: C.input, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    color: C.text, fontSize: 14,
    paddingHorizontal: 14, paddingVertical: 10,
    marginTop: 8, minHeight: 48,
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  ratingBtn: { padding: 4 },
  aiSubmitBtn: {
    backgroundColor: C.accent, borderRadius: 999,
    paddingVertical: 14, alignItems: 'center', marginTop: 16,
    shadowColor: C.accent, shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 6 },
  },
  aiSubmitBtnText: { color: '#001917', fontSize: 15, fontWeight: '700' },
  statLineRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLineLabel: { fontSize: 13, color: C.muted },
  statLineValue: { fontSize: 14, fontWeight: '600', color: C.text },
  aiInfoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: C.blueBg, borderRadius: 10,
    borderWidth: 1, borderColor: C.blueBorder,
    padding: 10,
  },
  aiInfoText: { flex: 1, fontSize: 11, color: C.violet, lineHeight: 16 },

  // Swipeable delete
  swipeDeleteBg: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    backgroundColor: C.error, justifyContent: 'center', alignItems: 'center',
    borderRadius: 10,
  },
  swipeDeleteBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14 },
  swipeDeleteText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Parts In Progress
  partJobGroup: { marginBottom: 10 },
  partJobLabel: { fontSize: 9, fontWeight: '600', color: C.muteDark, letterSpacing: 1.0, textTransform: 'uppercase', marginBottom: 5 },
  partScanRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 2, marginBottom: 5,
  },
  partScanNum:    { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 2 },
  partScanMeta:   { fontSize: 11, color: C.muted },
  partScanNotes:  { fontSize: 11, color: C.muted, fontStyle: 'italic', marginTop: 2 },
  partStatusPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99, borderWidth: 1, backgroundColor: 'transparent' },
  partStatusText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  partScanTime:   { fontSize: 10, color: C.muteDark },

  // Big sign-out button (Overview tab, pinned above tab bar)
  signOutBigBtn: {
    backgroundColor: 'rgba(248,113,113,0.12)',
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: C.errorBorder,
  },
  signOutBigBtnText: {
    color: C.error,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
  },

  // Notification banner (Overview tab)
  notifBanner: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10,
    backgroundColor: 'rgba(248,113,113,0.05)', borderRadius: 10,
    borderWidth: 1, borderColor: C.errorBorder,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14,
  },
  notifItem: { fontSize: 12, fontWeight: '600' },

  // Clock crew rows (Overview tab)
  clockNoneText: { fontSize: 12, color: C.muted, marginBottom: 12 },
  clockCrewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: C.surface, borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 2, borderLeftColor: C.success,
    marginBottom: 6,
  },
  clockCrewDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  clockCrewInfo:    { flex: 1 },
  clockCrewName:    { fontSize: 13, fontWeight: '600', color: C.text },
  clockCrewDept:    { fontSize: 11, color: C.muted, marginTop: 1 },
  clockCrewElapsed: { fontSize: 13, color: C.success, fontWeight: '600' },
});
