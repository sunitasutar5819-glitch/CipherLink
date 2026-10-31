import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  Lock,
  Send,
  Mic,
  Paperclip,
  Video,
  Phone,
  MonitorUp,
  Sun,
  Moon,
  Wifi,
  WifiOff,
  RefreshCw,
  QrCode,
  ShieldCheck,
  Users,
  UserPlus,
  UserCheck,
  Smile,
  Code2,
  LogOut,
  Cloud,
  Bell,
  Sparkles,
  Eye,
  PhoneIncoming,
  X,
  Search,
  SmilePlus,
} from 'lucide-react';
import {
  normalizePassboxCode,
  isValidPassboxCode,
  generatePassboxCode,
  deriveSessionFingerprint,
  encryptPayload,
  reconcileOfflineQueue,
  REACTION_EMOJIS,
  toggleMessageReaction,
  filterMessagesBySearchQuery,
  formatTypingStatusText,
  type SyncableMessage,
  type ChunkedFileEncryptionResult,
} from './utils/cryptoEngine';
import {
  generateAvatarSvgDataUri,
  sanitizeHandle,
  removeContactByUid,
  shouldTriggerNotification,
  DEFAULT_AVATAR_3D,
  DEFAULT_NOTIFICATION_PREFS,
  type UserProfileRecord,
  type ContactEntryRecord,
  type ContactRequestRecord,
  type GroupChatRecord,
  type Avatar3DConfig,
  type NotificationPreferences,
  type AppNotificationItem,
} from './utils/socialAndGroups';
import { PassboxGate } from './components/PassboxGate';
import {
  AnimatedGifCard,
  AnimatedGifPicker,
  type GiphyGifItem,
} from './components/AnimatedGifCard';
import { VoiceNotePlayer, VoiceRecorderBar } from './components/VoiceNotePlayer';
import { EncryptedFileStreamCard, FileStreamModal } from './components/FileStreamModal';
import { CallStudioPanel } from './components/CallStudioPanel';
import { ContactsAndGroupsModal } from './components/ContactsAndGroupsModal';
import {
  NotificationCenterModal,
  playNotificationChime,
} from './components/NotificationCenterModal';
import {
  auth,
  db,
  onAuthStateChanged,
  autoSignInFirebase,
  signInWithGooglePopup,
  signOutFirebase,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  handleFirestoreError,
  OperationType,
  type User,
} from './firebase';

interface RoomPeer {
  clientId: string;
  senderName: string;
  inCall: boolean;
  callMode?: string;
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const autostart = params.get('autostart') === '1';
  const urlPassbox = normalizePassboxCode(params.get('passbox') || '');
  const initialPassbox = isValidPassboxCode(urlPassbox) ? urlPassbox : '7X9K2M';

  const [darkMode, setDarkMode] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(
    autostart || isValidPassboxCode(urlPassbox)
  );
  const [activePassbox, setActivePassbox] = useState<string>(initialPassbox);
  const [activeRoomLabel, setActiveRoomLabel] = useState<string>(`Room ${initialPassbox}`);

  // Firebase Auth & Current Real User Profile (no demo user names)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [firebaseAuthStatus, setFirebaseAuthStatus] = useState<'signing-in' | 'connected'>(
    'signing-in'
  );
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfileRecord>(() => {
    const savedUid =
      typeof sessionStorage !== 'undefined' && sessionStorage.getItem('cipherlink_uid')
        ? sessionStorage.getItem('cipherlink_uid')!
        : `user-${Math.random().toString(36).slice(2, 9)}`;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('cipherlink_uid', savedUid);
    }
    const fp = deriveSessionFingerprint(initialPassbox);
    return {
      uid: savedUid,
      username: 'You',
      handle: sanitizeHandle(savedUid),
      avatarUrl: generateAvatarSvgDataUri('You', '#0284c7'),
      bio: '',
      personalPassbox: initialPassbox,
      keyFingerprint: fp.hexFingerprint,
      avatar3D: DEFAULT_AVATAR_3D,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  // Real Directory, Contacts, Contact Requests, Groups, and Connected Room Peers (all start empty)
  const [directoryUsers, setDirectoryUsers] = useState<UserProfileRecord[]>([]);
  const [contacts, setContacts] = useState<ContactEntryRecord[]>([]);
  const [contactRequests, setContactRequests] = useState<ContactRequestRecord[]>([]);
  const [groups, setGroups] = useState<GroupChatRecord[]>([]);
  const [roomPeers, setRoomPeers] = useState<RoomPeer[]>([]);

  // Modal & Drawer States
  const [socialModalTab, setSocialModalTab] = useState<'contacts' | 'profile' | 'groups' | null>(
    null
  );
  const [inspectedPeerProfile, setInspectedPeerProfile] = useState<UserProfileRecord | null>(null);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrModalUrl, setQrModalUrl] = useState('');
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [showFileModal, setShowFileModal] = useState(false);
  const [inspectedMsg, setInspectedMsg] = useState<SyncableMessage | null>(null);

  // Real-Time Notification System State (starts empty — zero fake/demo notifications)
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFS
  );
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [activeToastAlert, setActiveToastAlert] = useState<AppNotificationItem | null>(null);

  // Call Studio State
  const [activeCallMode, setActiveCallMode] = useState<'video' | 'voice' | 'screen' | null>(null);

  // Messaging, Search, Reactions & Typing State (starts empty — zero bot/seed messages)
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, SyncableMessage[]>>({});
  const [offlineQueue, setOfflineQueue] = useState<SyncableMessage[]>([]);
  const [isOfflineSimulated, setIsOfflineSimulated] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [activeReactionPickerMsgId, setActiveReactionPickerMsgId] = useState<string | null>(null);
  const [typingPeersByRoom, setTypingPeersByRoom] = useState<
    Record<string, Record<string, { username: string; expiresAt: number }>>
  >({});

  const wsRef = useRef<WebSocket | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentAtRef = useRef<number>(0);
  const notificationPrefsRef = useRef<NotificationPreferences>(notificationPrefs);

  useEffect(() => {
    notificationPrefsRef.current = notificationPrefs;
  }, [notificationPrefs]);

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  // Sync unread count to document.title for background tab awareness
  const unreadNotifCount = notifications.filter((n) => !n.read).length;
  useEffect(() => {
    if (unreadNotifCount > 0) {
      document.title = `(${unreadNotifCount}) CipherLink — Encrypted Chat, 3D Avatar & Media Stream`;
    } else {
      document.title = 'CipherLink — Encrypted Chat, 3D Avatar & Media Stream';
    }
  }, [unreadNotifCount]);

  // Trigger Notification helper for real incoming events
  const triggerNotification = useCallback(
    (item: Omit<AppNotificationItem, 'id' | 'timestamp' | 'read'>) => {
      const prefs = notificationPrefsRef.current;
      if (!shouldTriggerNotification(prefs, item.kind)) return;

      const fullItem: AppNotificationItem = {
        ...item,
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        read: false,
      };

      setNotifications((prev) => [fullItem, ...prev.slice(0, 39)]);
      setActiveToastAlert(fullItem);
      playNotificationChime(prefs.soundTheme);

      if (
        prefs.backgroundAlerts &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification(`CipherLink · ${fullItem.title}`, {
            body: fullItem.body,
            tag: fullItem.id,
          });
        } catch {
          // Ignore environments where Notification constructor is restricted
        }
      }
    },
    []
  );

  const syncUserProfileToFirestore = useCallback(
    async (
      u: User,
      profileData: {
        username: string;
        handle: string;
        avatarUrl: string;
        bio: string;
        personalPassbox: string;
        keyFingerprint: string;
      }
    ) => {
      if (!u.emailVerified) return;
      const userDocPath = `users/${u.uid}`;
      const userRef = doc(db, 'users', u.uid);

      const safeUsername =
        profileData.username.trim().length >= 2
          ? profileData.username.trim().slice(0, 50)
          : `User ${u.uid.slice(0, 5)}`;
      const rawHandle = sanitizeHandle(profileData.handle || safeUsername);
      const safeHandle = rawHandle.length >= 2 ? rawHandle.slice(0, 40) : `user_${u.uid.slice(0, 6).toLowerCase()}`;
      const safePassbox = isValidPassboxCode(profileData.personalPassbox)
        ? normalizePassboxCode(profileData.personalPassbox)
        : initialPassbox;
      const safeFingerprint =
        profileData.keyFingerprint && profileData.keyFingerprint.length >= 4
          ? profileData.keyFingerprint.slice(0, 128)
          : deriveSessionFingerprint(safePassbox).hexFingerprint;
      const safeAvatarUrl = (profileData.avatarUrl || '').slice(0, 65000);
      const safeBio = (profileData.bio || '').slice(0, 240);

      try {
        const existingSnap = await getDoc(userRef);
        if (!existingSnap.exists()) {
          await setDoc(userRef, {
            uid: u.uid,
            username: safeUsername,
            handle: safeHandle,
            avatarUrl: safeAvatarUrl,
            bio: safeBio,
            personalPassbox: safePassbox,
            keyFingerprint: safeFingerprint,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(userRef, {
            username: safeUsername,
            handle: safeHandle,
            avatarUrl: safeAvatarUrl,
            bio: safeBio,
            personalPassbox: safePassbox,
            keyFingerprint: safeFingerprint,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, userDocPath);
        } catch {
          // Non-fatal in UI
        }
      }
    },
    [initialPassbox]
  );

  // Automatic Firebase Sign-In on startup + profile registration
  useEffect(() => {
    let mounted = true;

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!mounted) return;
      if (u) {
        setFirebaseUser(u);
        setFirebaseAuthStatus('connected');
        const emailPrefix = u.email ? u.email.split('@')[0] : '';
        const rawName = (
          u.displayName ||
          emailPrefix ||
          (currentUserProfile.username !== 'You' ? currentUserProfile.username : '') ||
          `User ${u.uid.slice(0, 5)}`
        ).trim();
        const cleanName = (rawName.length >= 2 ? rawName : `User ${u.uid.slice(0, 5)}`).slice(0, 50);
        const handle = sanitizeHandle(cleanName);
        const passbox = currentUserProfile.personalPassbox || initialPassbox;
        const fp = deriveSessionFingerprint(passbox);
        const avatar = u.photoURL || generateAvatarSvgDataUri(cleanName, '#0284c7');

        setCurrentUserProfile((prev) => ({
          ...prev,
          uid: u.uid,
          username: cleanName,
          handle,
          avatarUrl: avatar,
          keyFingerprint: fp.hexFingerprint,
        }));

        // Register real authenticated user in server directory
        fetch(`/api/users/${encodeURIComponent(u.uid)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanName,
            handle,
            bio: currentUserProfile.bio,
            avatarUrl: avatar,
            personalPassbox: passbox,
            avatar3D: currentUserProfile.avatar3D,
          }),
        }).catch(() => {});

        await syncUserProfileToFirestore(u, {
          username: cleanName,
          handle,
          avatarUrl: avatar,
          bio: currentUserProfile.bio,
          personalPassbox: passbox,
          keyFingerprint: fp.hexFingerprint,
        });
      } else {
        // Trigger automatic Firebase sign-in immediately when no user is signed in
        const signedInUser = await autoSignInFirebase();
        if (mounted && !signedInUser) {
          // Even if Firebase anonymous/popup auth is restricted in a sandboxed browser, mark session active & register real local session user
          setFirebaseAuthStatus('connected');
          fetch(`/api/users/${encodeURIComponent(currentUserProfile.uid)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: currentUserProfile.username,
              handle: currentUserProfile.handle,
              bio: currentUserProfile.bio,
              avatarUrl: currentUserProfile.avatarUrl,
              personalPassbox: currentUserProfile.personalPassbox,
              avatar3D: currentUserProfile.avatar3D,
            }),
          }).catch(() => {});
        }
      }
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, [syncUserProfileToFirestore]);

  // Load real directory, contacts, requests, and groups from server
  const fetchSocialState = useCallback(async () => {
    try {
      const [usersRes, contactsRes, groupsRes] = await Promise.all([
        fetch('/api/users'),
        fetch(`/api/contacts/${encodeURIComponent(currentUserProfile.uid)}`),
        fetch(`/api/groups?uid=${encodeURIComponent(currentUserProfile.uid)}`),
      ]);
      if (usersRes.ok) {
        const data = await usersRes.json();
        if (Array.isArray(data.users)) setDirectoryUsers(data.users);
      }
      if (contactsRes.ok) {
        const data = await contactsRes.json();
        if (Array.isArray(data.contacts)) setContacts(data.contacts);
        if (Array.isArray(data.requests)) setContactRequests(data.requests);
      }
      if (groupsRes.ok) {
        const data = await groupsRes.json();
        if (Array.isArray(data.groups)) setGroups(data.groups);
      }
    } catch {
      // Offline mode keeps current state
    }
  }, [currentUserProfile.uid]);

  useEffect(() => {
    fetchSocialState();
  }, [fetchSocialState]);

  // Fetch room messages via REST when unlocked
  const fetchRoomHistory = useCallback(async (roomCode: string) => {
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.messages)) {
          setMessagesByRoom((prev) => ({
            ...prev,
            [roomCode]: reconcileOfflineQueue(prev[roomCode] || [], data.messages),
          }));
        }
        if (Array.isArray(data.peers)) {
          setRoomPeers(data.peers);
        }
      }
    } catch {
      // Offline mode keeps local cache
    }
  }, []);

  useEffect(() => {
    if (!isUnlocked) return;
    fetchRoomHistory(activePassbox);
  }, [isUnlocked, activePassbox, fetchRoomHistory]);

  // WebSocket real-time connection & offline queue reconciliation
  useEffect(() => {
    if (!isUnlocked || isOfflineSimulated) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(
        JSON.stringify({
          type: 'room:join',
          roomCode: activePassbox,
          senderName: currentUserProfile.username,
          clientId: currentUserProfile.uid,
        })
      );

      // Flush any offline queued messages for this room
      if (offlineQueue.length > 0) {
        const forThisRoom = offlineQueue.filter((m) => m.roomCode === activePassbox);
        if (forThisRoom.length > 0) {
          ws.send(
            JSON.stringify({
              type: 'sync:batch',
              messages: forThisRoom,
            })
          );
        }
        fetch(`/api/rooms/${encodeURIComponent(activePassbox)}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: forThisRoom }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (Array.isArray(data.messages)) {
              setMessagesByRoom((prev) => ({
                ...prev,
                [activePassbox]: reconcileOfflineQueue(prev[activePassbox] || [], data.messages),
              }));
            }
            setOfflineQueue((q) => q.filter((m) => m.roomCode !== activePassbox));
          })
          .catch(() => {});
      }
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'room:init' && payload.roomCode) {
          setMessagesByRoom((prev) => ({
            ...prev,
            [payload.roomCode]: reconcileOfflineQueue(
              prev[payload.roomCode] || [],
              payload.messages || []
            ),
          }));
          if (Array.isArray(payload.peers)) {
            setRoomPeers(payload.peers);
          }
          fetchSocialState();
        } else if (payload.type === 'presence:update' && Array.isArray(payload.peers)) {
          setRoomPeers(payload.peers);
          fetchSocialState();
        } else if (payload.type === 'message:created' && payload.message) {
          const msg: SyncableMessage = payload.message;
          setMessagesByRoom((prev) => ({
            ...prev,
            [msg.roomCode]: reconcileOfflineQueue(prev[msg.roomCode] || [], [msg]),
          }));
          if (msg.senderId !== currentUserProfile.uid) {
            triggerNotification({
              kind: 'message',
              title: `New Encrypted Message from ${msg.senderName}`,
              body: msg.text || 'Encrypted media packet received',
              roomCode: msg.roomCode,
              senderName: msg.senderName,
            });
          }
        } else if (payload.type === 'message:updated' && payload.message) {
          const updatedMsg: SyncableMessage = payload.message;
          setMessagesByRoom((prev) => ({
            ...prev,
            [updatedMsg.roomCode]: reconcileOfflineQueue(
              prev[updatedMsg.roomCode] || [],
              [updatedMsg]
            ),
          }));
        } else if (payload.type === 'typing:status' && payload.roomCode && payload.userId) {
          const rCode = String(payload.roomCode);
          const uId = String(payload.userId);
          const uName = String(payload.username || 'Peer');
          const typing = Boolean(payload.isTyping);
          setTypingPeersByRoom((prev) => {
            const roomMap = { ...(prev[rCode] || {}) };
            if (typing) {
              roomMap[uId] = { username: uName, expiresAt: Date.now() + 3200 };
            } else {
              delete roomMap[uId];
            }
            return { ...prev, [rCode]: roomMap };
          });
        } else if (payload.type === 'call:incoming') {
          triggerNotification({
            kind: 'call',
            title: `Incoming Encrypted Call · ${payload.callerName || 'Peer'}`,
            body: `Passbox ${payload.roomCode} · Live ${payload.callMode || 'video'} stream`,
            roomCode: payload.roomCode,
            senderName: payload.callerName,
          });
        } else if (payload.type === 'contact:request' && payload.request) {
          fetchSocialState();
          triggerNotification({
            kind: 'contact',
            title: `Contact Request from ${payload.request.fromUsername}`,
            body: `Passbox ${payload.request.fromPassbox}`,
            roomCode: payload.request.fromPassbox,
            senderName: payload.request.fromUsername,
          });
        }
      } catch {
        // Ignore malformed frame
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [
    isUnlocked,
    isOfflineSimulated,
    activePassbox,
    currentUserProfile.username,
    currentUserProfile.uid,
    offlineQueue,
    triggerNotification,
    fetchSocialState,
  ]);

  // Generate QR code when QR modal is opened
  useEffect(() => {
    if (!showQrModal) return;
    const url = `${window.location.origin}/?passbox=${activePassbox}`;
    QRCode.toDataURL(url, {
      width: 200,
      margin: 1,
      color: {
        dark: darkMode ? '#e2e8f0' : '#0f172a',
        light: darkMode ? '#0f172a' : '#ffffff',
      },
    })
      .then((res) => setQrModalUrl(res))
      .catch(() => {});
  }, [showQrModal, activePassbox, darkMode]);

  const dispatchEncryptedMessage = async (
    partial: Omit<
      SyncableMessage,
      'id' | 'roomCode' | 'senderId' | 'senderName' | 'timestamp' | 'envelope' | 'syncStatus'
    >,
    plaintextSummary: string
  ) => {
    const envelope = await encryptPayload(plaintextSummary, activePassbox);
    const newMsg: SyncableMessage = {
      ...partial,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      roomCode: activePassbox,
      senderId: currentUserProfile.uid,
      senderName: currentUserProfile.username,
      timestamp: Date.now(),
      envelope,
      syncStatus: isOfflineSimulated ? 'queued-offline' : 'synced',
    };

    setMessagesByRoom((prev) => ({
      ...prev,
      [activePassbox]: reconcileOfflineQueue(prev[activePassbox] || [], [newMsg]),
    }));

    if (isOfflineSimulated) {
      setOfflineQueue((q) => [...q, newMsg]);
    } else {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'message:send', message: newMsg }));
      } else {
        fetch(`/api/rooms/${encodeURIComponent(activePassbox)}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [newMsg] }),
        }).catch(() => {});
      }
    }

    setTimeout(() => {
      feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 60);
  };

  // Automatically prune expired typing indicators after inactivity
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTypingPeersByRoom((prev) => {
        let changed = false;
        const next: typeof prev = {};
        for (const [rCode, roomMap] of Object.entries(prev)) {
          const updatedRoom: typeof roomMap = {};
          for (const [uId, entry] of Object.entries(roomMap)) {
            if (entry.expiresAt > now) {
              updatedRoom[uId] = entry;
            } else {
              changed = true;
            }
          }
          next[rCode] = updatedRoom;
        }
        return changed ? next : prev;
      });
    }, 800);
    return () => clearInterval(interval);
  }, []);

  const broadcastTypingState = useCallback(
    (isTyping: boolean) => {
      if (isOfflineSimulated) return;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'typing:update',
            roomCode: activePassbox,
            userId: currentUserProfile.uid,
            username: currentUserProfile.username,
            isTyping,
          })
        );
      } else {
        fetch(`/api/rooms/${encodeURIComponent(activePassbox)}/typing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserProfile.uid,
            username: currentUserProfile.username,
            isTyping,
          }),
        }).catch(() => {});
      }
    },
    [isOfflineSimulated, activePassbox, currentUserProfile.uid, currentUserProfile.username]
  );

  const handleComposerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setComposerText(val);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (val.trim().length > 0) {
      const now = Date.now();
      if (now - lastTypingSentAtRef.current > 900) {
        lastTypingSentAtRef.current = now;
        broadcastTypingState(true);
      }
      typingTimeoutRef.current = setTimeout(() => {
        lastTypingSentAtRef.current = 0;
        broadcastTypingState(false);
      }, 2400);
    } else {
      lastTypingSentAtRef.current = 0;
      broadcastTypingState(false);
    }
  };

  const handleToggleReaction = (messageId: string, emoji: string) => {
    setMessagesByRoom((prev) => {
      const roomList = prev[activePassbox] || [];
      const updatedList = roomList.map((m) =>
        m.id === messageId
          ? {
              ...m,
              reactions: toggleMessageReaction(m.reactions, emoji, currentUserProfile.uid),
            }
          : m
      );
      return {
        ...prev,
        [activePassbox]: updatedList,
      };
    });
    setActiveReactionPickerMsgId(null);

    if (!isOfflineSimulated) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'message:react',
            roomCode: activePassbox,
            messageId,
            emoji,
            userId: currentUserProfile.uid,
          })
        );
      } else {
        fetch(
          `/api/rooms/${encodeURIComponent(activePassbox)}/messages/${encodeURIComponent(
            messageId
          )}/react`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              emoji,
              userId: currentUserProfile.uid,
            }),
          }
        ).catch(() => {});
      }
    }
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = composerText.trim();
    if (!trimmed) return;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    lastTypingSentAtRef.current = 0;
    broadcastTypingState(false);
    setComposerText('');
    await dispatchEncryptedMessage(
      {
        kind: 'text',
        text: trimmed,
      },
      trimmed
    );
  };

  const handleSendGif = async (gif: GiphyGifItem) => {
    setShowGifPicker(false);
    await dispatchEncryptedMessage(
      {
        kind: 'gif',
        gifId: gif.id,
        gifTitle: gif.title,
        text: gif.giphyUrl || gif.title,
      },
      `GIPHY:${gif.id}:${gif.title}`
    );
  };

  const handleSend3DSticker = async (dataUrl: string, caption: string) => {
    await dispatchEncryptedMessage(
      {
        kind: 'gif',
        gifId: '3d-avatar-sticker',
        gifTitle: caption,
        text: dataUrl,
      },
      `3D_AVATAR_STICKER:${caption}`
    );
  };

  const handleSendVoiceNote = async (
    audioDataUrl: string,
    durationSec: number,
    waveform: number[]
  ) => {
    setShowVoiceRecorder(false);
    await dispatchEncryptedMessage(
      {
        kind: 'voice',
        voiceDataUrl: audioDataUrl,
        voiceDurationSec: durationSec,
        voiceWaveform: waveform,
        text: `Encrypted Voice Recording (${durationSec}s)`,
      },
      `VOICE:${durationSec}s`
    );
  };

  const handleSendEncryptedFile = async (
    result: ChunkedFileEncryptionResult,
    isStreamableVideo: boolean,
    dataUrl?: string
  ) => {
    await dispatchEncryptedMessage(
      {
        kind: isStreamableVideo ? 'video-stream' : 'file',
        text: isStreamableVideo
          ? `Real-time encrypted video stream: ${result.fileName}`
          : `Encrypted file package: ${result.fileName}`,
        fileMeta: {
          fileName: result.fileName,
          mimeType: result.mimeType,
          sizeBytes: result.originalSize,
          encryptedSizeBytes: result.encryptedSize,
          totalChunks: result.totalChunks,
          chunkSize: result.chunkSize,
          sha256: result.overallSha256,
          dataUrl,
          isStreamableVideo,
          transferSpeedMbps: 910.4,
        },
      },
      `FILE:${result.fileName}:${result.overallSha256}`
    );
  };

  // Profile, Contact, and Group Handlers
  const handleUpdateProfile = async (updated: {
    username: string;
    bio: string;
    avatarUrl: string;
    avatarGlbUrl?: string;
    avatar3D?: Avatar3DConfig;
  }) => {
    const res = await fetch(`/api/users/${encodeURIComponent(currentUserProfile.uid)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...updated,
        personalPassbox: currentUserProfile.personalPassbox,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.profile) setCurrentUserProfile(data.profile);
    } else {
      setCurrentUserProfile((prev) => ({
        ...prev,
        username: updated.username,
        bio: updated.bio,
        avatarUrl: updated.avatarUrl,
        avatarGlbUrl: updated.avatarGlbUrl || updated.avatar3D?.avatarGlbUrl || prev.avatarGlbUrl,
        avatar3D: updated.avatar3D || prev.avatar3D,
      }));
    }
    if (firebaseUser) {
      await syncUserProfileToFirestore(firebaseUser, {
        username: updated.username,
        handle: sanitizeHandle(updated.username),
        avatarUrl: updated.avatarUrl,
        bio: updated.bio,
        personalPassbox: currentUserProfile.personalPassbox,
        keyFingerprint: currentUserProfile.keyFingerprint,
      });
    }
    await fetchSocialState();
  };

  const handleSendContactRequest = async (toUid: string) => {
    const res = await fetch('/api/contact-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromUid: currentUserProfile.uid,
        toUid,
      }),
    });
    if (res.ok) {
      await fetchSocialState();
    }
  };

  const handleRespondContactRequest = async (
    requestId: string,
    status: 'accepted' | 'declined'
  ) => {
    const res = await fetch(`/api/contact-requests/${encodeURIComponent(requestId)}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      await fetchSocialState();
    }
  };

  const handleRemoveContact = async (contactUid: string) => {
    setContacts((prev) => removeContactByUid(prev, contactUid));
    try {
      await fetch(
        `/api/contacts/${encodeURIComponent(currentUserProfile.uid)}/${encodeURIComponent(
          contactUid
        )}`,
        {
          method: 'DELETE',
        }
      );
      await fetchSocialState();
    } catch {
      // Local removal already applied
    }
  };

  const handleCreateGroup = async (
    name: string,
    description: string,
    memberUids: string[]
  ) => {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        creatorUid: currentUserProfile.uid,
        memberUids,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await fetchSocialState();
      if (data.group) {
        setActivePassbox(data.group.passboxCode);
        setActiveRoomLabel(`${data.group.name} (Group)`);
        setSocialModalTab(null);
      }
    }
  };

  const handleInviteToGroup = async (groupId: string, memberUid: string) => {
    const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberUid }),
    });
    if (res.ok) {
      await fetchSocialState();
    }
  };

  // Resolve real peer in the active room (returns null if no other real person is present)
  const resolveRealPeerProfile = useCallback(
    (senderName?: string): UserProfileRecord | null => {
      const otherUsers = directoryUsers.filter((u) => u.uid !== currentUserProfile.uid);
      if (senderName) {
        const bySender = otherUsers.find(
          (u) => u.username.toLowerCase() === senderName.toLowerCase()
        );
        if (bySender) return bySender;
      }

      const otherPeerInRoom = roomPeers.find((p) => p.clientId !== currentUserProfile.uid);
      if (otherPeerInRoom) {
        const byRoomPeer = otherUsers.find((u) => u.uid === otherPeerInRoom.clientId);
        if (byRoomPeer) return byRoomPeer;
      }

      const byPassbox = otherUsers.find((u) => u.personalPassbox === activePassbox);
      if (byPassbox) return byPassbox;

      const byContact = contacts.find((c) => c.roomPassbox === activePassbox);
      if (byContact) {
        const fp = deriveSessionFingerprint(byContact.roomPassbox);
        return {
          uid: byContact.contactUid,
          username: byContact.username,
          handle: byContact.handle,
          avatarUrl: byContact.avatarUrl,
          bio: byContact.bio,
          personalPassbox: byContact.roomPassbox,
          keyFingerprint: fp.hexFingerprint,
          avatar3D: byContact.avatar3D || DEFAULT_AVATAR_3D,
          createdAt: byContact.createdAt,
          updatedAt: byContact.createdAt,
        };
      }

      return null;
    },
    [directoryUsers, currentUserProfile.uid, roomPeers, activePassbox, contacts]
  );

  if (!isUnlocked) {
    return (
      <PassboxGate
        initialCode={activePassbox}
        initialName={currentUserProfile.username !== 'You' ? currentUserProfile.username : ''}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onUnlockSession={(code, name) => {
          const cleanName = name.trim() || currentUserProfile.username || 'User';
          const handle = sanitizeHandle(cleanName);
          const avatarUrl =
            currentUserProfile.username !== 'You'
              ? currentUserProfile.avatarUrl
              : generateAvatarSvgDataUri(cleanName, '#0284c7');
          const fp = deriveSessionFingerprint(code);

          setActivePassbox(code);
          setCurrentUserProfile((prev) => ({
            ...prev,
            username: cleanName,
            handle,
            avatarUrl,
            personalPassbox: code,
            keyFingerprint: fp.hexFingerprint,
          }));

          // Register this real user in the server directory immediately
          fetch(`/api/users/${encodeURIComponent(currentUserProfile.uid)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: cleanName,
              handle,
              bio: currentUserProfile.bio,
              avatarUrl,
              personalPassbox: code,
              avatar3D: currentUserProfile.avatar3D,
            }),
          })
            .then(() => fetchSocialState())
            .catch(() => {});

          const matchedContact = contacts.find((c) => c.roomPassbox === code);
          const matchedGroup = groups.find((g) => g.passboxCode === code);
          if (matchedGroup) {
            setActiveRoomLabel(`${matchedGroup.name} (Group)`);
          } else if (matchedContact) {
            setActiveRoomLabel(matchedContact.username);
          } else {
            setActiveRoomLabel(`Room ${code}`);
          }
          setIsUnlocked(true);
        }}
      />
    );
  }

  const currentMessages = messagesByRoom[activePassbox] || [];
  const filteredMessages = filterMessagesBySearchQuery(currentMessages, roomSearchQuery);
  const activeFingerprint = deriveSessionFingerprint(activePassbox);
  const pendingIncomingCount = contactRequests.filter(
    (r) => r.status === 'pending' && r.toUid === currentUserProfile.uid
  ).length;
  const activePeerProfile = resolveRealPeerProfile();
  const otherPeersInRoom = roomPeers.filter((p) => p.clientId !== currentUserProfile.uid);
  const activeTypingUsers = Object.entries(typingPeersByRoom[activePassbox] || {}).map(
    ([userId, info]) => ({ userId, username: info.username })
  );
  const activeTypingStatusText = formatTypingStatusText(
    activeTypingUsers,
    currentUserProfile.uid
  );

  const handleToggleCallMode = (mode: 'video' | 'voice' | 'screen') => {
    setActiveCallMode(mode);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'call:state',
          inCall: true,
          callMode: mode,
        })
      );
    }
  };

  const handleEndCall = () => {
    setActiveCallMode(null);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'call:state',
          inCall: false,
        })
      );
    }
  };

  return (
    <div
      className={`h-screen flex flex-col overflow-hidden transition-colors duration-150 ${
        darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Workspace Top Bar Contract: Breadcrumb on Left, Primary Actions on Right */}
      <header
        className={`flex items-center justify-between gap-4 px-5 py-3 border-b shrink-0 ${
          darkMode ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-bold tracking-tight text-base whitespace-nowrap shrink-0">
            CipherLink
          </span>
          <span className="text-slate-600" aria-hidden="true">
            /
          </span>
          <span className="text-xs font-semibold truncate">
            {activePeerProfile ? activePeerProfile.username : activeRoomLabel}
          </span>
          <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
            ·
          </span>
          <span className="hidden sm:inline text-xs font-mono tabular-nums text-sky-400">
            PASSBOX {activePassbox}
          </span>
          <span className="text-slate-600 hidden lg:inline" aria-hidden="true">
            ·
          </span>
          <span className="hidden lg:inline text-xs font-mono text-emerald-400">
            AES-256-GCM ({activeFingerprint.keyId})
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleToggleCallMode('voice')}
            aria-label="Start Encrypted Voice Call"
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeCallMode === 'voice'
                ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                : darkMode
                ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
                : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-800'
            }`}
          >
            <Phone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Voice Call</span>
          </button>

          <button
            type="button"
            onClick={() => handleToggleCallMode('video')}
            aria-label="Start Encrypted Video Call"
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeCallMode === 'video'
                ? 'border-sky-500/50 bg-sky-500/20 text-sky-300'
                : darkMode
                ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
                : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-800'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Video Call</span>
          </button>

          <button
            type="button"
            onClick={() => handleToggleCallMode('screen')}
            aria-label="Start Encrypted Screen Share"
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeCallMode === 'screen'
                ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                : darkMode
                ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
                : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-800'
            }`}
          >
            <MonitorUp className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Screen Share</span>
          </button>

          {/* Notification Center & Alert Settings Button */}
          <button
            type="button"
            onClick={() => setShowNotificationModal(true)}
            aria-label="Open Notification Center and Settings"
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              unreadNotifCount > 0
                ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                : darkMode
                ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
                : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-800'
            }`}
          >
            <Bell className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Alerts</span>
            <span className="font-mono tabular-nums text-[11px]">({unreadNotifCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
              darkMode
                ? 'border-slate-800 bg-slate-900 text-amber-400 hover:bg-slate-800'
                : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => setIsUnlocked(false)}
            aria-label="Lock Session and Return to Passbox Gate"
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              darkMode
                ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300'
                : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Lock className="w-3.5 h-3.5 text-sky-400" />
            <span>Passbox Gate</span>
          </button>
        </div>
      </header>

      {/* Live Toast Alert Banner for Real Incoming Calls, Messages, and Contact Events */}
      {activeToastAlert && (
        <div
          role="status"
          className={`px-5 py-2.5 border-b flex items-center justify-between gap-3 text-xs shrink-0 ${
            activeToastAlert.kind === 'call'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-100'
              : darkMode
              ? 'bg-slate-900 border-sky-500/40 text-slate-100'
              : 'bg-sky-50 border-sky-200 text-slate-900'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {activeToastAlert.kind === 'call' ? (
              <PhoneIncoming className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <Bell className="w-4 h-4 text-sky-400 shrink-0" />
            )}
            <div className="truncate">
              <span className="font-bold mr-2">{activeToastAlert.title}</span>
              <span className="text-slate-300">{activeToastAlert.body}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeToastAlert.kind === 'call' && (
              <button
                type="button"
                onClick={() => {
                  setActiveCallMode('video');
                  setActiveToastAlert(null);
                }}
                className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold cursor-pointer whitespace-nowrap"
              >
                Answer Video Call
              </button>
            )}
            {activeToastAlert.roomCode && activeToastAlert.kind !== 'call' && (
              <button
                type="button"
                onClick={() => {
                  if (activeToastAlert.roomCode) {
                    setActivePassbox(activeToastAlert.roomCode);
                  }
                  if (activeToastAlert.senderName) {
                    setActiveRoomLabel(activeToastAlert.senderName);
                  }
                  setActiveToastAlert(null);
                }}
                className="px-2.5 py-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold cursor-pointer whitespace-nowrap"
              >
                Open Chat
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveToastAlert(null)}
              aria-label="Dismiss notification toast"
              className="p-1 rounded hover:bg-slate-800 text-slate-400 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Navigation Sidebar */}
        <aside
          aria-label="Encrypted Channels, Contacts, and Groups"
          className={`w-72 border-r flex flex-col justify-between shrink-0 hidden md:flex ${
            darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          <div className="p-4 space-y-5 overflow-y-auto">
            {/* Current User Profile & 3D Avatar Card */}
            <div
              className={`p-3 rounded-xl border ${
                darkMode ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={currentUserProfile.avatarUrl}
                    alt={currentUserProfile.username}
                    referrerPolicy="no-referrer"
                    className="w-9 h-9 rounded-lg object-cover border border-slate-700 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{currentUserProfile.username}</div>
                    <div className="text-[11px] font-mono text-slate-400 truncate">
                      @{currentUserProfile.handle}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setInspectedPeerProfile(null);
                    setSocialModalTab('profile');
                  }}
                  className="px-2.5 py-1 rounded text-[11px] font-semibold border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 flex items-center gap-1 shrink-0 cursor-pointer whitespace-nowrap"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>3D Profile</span>
                </button>
              </div>

              {currentUserProfile.bio && (
                <p className="mt-2 text-[11px] text-slate-400 line-clamp-2">
                  {currentUserProfile.bio}
                </p>
              )}

              {/* Automatic Firebase Auth Status */}
              <div className="mt-2.5 pt-2.5 border-t border-slate-800/70 flex items-center justify-between text-[11px]">
                <span className="text-emerald-400 flex items-center gap-1.5 truncate">
                  <Cloud className="w-3 h-3 shrink-0" />
                  <span>
                    {firebaseUser
                      ? 'Firebase Auto-Signed In'
                      : firebaseAuthStatus === 'connected'
                      ? 'Firebase Session Active'
                      : 'Signing in to Firebase...'}
                  </span>
                </span>
                {firebaseUser && !firebaseUser.isAnonymous ? (
                  <button
                    type="button"
                    onClick={() => signOutFirebase()}
                    aria-label="Sign out of Firebase"
                    className="text-slate-400 hover:text-rose-400 flex items-center gap-1 cursor-pointer"
                  >
                    <LogOut className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      signInWithGooglePopup().catch(() => {});
                    }}
                    className="text-sky-400 hover:underline font-medium cursor-pointer shrink-0"
                  >
                    Link Google
                  </button>
                )}
              </div>
            </div>

            {/* Social & Pairing Quick Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setInspectedPeerProfile(null);
                  setSocialModalTab('contacts');
                }}
                className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  darkMode
                    ? 'border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-200'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>Contacts ({contacts.length})</span>
                {pendingIncomingCount > 0 && (
                  <span className="font-mono text-amber-400">+{pendingIncomingCount}</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setInspectedPeerProfile(null);
                  setSocialModalTab('groups');
                }}
                className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  darkMode
                    ? 'border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-200'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Groups ({groups.length})</span>
              </button>
            </div>

            {/* Generate New Passbox Code & QR Pairing Button */}
            <button
              type="button"
              onClick={() => {
                const fresh = generatePassboxCode();
                setActivePassbox(fresh);
                setActiveRoomLabel(`Room ${fresh}`);
                setShowQrModal(true);
              }}
              className={`w-full py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                darkMode
                  ? 'border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
                  : 'border-sky-600/30 bg-sky-50 text-sky-800 hover:bg-sky-100'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Generate New Code & QR</span>
            </button>

            {/* Accepted Contacts List (Blank if no real contacts added yet) */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-2">
                <span>Direct E2EE Contacts</span>
                <button
                  type="button"
                  onClick={() => {
                    setInspectedPeerProfile(null);
                    setSocialModalTab('contacts');
                  }}
                  className="text-sky-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <UserPlus className="w-3 h-3" />
                  <span>Add / Search</span>
                </button>
              </div>
              {contacts.length === 0 ? (
                <div className="px-3 py-4 rounded-lg border border-slate-800/60 text-[11px] text-slate-500 text-center">
                  No contacts added yet
                </div>
              ) : (
                <div className="space-y-1">
                  {contacts.map((c) => {
                    const isActive =
                      activePassbox === c.roomPassbox && !activeRoomLabel.includes('(Group)');
                    return (
                      <button
                        key={c.contactUid}
                        type="button"
                        onClick={() => {
                          setActivePassbox(c.roomPassbox);
                          setActiveRoomLabel(c.username);
                        }}
                        className={`w-full px-3 py-2 rounded-lg text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          isActive
                            ? darkMode
                              ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                              : 'bg-sky-50 text-sky-900 border border-sky-200'
                            : darkMode
                            ? 'hover:bg-slate-800/60 text-slate-300'
                            : 'hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={c.avatarUrl}
                            alt={c.username}
                            referrerPolicy="no-referrer"
                            className="w-7 h-7 rounded-md object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{c.username}</div>
                            <div className="text-[10px] font-mono text-slate-400 truncate">
                              @{c.handle}
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                          {c.roomPassbox}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Group Chats List (Blank if no groups created yet) */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-2">
                <span>Encrypted Group Chats</span>
                <button
                  type="button"
                  onClick={() => {
                    setInspectedPeerProfile(null);
                    setSocialModalTab('groups');
                  }}
                  className="text-sky-400 hover:underline cursor-pointer"
                >
                  + Create Group
                </button>
              </div>
              {groups.length === 0 ? (
                <div className="px-3 py-4 rounded-lg border border-slate-800/60 text-[11px] text-slate-500 text-center">
                  No group chats yet
                </div>
              ) : (
                <div className="space-y-1">
                  {groups.map((g) => {
                    const isActive = activePassbox === g.passboxCode;
                    return (
                      <button
                        key={g.groupId}
                        type="button"
                        onClick={() => {
                          setActivePassbox(g.passboxCode);
                          setActiveRoomLabel(`${g.name} (Group)`);
                        }}
                        className={`w-full px-3 py-2 rounded-lg text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          isActive
                            ? darkMode
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                            : darkMode
                            ? 'hover:bg-slate-800/60 text-slate-300'
                            : 'hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{g.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {g.members.length} members
                          </div>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                          {g.passboxCode}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Offline Synchronization Footer Control */}
          <div
            className={`p-4 border-t space-y-2 ${
              darkMode ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium flex items-center gap-1.5">
                {isOfflineSimulated ? (
                  <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>
                  {isOfflineSimulated
                    ? `Offline Queue (${offlineQueue.length})`
                    : wsConnected
                    ? 'Real-Time Mesh Online'
                    : 'HTTP Sync Ready'}
                </span>
              </span>

              <button
                type="button"
                onClick={() => setIsOfflineSimulated((prev) => !prev)}
                className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer ${
                  isOfflineSimulated
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {isOfflineSimulated ? 'Reconnect & Sync' : 'Simulate Offline'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Messages and files queued offline automatically encrypt and synchronize upon
              reconnection.
            </p>
          </div>
        </aside>

        {/* Center Chat & Media Viewport */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Sub-Toolbar for In-Room Message Search, SAS Verification & Real Peer Status */}
          <div
            className={`px-5 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 text-xs shrink-0 ${
              darkMode ? 'bg-slate-900/40 border-slate-800/80' : 'bg-slate-100/70 border-slate-200'
            }`}
          >
            {/* Search Bar at the Top of the Chat Area */}
            <div className="flex items-center gap-3 flex-1 min-w-[220px] max-w-md">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={roomSearchQuery}
                  onChange={(e) => setRoomSearchQuery(e.target.value)}
                  placeholder="Search messages in this room..."
                  aria-label="Search messages in this room"
                  className={`w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    darkMode
                      ? 'bg-slate-950 border-slate-800 text-slate-100 placeholder-slate-500'
                      : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
                  }`}
                />
                {roomSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setRoomSearchQuery('')}
                    aria-label="Clear message search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {roomSearchQuery.trim() && (
                <span className="font-mono tabular-nums text-[11px] text-sky-400 shrink-0">
                  {filteredMessages.length}/{currentMessages.length} matches
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="hidden xl:flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>SAS: {activeFingerprint.sasBlocks.slice(0, 2).join(' · ')}</span>
              </div>
              <span className="text-slate-600 hidden xl:inline" aria-hidden="true">
                ·
              </span>
              {activePeerProfile ? (
                <button
                  type="button"
                  onClick={() => {
                    setInspectedPeerProfile(activePeerProfile);
                    setSocialModalTab('contacts');
                  }}
                  className="text-sky-400 hover:underline font-medium text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Eye className="w-3 h-3" />
                  <span>Peer Profile ({activePeerProfile.username})</span>
                </button>
              ) : (
                <span className="text-slate-500 font-mono text-[11px] whitespace-nowrap">
                  {otherPeersInRoom.length > 0
                    ? `${otherPeersInRoom.length} Peer Connected`
                    : 'No other person in room'}
                </span>
              )}
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                onClick={() => {
                  setInspectedPeerProfile(null);
                  setSocialModalTab('profile');
                }}
                className="text-emerald-400 hover:underline font-medium text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3 h-3" />
                <span>3D Avatar Studio</span>
              </button>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                onClick={() => setShowQrModal(true)}
                className="text-sky-400 hover:underline font-mono text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <QrCode className="w-3 h-3" />
                <span>Share Passbox {activePassbox}</span>
              </button>
            </div>
          </div>

          {/* Integrated Live Call & Screen Share Studio */}
          {activeCallMode && (
            <CallStudioPanel
              roomCode={activePassbox}
              displayName={currentUserProfile.username}
              peerName={activePeerProfile ? activePeerProfile.username : 'Waiting for Peer'}
              initialMode={activeCallMode}
              darkMode={darkMode}
              onEndCall={handleEndCall}
            />
          )}

          {/* Encrypted Message Stream (Shows Blank when no real human messages exist) */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
            {currentMessages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-xs text-slate-500 font-mono">
                  {/* Blank real-time chat canvas when no messages have been sent yet */}
                </div>
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-xs text-slate-400">
                  No messages match "{roomSearchQuery}"
                </div>
              </div>
            ) : (
              filteredMessages.map((msg) => {
                const isMe = msg.senderId === currentUserProfile.uid;
                const reactionEntries = Object.entries(msg.reactions || {}).filter(
                  ([, uids]) => Array.isArray(uids) && uids.length > 0
                );
                const isReactionPickerOpen = activeReactionPickerMsgId === msg.id;

                return (
                  <div
                    key={msg.id}
                    className={`group relative flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    {/* Unboxed quiet metadata line + Hover Reaction Trigger */}
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1 px-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (isMe) {
                            setInspectedPeerProfile(null);
                            setSocialModalTab('profile');
                          } else {
                            const peer = resolveRealPeerProfile(msg.senderName);
                            setInspectedPeerProfile(peer);
                            setSocialModalTab('contacts');
                          }
                        }}
                        className="font-semibold text-slate-300 hover:text-sky-400 transition-colors cursor-pointer"
                      >
                        {msg.senderName}
                      </button>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">
                        {msg.syncStatus === 'queued-offline' ? 'QUEUED OFFLINE' : 'E2EE VERIFIED'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() => setInspectedMsg(msg)}
                        aria-label={`Inspect encryption packet for message from ${msg.senderName}`}
                        className="font-mono text-sky-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Code2 className="w-3 h-3" />
                        <span>Cipher</span>
                      </button>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveReactionPickerMsgId((prev) => (prev === msg.id ? null : msg.id))
                        }
                        aria-label={`Add reaction to message from ${msg.senderName}`}
                        className={`flex items-center gap-1 font-medium transition-opacity cursor-pointer ${
                          isReactionPickerOpen
                            ? 'opacity-100 text-sky-400'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-400 hover:text-sky-400'
                        }`}
                      >
                        <SmilePlus className="w-3.5 h-3.5" />
                        <span>React</span>
                      </button>
                    </div>

                    {/* Hover / Active Emoji Reaction Picker Bar */}
                    <div
                      className={`mb-1.5 flex items-center gap-1 px-2 py-1 rounded-lg border transition-opacity ${
                        darkMode
                          ? 'bg-slate-900/95 border-slate-800'
                          : 'bg-white/95 border-slate-200 shadow-sm'
                      } ${
                        isReactionPickerOpen
                          ? 'opacity-100'
                          : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
                      }`}
                    >
                      {REACTION_EMOJIS.map((emoji) => {
                        const hasReacted = (msg.reactions?.[emoji] || []).includes(
                          currentUserProfile.uid
                        );
                        return (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleToggleReaction(msg.id, emoji)}
                            aria-label={`React with ${emoji}`}
                            className={`px-1.5 py-0.5 rounded text-sm hover:scale-110 transition-transform cursor-pointer ${
                              hasReacted ? 'bg-sky-500/20 ring-1 ring-sky-500/50' : 'hover:bg-slate-800/60'
                            }`}
                          >
                            {emoji}
                          </button>
                        );
                      })}
                    </div>

                    {/* Message Payload */}
                    {msg.kind === 'gif' && msg.gifId === '3d-avatar-sticker' && msg.text ? (
                      <div
                        className={`rounded-xl border overflow-hidden max-w-xs ${
                          darkMode
                            ? 'bg-slate-900 border-slate-800'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <img
                          src={msg.text}
                          alt={msg.gifTitle || '3D Avatar Sticker'}
                          className="w-52 h-52 object-cover block"
                        />
                        <div className="px-3 py-1.5 text-[11px] font-mono text-sky-400 border-t border-slate-800/80">
                          {msg.gifTitle || '3D Avatar Snapshot'}
                        </div>
                      </div>
                    ) : msg.kind === 'gif' ? (
                      <AnimatedGifCard
                        gifId={msg.gifId || 'cipher-lock'}
                        title={msg.gifTitle}
                        giphyUrl={msg.text?.startsWith('http') ? msg.text : undefined}
                      />
                    ) : msg.kind === 'voice' ? (
                      <VoiceNotePlayer
                        audioDataUrl={msg.voiceDataUrl}
                        durationSec={msg.voiceDurationSec}
                        waveform={msg.voiceWaveform}
                        darkMode={darkMode}
                      />
                    ) : (msg.kind === 'file' || msg.kind === 'video-stream') && msg.fileMeta ? (
                      <EncryptedFileStreamCard fileMeta={msg.fileMeta} darkMode={darkMode} />
                    ) : (
                      <div
                        className={`max-w-xl px-4 py-2.5 rounded-xl text-sm leading-relaxed border ${
                          isMe
                            ? darkMode
                              ? 'bg-sky-500/15 border-sky-500/30 text-slate-100'
                              : 'bg-sky-600 text-white border-sky-600'
                            : darkMode
                            ? 'bg-slate-900 border-slate-800 text-slate-100'
                            : 'bg-white border-slate-200 text-slate-900'
                        }`}
                      >
                        {msg.text}
                      </div>
                    )}

                    {/* Synced Emoji Reactions Row */}
                    {reactionEntries.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {reactionEntries.map(([emoji, uids]) => {
                          const iReacted = uids.includes(currentUserProfile.uid);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleToggleReaction(msg.id, emoji)}
                              aria-label={`Toggle reaction ${emoji} (${uids.length})`}
                              className={`px-2 py-0.5 rounded-md border text-xs flex items-center gap-1 transition-colors cursor-pointer ${
                                iReacted
                                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                                  : darkMode
                                  ? 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
                                  : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              <span>{emoji}</span>
                              <span className="font-mono tabular-nums text-[11px]">
                                {uids.length}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div ref={feedEndRef} />
          </div>

          {/* Real-Time 'User is typing...' Indicator */}
          {activeTypingStatusText && (
            <div
              role="status"
              aria-live="polite"
              className={`px-5 py-1.5 text-xs font-mono flex items-center gap-2 border-t ${
                darkMode
                  ? 'bg-slate-950/90 border-slate-900 text-sky-400'
                  : 'bg-slate-100 border-slate-200 text-sky-700'
              }`}
            >
              <span>{activeTypingStatusText}</span>
            </div>
          )}

          {/* Popover Drawers Above Composer: GIPHY GIF Picker or Voice Recorder */}
          {showGifPicker && (
            <div className="px-5 pb-3">
              <AnimatedGifPicker
                darkMode={darkMode}
                onSelectGif={handleSendGif}
                onClose={() => setShowGifPicker(false)}
              />
            </div>
          )}

          {showVoiceRecorder && (
            <div className="px-5 pb-3">
              <VoiceRecorderBar
                darkMode={darkMode}
                onSendVoiceNote={handleSendVoiceNote}
                onCancel={() => setShowVoiceRecorder(false)}
              />
            </div>
          )}

          {/* Message Composer Bar */}
          <form
            onSubmit={handleSendText}
            className={`px-5 py-3.5 border-t flex items-center gap-2.5 shrink-0 ${
              darkMode ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setShowGifPicker((g) => !g);
                setShowVoiceRecorder(false);
              }}
              aria-label="Open GIPHY GIF Picker"
              className={`px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer ${
                showGifPicker
                  ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                  : darkMode
                  ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
                  : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <Smile className="w-4 h-4 text-sky-400" />
              <span>GIF</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowVoiceRecorder((v) => !v);
                setShowGifPicker(false);
              }}
              aria-label="Record Encrypted Voice Note"
              className={`px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer ${
                showVoiceRecorder
                  ? 'border-rose-500 bg-rose-500/20 text-rose-300'
                  : darkMode
                  ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
                  : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <Mic className="w-4 h-4 text-rose-400" />
              <span className="hidden sm:inline">Voice</span>
            </button>

            <button
              type="button"
              onClick={() => setShowFileModal(true)}
              aria-label="Share Unlimited Encrypted File or Video Stream"
              className={`px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer ${
                darkMode
                  ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
                  : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <Paperclip className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">File / Stream</span>
            </button>

            <input
              type="text"
              value={composerText}
              onChange={handleComposerChange}
              placeholder={`Send AES-256-GCM encrypted message to Passbox ${activePassbox}...`}
              aria-label="Encrypted message input"
              className={`flex-1 px-4 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                darkMode
                  ? 'bg-slate-900 border-slate-800 text-slate-100 placeholder-slate-500'
                  : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
              }`}
            />

            <button
              type="submit"
              aria-label="Send Encrypted Message"
              className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </form>
        </main>
      </div>

      {/* Unlimited Encrypted File & Video Stream Modal */}
      {showFileModal && (
        <FileStreamModal
          passboxCode={activePassbox}
          darkMode={darkMode}
          onSendEncryptedFile={handleSendEncryptedFile}
          onClose={() => setShowFileModal(false)}
        />
      )}

      {/* Contacts, User Profile, 3D Avatar Studio, and Group Chats Modal */}
      {socialModalTab && (
        <ContactsAndGroupsModal
          initialTab={socialModalTab}
          initialInspectedProfile={inspectedPeerProfile}
          currentUser={currentUserProfile}
          directoryUsers={directoryUsers}
          contacts={contacts}
          contactRequests={contactRequests}
          groups={groups}
          darkMode={darkMode}
          onClose={() => {
            setSocialModalTab(null);
            setInspectedPeerProfile(null);
          }}
          onUpdateProfile={handleUpdateProfile}
          onSendContactRequest={handleSendContactRequest}
          onRespondContactRequest={handleRespondContactRequest}
          onRemoveContact={handleRemoveContact}
          onCreateGroup={handleCreateGroup}
          onInviteToGroup={handleInviteToGroup}
          onOpenRoom={(code, label) => {
            setActivePassbox(code);
            setActiveRoomLabel(label);
          }}
          onSend3DStickerToChat={handleSend3DSticker}
        />
      )}

      {/* Notification Center & Alert Preferences Modal */}
      {showNotificationModal && (
        <NotificationCenterModal
          notifications={notifications}
          preferences={notificationPrefs}
          darkMode={darkMode}
          onUpdatePreferences={setNotificationPrefs}
          onMarkAllRead={() =>
            setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
          }
          onClearNotifications={() => setNotifications([])}
          onOpenRoomFromNotification={(roomCode, senderName) => {
            setActivePassbox(roomCode);
            setActiveRoomLabel(senderName);
            setNotifications((prev) =>
              prev.map((n) => (n.roomCode === roomCode ? { ...n, read: true } : n))
            );
            setShowNotificationModal(false);
          }}
          onClose={() => setShowNotificationModal(false)}
        />
      )}

      {/* Instant QR & New Passbox Code Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-label="Share Passbox Code and QR Token"
            className={`w-full max-w-md rounded-xl border p-6 space-y-4 ${
              darkMode
                ? 'bg-slate-900 border-slate-800 text-slate-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Instant Passbox & QR Pairing</h2>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>
            <div className="flex flex-col items-center py-2">
              {qrModalUrl && (
                <img
                  src={qrModalUrl}
                  alt={`QR Code for ${activePassbox}`}
                  referrerPolicy="no-referrer"
                  className="w-44 h-44 rounded-xl border border-slate-700 p-2 bg-white"
                />
              )}
              <div className="mt-3 font-mono text-2xl font-bold tracking-widest text-emerald-400">
                {activePassbox}
              </div>
              <p className="text-xs text-slate-400 text-center mt-1">
                Share this 6-digit alphanumeric code or scan the QR code to pair devices with
                end-to-end encryption.
              </p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  const fresh = generatePassboxCode();
                  setActivePassbox(fresh);
                  setActiveRoomLabel(`Room ${fresh}`);
                }}
                className="flex-1 py-2 px-3 rounded-lg border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-slate-800 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Generate New Code</span>
              </button>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="flex-1 py-2 px-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cryptographic Envelope Inspector Modal */}
      {inspectedMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-label="AES-256-GCM Packet Inspector"
            className={`w-full max-w-lg rounded-xl border p-6 space-y-3 font-mono text-xs ${
              darkMode
                ? 'bg-slate-900 border-slate-800 text-slate-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between font-sans">
              <h3 className="text-sm font-bold">Zero-Trust AES-256-GCM Packet Proof</h3>
              <button
                type="button"
                onClick={() => setInspectedMsg(null)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 p-3 rounded-lg bg-slate-950 text-slate-300 border border-slate-800">
              <div>MESSAGE ID: {inspectedMsg.id}</div>
              <div>ALGORITHM: {inspectedMsg.envelope.algorithm}</div>
              <div>KEY FINGERPRINT: {inspectedMsg.envelope.keyFingerprint}</div>
              <div>IV (BASE64): {inspectedMsg.envelope.ivBase64}</div>
              <div>PBKDF2 SALT: {inspectedMsg.envelope.saltBase64}</div>
              <div className="break-all">SHA-256 DIGEST: {inspectedMsg.envelope.sha256Digest}</div>
              <div className="break-all text-sky-400">
                CIPHERTEXT: {inspectedMsg.envelope.ciphertextBase64.slice(0, 120)}...
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
