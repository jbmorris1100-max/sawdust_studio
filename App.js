import 'react-native-url-polyfill/auto';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Text, View, StyleSheet, TouchableOpacity,
  TextInput, SafeAreaView, StatusBar,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './src/lib/supabase';
import { registerForPushNotifications } from './src/lib/notifications';
import { RoleContext } from './src/lib/RoleContext';
import HomeScreen        from './src/screens/HomeScreen';
import PartsScreen       from './src/screens/PartsScreen';
import InventoryScreen   from './src/screens/InventoryScreen';
import DamageScreen      from './src/screens/DamageScreen';
import MessagesScreen    from './src/screens/MessagesScreen';
import SOPsScreen        from './src/screens/SOPsScreen';
import PlansScreen       from './src/screens/PlansScreen';
import SupervisorApp     from './src/screens/SupervisorApp';
import OnboardingScreen  from './src/screens/OnboardingScreen';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  componentDidCatch(error) { this.setState({ error: error.message }); }
  render() {
    if (this.state.error) {
      return React.createElement('div', { style: { color: 'red', padding: 20, fontSize: 16 } },
        'App Error: ' + this.state.error);
    }
    return this.props.children;
  }
}

const Tab = createBottomTabNavigator();

const STORAGE = {
  NAME:      '@sawdust_user_name',
  DEPT:      '@sawdust_user_dept',
  ROLE:      '@sawdust_user_role',
  VERSION:   '@sawdust_app_version',
  DEVICE_ID: '@sawdust_device_id',
};

async function getDeviceId() {
  let id = await AsyncStorage.getItem(STORAGE.DEVICE_ID);
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    await AsyncStorage.setItem(STORAGE.DEVICE_ID, id);
  }
  return id;
}

// ── Colors ────────────────────────────────────────────────────
const C = {
  bg:       '#0d0d0d',
  surface:  '#141414',
  input:    '#1a1a1a',
  border:   '#2a2a2a',
  text:     '#e5e5e5',
  muted:    '#555555',
  tabBar:   '#111111',
  active:   '#f59e0b',
  inactive: '#444444',
  badge:    '#ef4444',
  blue:     '#3b82f6',
};

// ── Per-tab top accent indicator ──────────────────────────────
function TabButton({ children, onPress, accessibilityState, style }) {
  const focused = accessibilityState?.selected;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[style, styles.tabButton]}
      activeOpacity={0.7}
    >
      {focused && <View style={styles.tabAccent} />}
      {children}
    </TouchableOpacity>
  );
}

// ── Role Picker Screen ────────────────────────────────────────
function RolePicker({ onSelect }) {
  const [pickingSupervisor, setPickingSupervisor] = useState(false);
  const [name, setName] = useState('');

  return (
    <SafeAreaView style={rp.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView
        style={rp.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text style={rp.appName}>Sawdust Crew</Text>
        <Text style={rp.heading}>Who are you?</Text>

        {!pickingSupervisor ? (
          <>
            <TouchableOpacity
              style={rp.roleCard}
              onPress={() => onSelect('crew')}
              activeOpacity={0.8}
            >
              <View style={[rp.roleIcon, { backgroundColor: C.active + '22' }]}>
                <Ionicons name="construct-outline" size={30} color={C.active} />
              </View>
              <View style={rp.roleText}>
                <Text style={rp.roleTitle}>I'm Crew</Text>
                <Text style={rp.roleDesc}>Log inventory, scan parts, report damage, send messages</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.border} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[rp.roleCard, rp.roleCardSup]}
              onPress={() => setPickingSupervisor(true)}
              activeOpacity={0.8}
            >
              <View style={[rp.roleIcon, { backgroundColor: C.blue + '22' }]}>
                <Ionicons name="shield-checkmark-outline" size={30} color={C.blue} />
              </View>
              <View style={rp.roleText}>
                <Text style={[rp.roleTitle, { color: C.blue }]}>I'm Supervisor</Text>
                <Text style={rp.roleDesc}>Monitor crew, manage inventory, reply to messages</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.border} />
            </TouchableOpacity>
          </>
        ) : (
          <View style={rp.nameBox}>
            <Text style={rp.fieldLabel}>SUPERVISOR NAME</Text>
            <TextInput
              style={rp.input}
              placeholder="e.g. Mike Torres"
              placeholderTextColor={C.muted}
              value={name}
              onChangeText={setName}
              autoFocus
            />
            <TouchableOpacity
              style={[rp.goBtn, !name.trim() && rp.goBtnDisabled]}
              onPress={() => onSelect('supervisor', name.trim())}
              disabled={!name.trim()}
              activeOpacity={0.85}
            >
              <Text style={rp.goBtnText}>Enter Supervisor Dashboard</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setPickingSupervisor(false); setName(''); }}
              style={rp.backBtn}
            >
              <Ionicons name="arrow-back" size={16} color={C.muted} style={{ marginRight: 5 }} />
              <Text style={rp.backBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Crew Tab Navigator ────────────────────────────────────────
function CrewNavigator({ userName, userDept, unreadCount, setUnreadCount }) {
  const screenParams = { userName, userDept };
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor:   C.active,
        tabBarInactiveTintColor: C.inactive,
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        initialParams={{ ...screenParams, onClearUnread: () => setUnreadCount(0) }}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="ScanPart"
        component={PartsScreen}
        initialParams={screenParams}
        options={{
          title: 'Parts',
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'scan' : 'scan-outline'} size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Needs"
        component={InventoryScreen}
        initialParams={screenParams}
        options={{
          title: 'Needs',
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'cube' : 'cube-outline'} size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Damage"
        component={DamageScreen}
        initialParams={screenParams}
        options={{
          title: 'Damage',
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'warning' : 'warning-outline'} size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Messages"
        component={MessagesScreen}
        initialParams={screenParams}
        options={{
          title: 'Messages',
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
              size={size}
              color={color}
            />
          ),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: styles.nativeBadge,
        }}
        listeners={{ tabPress: () => setUnreadCount(0) }}
      />

      <Tab.Screen
        name="SOPs"
        component={SOPsScreen}
        initialParams={screenParams}
        options={{
          title: 'SOPs',
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'book' : 'book-outline'} size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Plans"
        component={PlansScreen}
        initialParams={screenParams}
        options={{
          title: 'Plans',
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'document-text' : 'document-text-outline'} size={size} color={color} />
          ),
        }}
      />

      {/* Hidden screen for backward-compat nav (LogInventory alias) */}
      <Tab.Screen
        name="LogInventory"
        component={InventoryScreen}
        initialParams={screenParams}
        options={{ tabBarButton: () => null }}
      />
    </Tab.Navigator>
  );
}

// ── Supervisor Tab Navigator ──────────────────────────────────
const SupervisorTab = createBottomTabNavigator();
function SupervisorNavigator({ userName }) {
  return (
    <SupervisorTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' }, // SupervisorApp renders its own tab bar
      }}
    >
      <SupervisorTab.Screen
        name="SupervisorMain"
        component={SupervisorApp}
        initialParams={{ userName }}
      />
    </SupervisorTab.Navigator>
  );
}

// ── App ───────────────────────────────────────────────────────
function App() {
  // null = loading, '' = not set, 'crew', 'supervisor'
  const [role,          setRole]          = useState(null);
  const [userName,      setUserName]      = useState('');
  const [userDept,      setUserDept]      = useState('');
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const channelRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        // Expire supervisor sessions older than 4 hours so stale sessions can't block new logins
        try {
          const eightHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
          await supabase
            .from('supervisor_sessions')
            .update({ is_active: false, logged_out_at: new Date().toISOString() })
            .eq('is_active', true)
            .lt('logged_in_at', eightHoursAgo);
        } catch (e) { /* table may not exist yet */ }

        const [name, dept, storedRole, storedVersion] = await Promise.all([
          AsyncStorage.getItem(STORAGE.NAME),
          AsyncStorage.getItem(STORAGE.DEPT),
          AsyncStorage.getItem(STORAGE.ROLE),
          AsyncStorage.getItem(STORAGE.VERSION),
        ]);

        // First-time v2 migration: force role picker for existing users who never saw it
        if (parseInt(storedVersion ?? '0', 10) < 2) {
          await Promise.all([
            AsyncStorage.removeItem(STORAGE.NAME),
            AsyncStorage.removeItem(STORAGE.DEPT),
            AsyncStorage.removeItem(STORAGE.ROLE),
            AsyncStorage.setItem(STORAGE.VERSION, '2'),
          ]);
          setRole('');
          return;
        }

        if (storedRole === 'supervisor' && name) {
          setRole('supervisor');
          setUserName(name);
          setUserDept('Management');
          registerForPushNotifications(name, 'Supervisor').catch(console.warn);
        } else if (!storedRole && name && dept) {
          // Legacy users (pre-role-system): assume crew, backfill role
          await AsyncStorage.setItem(STORAGE.ROLE, 'crew');
          setRole('crew');
          setUserName(name);
          setUserDept(dept);
          registerForPushNotifications(name, dept).catch(console.warn);
        } else if (storedRole === 'crew' && name && dept) {
          setRole('crew');
          setUserName(name);
          setUserDept(dept);
          registerForPushNotifications(name, dept).catch(console.warn);
        } else {
          setRole('');
        }
      } catch (e) {
        console.error('[App] startup error:', e);
      } finally {
        setRole(prev => prev === null ? '' : prev);
      }
    })();
  }, []);

  // Unread badge channel — crew only
  useEffect(() => {
    if (role !== 'crew') return;
    channelRef.current = supabase
      .channel('app-messages-badge')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          if (payload.new.sender_name !== userName) setUnreadCount((n) => n + 1);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channelRef.current); };
  }, [role, userName]);

  const handleRoleSelect = async (selectedRole, name) => {
    const deviceId = await getDeviceId();

    if (selectedRole === 'supervisor' && name) {
      // Check for an existing active session from a different device (4h window)
      const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const { data: activeSessions } = await supabase
        .from('supervisor_sessions')
        .select('name, device_id')
        .eq('is_active', true)
        .gte('logged_in_at', cutoff);

      const conflict = activeSessions?.find((s) => s.name.toLowerCase() !== name.toLowerCase());
      if (conflict) {
        Alert.alert(
          'Supervisor Already Live',
          `Supervisor already logged in as ${conflict.name}. Contact them to hand off access.`
        );
        return;
      }

      // Create supervisor session
      await supabase.from('supervisor_sessions').insert({
        name,
        device_id: deviceId,
        is_active: true,
      });

      await AsyncStorage.setItem(STORAGE.NAME, name);
      setUserName(name);
      setUserDept('Management');
      registerForPushNotifications(name, 'Supervisor').catch(console.warn);
    }

    await Promise.all([
      AsyncStorage.setItem(STORAGE.ROLE, selectedRole),
      AsyncStorage.setItem(STORAGE.VERSION, '2'),
    ]);

    // Show onboarding for first-time crew members who haven't set a name yet
    if (selectedRole === 'crew' && !name) {
      const storedName = await AsyncStorage.getItem(STORAGE.NAME);
      if (!storedName) {
        setRole('crew');
        setShowOnboarding(true);
        return;
      }
    }

    // Log this login for audit trail
    const displayName = name || (await AsyncStorage.getItem(STORAGE.NAME)) || 'Unknown';
    const dept = selectedRole === 'supervisor' ? 'Management' : (await AsyncStorage.getItem(STORAGE.DEPT)) || '';
    try {
      await supabase.from('login_log').insert({
        worker_name:  displayName,
        dept,
        role:         selectedRole,
        device_id:    deviceId,
        app_version:  '2',
      });
    } catch (e) {
      console.warn('[handleLogin] login_log insert failed:', e);
    }

    setRole(selectedRole);
  };

  const handleResetRole = useCallback(async () => {
    try {
      console.log('[handleResetRole] step 1: starting, current role =', role);
      if (role === 'supervisor') {
        console.log('[handleResetRole] step 2: updating supervisor session');
        const deviceId = await getDeviceId();
        try {
          await supabase
            .from('supervisor_sessions')
            .update({ is_active: false, logged_out_at: new Date().toISOString() })
            .eq('device_id', deviceId)
            .eq('is_active', true);
        } catch (e) {
          console.warn('[handleResetRole] session update failed:', e);
        }
      }
      console.log('[handleResetRole] step 3: clearing AsyncStorage');
      await Promise.all([
        AsyncStorage.removeItem(STORAGE.NAME),
        AsyncStorage.removeItem(STORAGE.DEPT),
        AsyncStorage.removeItem(STORAGE.ROLE),
      ]);
      console.log('[handleResetRole] step 4: calling setRole(\'\')');
      setRole('');
      setUserName('');
      setUserDept('');
      console.log('[handleResetRole] step 5: done');
    } catch (err) {
      console.error('[handleResetRole] ERROR:', err);
    }
  }, [role]);

  // Stable ref so context consumers always call the latest handleResetRole
  // even if it was captured in a stale closure (e.g. inside an Alert callback).
  const resetRoleRef = useRef(null);
  resetRoleRef.current = handleResetRole;
  const stableReset = useCallback(() => resetRoleRef.current?.(), []);

  // Expose global sign-out so SupervisorApp can call it without context
  useEffect(() => {
    if (role !== 'supervisor') {
      global.sawdustSignOut = null;
      return;
    }
    global.sawdustSignOut = async () => {
      try {
        await AsyncStorage.multiRemove([
          '@sawdust_user_name',
          '@sawdust_user_dept',
          '@sawdust_user_role',
          '@sawdust_current_task',
        ]);
        await supabase
          .from('supervisor_sessions')
          .update({ is_active: false, logged_out_at: new Date().toISOString() })
          .eq('is_active', true);
      } catch (e) {}
      setRole('');
      setUserName('');
      setUserDept('');
    };
    return () => { global.sawdustSignOut = null; };
  }, [role]);

  const handleOnboardingComplete = useCallback((name) => {
    setUserName(name);
    setShowOnboarding(false);
  }, []);

  if (role === null) return null; // loading

  if (role === '') {
    return (
      <SafeAreaProvider>
        <RolePicker onSelect={handleRoleSelect} />
      </SafeAreaProvider>
    );
  }

  if (role === 'crew' && showOnboarding) {
    return (
      <SafeAreaProvider>
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <RoleContext.Provider value={stableReset}>
        <NavigationContainer>
          {role === 'supervisor' ? (
            <SupervisorNavigator userName={userName} />
          ) : (
            <CrewNavigator
              userName={userName}
              userDept={userDept}
              unreadCount={unreadCount}
              setUnreadCount={setUnreadCount}
            />
          )}
        </NavigationContainer>
      </RoleContext.Provider>
    </SafeAreaProvider>
  );
}

export default function Root() {
  return <ErrorBoundary><App /></ErrorBoundary>;
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: C.tabBar,
    borderTopWidth:  1,
    borderTopColor:  C.border,
    paddingBottom:   6,
    paddingTop:      6,
    height:          56,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  tabAccent: {
    position: 'absolute',
    top: 0,
    left: 10,
    right: 10,
    height: 2.5,
    backgroundColor: C.active,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  nativeBadge: {
    backgroundColor: C.badge,
    fontSize: 10,
    fontWeight: '700',
  },
});

// ── Role Picker Styles ────────────────────────────────────────
const rp = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  container: {
    flex: 1, paddingHorizontal: 24, justifyContent: 'center',
  },
  appName: {
    fontSize: 13, fontWeight: '700', color: C.active,
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12,
  },
  heading: {
    fontSize: 28, fontWeight: '800', color: C.text,
    letterSpacing: -0.5, marginBottom: 32,
  },
  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.surface, borderRadius: 18,
    borderWidth: 1, borderColor: '#222',
    padding: 18, marginBottom: 12,
  },
  roleCardSup: { borderColor: C.blue + '30' },
  roleIcon: {
    width: 52, height: 52, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  roleText:  { flex: 1 },
  roleTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 4 },
  roleDesc:  { fontSize: 12, color: C.muted, lineHeight: 17 },

  nameBox:   { marginTop: 8 },
  fieldLabel: {
    fontSize: 10, fontWeight: '700', color: C.muted,
    letterSpacing: 0.9, marginBottom: 10,
  },
  input: {
    backgroundColor: C.input, borderRadius: 14,
    borderWidth: 1.5, borderColor: C.border,
    color: C.text, fontSize: 17,
    paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 16,
  },
  goBtn: {
    backgroundColor: C.blue, borderRadius: 14,
    paddingVertical: 17, alignItems: 'center', marginBottom: 14,
  },
  goBtnDisabled: { opacity: 0.35 },
  goBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  backBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 8,
  },
  backBtnText: { color: C.muted, fontSize: 14 },
});
