import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  normalizePassboxCode,
  isValidPassboxCode,
  generatePassboxCode,
  deriveSessionFingerprint,
  toggleMessageReaction,
  type SyncableMessage,
} from './src/utils/cryptoEngine.ts';
import {
  sanitizeHandle,
  generateAvatarSvgDataUri,
  DEFAULT_AVATAR_3D,
  type UserProfileRecord,
  type ContactRequestRecord,
  type ContactEntryRecord,
  type GroupChatRecord,
} from './src/utils/socialAndGroups.ts';
import { CURATED_GIFS, GIPHY_API_KEY } from './src/utils/mediaAssets.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ConnectedClient {
  ws: WebSocket;
  clientId: string;
  senderName: string;
  roomCode: string;
  inCall: boolean;
  callMode?: 'video' | 'voice' | 'screen';
}

interface RoomState {
  roomCode: string;
  createdAt: number;
  messages: SyncableMessage[];
}

const rooms = new Map<string, RoomState>();
const clients = new Set<ConnectedClient>();

// Server-side state for real profiles, contacts, contact requests, and group chats (no demo/fake data)
const usersDirectory = new Map<string, UserProfileRecord>();
const contactRequests = new Map<string, ContactRequestRecord>();
const userContacts = new Map<string, ContactEntryRecord[]>();
const groupChats = new Map<string, GroupChatRecord>();

function getOrCreateRoom(rawCode: string): RoomState {
  const code = normalizePassboxCode(rawCode);
  const existing = rooms.get(code);
  if (existing) return existing;

  const state: RoomState = {
    roomCode: code,
    createdAt: Date.now(),
    messages: [],
  };
  rooms.set(code, state);
  return state;
}

function broadcastToRoom(roomCode: string, payload: unknown, excludeWs?: WebSocket) {
  const serialized = JSON.stringify(payload);
  for (const c of clients) {
    if (c.roomCode === roomCode && c.ws !== excludeWs && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(serialized);
    }
  }
}

function sendToUser(uid: string, payload: unknown) {
  const serialized = JSON.stringify(payload);
  for (const c of clients) {
    if (c.clientId === uid && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(serialized);
    }
  }
}

function getRoomPeers(roomCode: string) {
  const peerList: Array<{
    clientId: string;
    senderName: string;
    inCall: boolean;
    callMode?: string;
  }> = [];
  const seenIds = new Set<string>();
  for (const c of clients) {
    if (c.roomCode === roomCode && !seenIds.has(c.clientId)) {
      seenIds.add(c.clientId);
      peerList.push({
        clientId: c.clientId,
        senderName: c.senderName,
        inCall: c.inCall,
        callMode: c.callMode,
      });
    }
  }
  return peerList;
}

async function fetchFromGiphyApi(endpoint: 'trending' | 'search', queryText = '', limit = 12) {
  const apiKey =
    process.env.GIPHY_API_KEY && process.env.GIPHY_API_KEY !== 'MY_GIPHY_API_KEY'
      ? process.env.GIPHY_API_KEY
      : GIPHY_API_KEY;
  const url =
    endpoint === 'search' && queryText
      ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(queryText)}&limit=${limit}&rating=g`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(apiKey)}&limit=${limit}&rating=g`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2200);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const json = (await resp.json()) as {
        data?: Array<{
          id: string;
          title?: string;
          images?: {
            fixed_height_small?: { url?: string };
            fixed_height?: { url?: string };
          };
        }>;
      };
      if (Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map((item, idx) => {
          const fallback = CURATED_GIFS[idx % CURATED_GIFS.length];
          return {
            id: item.id || fallback.id,
            title: item.title || fallback.title,
            category: fallback.category,
            keywords: [...fallback.keywords, queryText.toLowerCase()].filter(Boolean),
            accentFrom: fallback.accentFrom,
            accentTo: fallback.accentTo,
            caption: 'GIPHY VERIFIED',
            motif: fallback.motif,
            giphyUrl:
              item.images?.fixed_height_small?.url ||
              item.images?.fixed_height?.url ||
              undefined,
            source: 'giphy-live',
          };
        });
      }
    }
  } catch {
    // Fallback to curated Giphy catalog if offline/sandboxed
  }

  const q = queryText.trim().toLowerCase();
  const base = CURATED_GIFS.map((g) => ({ ...g, source: 'giphy-curated' }));
  if (!q) return base;
  const filtered = base.filter(
    (g) =>
      g.title.toLowerCase().includes(q) ||
      g.caption.toLowerCase().includes(q) ||
      g.keywords.some((k) => k.includes(q))
  );
  return filtered.length > 0 ? filtered : base;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', activeRooms: rooms.size, realUsers: usersDirectory.size });
  });

  // GIPHY Proxy Endpoints
  app.get('/api/giphy/trending', async (req, res) => {
    const limit = Math.min(24, Number(req.query.limit) || 12);
    const gifs = await fetchFromGiphyApi('trending', '', limit);
    res.json({ provider: 'GIPHY', gifs });
  });

  app.get('/api/giphy/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(24, Number(req.query.limit) || 12);
    const gifs = await fetchFromGiphyApi('search', q, limit);
    res.json({ provider: 'GIPHY', query: q, gifs });
  });

  // Real User Profiles & Directory Search Endpoints
  app.get('/api/users', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const all = Array.from(usersDirectory.values());
    const results = !q
      ? all
      : all.filter(
          (u) =>
            u.username.toLowerCase().includes(q) ||
            u.handle.toLowerCase().includes(q) ||
            u.personalPassbox.toLowerCase().includes(q) ||
            u.bio.toLowerCase().includes(q)
        );
    res.json({ users: results });
  });

  app.get('/api/users/:uid', (req, res) => {
    const profile = usersDirectory.get(req.params.uid);
    if (!profile) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    res.json({ profile });
  });

  app.put('/api/users/:uid', (req, res) => {
    const uid = req.params.uid;
    const existing = usersDirectory.get(uid);
    const now = new Date().toISOString();
    const username = String(req.body?.username || existing?.username || '')
      .trim()
      .slice(0, 50);
    if (!username) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }
    const handle = sanitizeHandle(req.body?.handle || username);
    const bio = String(req.body?.bio ?? existing?.bio ?? '').trim().slice(0, 240);
    const personalPassbox = normalizePassboxCode(
      req.body?.personalPassbox || existing?.personalPassbox || '7X9K2M'
    );
    const validPassbox = isValidPassboxCode(personalPassbox) ? personalPassbox : '7X9K2M';
    const fp = deriveSessionFingerprint(validPassbox);
    const avatarUrl =
      typeof req.body?.avatarUrl === 'string' && req.body.avatarUrl.length > 0
        ? req.body.avatarUrl.slice(0, 65536)
        : existing?.avatarUrl || generateAvatarSvgDataUri(username, '#0284c7');

    const updated: UserProfileRecord = {
      uid,
      username,
      handle,
      avatarUrl,
      bio,
      personalPassbox: validPassbox,
      keyFingerprint: fp.hexFingerprint,
      avatarGlbUrl:
        typeof req.body?.avatarGlbUrl === 'string'
          ? req.body.avatarGlbUrl
          : req.body?.avatar3D?.avatarGlbUrl || existing?.avatarGlbUrl,
      avatar3D: req.body?.avatar3D || existing?.avatar3D || DEFAULT_AVATAR_3D,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    usersDirectory.set(uid, updated);
    res.json({ profile: updated });
  });

  // Real Contacts & Contact Requests Endpoints
  app.get('/api/contacts/:uid', (req, res) => {
    const uid = req.params.uid;
    const contacts = userContacts.get(uid) || [];
    const requests = Array.from(contactRequests.values()).filter(
      (r) => r.fromUid === uid || r.toUid === uid
    );
    res.json({ contacts, requests });
  });

  app.delete('/api/contacts/:uid/:contactUid', (req, res) => {
    const uid = req.params.uid;
    const contactUid = req.params.contactUid;
    const list = userContacts.get(uid) || [];
    const filtered = list.filter((c) => c.contactUid !== contactUid);
    userContacts.set(uid, filtered);
    res.json({ contacts: filtered });
  });

  app.post('/api/contact-requests', (req, res) => {
    const fromUid = String(req.body?.fromUid || '');
    const toUid = String(req.body?.toUid || '');
    const fromUser = usersDirectory.get(fromUid);
    const toUser = usersDirectory.get(toUid);
    if (!fromUser || !toUser) {
      res.status(404).json({ error: 'Sender or recipient user not found' });
      return;
    }

    const now = new Date().toISOString();
    const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record: ContactRequestRecord = {
      id: reqId,
      fromUid: fromUser.uid,
      fromUsername: fromUser.username,
      fromAvatarUrl: fromUser.avatarUrl,
      fromPassbox: fromUser.personalPassbox,
      toUid: toUser.uid,
      toUsername: toUser.username,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    contactRequests.set(reqId, record);

    // Notify real recipient over WebSocket if connected
    sendToUser(toUser.uid, {
      type: 'contact:request',
      request: record,
    });

    res.json({ request: record });
  });

  app.post('/api/contact-requests/:id/respond', (req, res) => {
    const reqId = req.params.id;
    const action = req.body?.status === 'declined' ? 'declined' : 'accepted';
    const existing = contactRequests.get(reqId);
    if (!existing) {
      res.status(404).json({ error: 'Contact request not found' });
      return;
    }
    const now = new Date().toISOString();
    existing.status = action;
    existing.updatedAt = now;
    contactRequests.set(reqId, existing);

    if (action === 'accepted') {
      const fromProfile = usersDirectory.get(existing.fromUid);
      const toProfile = usersDirectory.get(existing.toUid);
      if (fromProfile && toProfile) {
        // Mutual contact entry for recipient (toUid)
        const toList = userContacts.get(toProfile.uid) || [];
        if (!toList.some((c) => c.contactUid === fromProfile.uid)) {
          toList.push({
            ownerUid: toProfile.uid,
            contactUid: fromProfile.uid,
            username: fromProfile.username,
            handle: fromProfile.handle,
            avatarUrl: fromProfile.avatarUrl,
            bio: fromProfile.bio,
            roomPassbox: fromProfile.personalPassbox,
            keyFingerprint: fromProfile.keyFingerprint,
            avatar3D: fromProfile.avatar3D,
            createdAt: now,
          });
          userContacts.set(toProfile.uid, toList);
        }

        // Mutual contact entry for sender (fromUid)
        const fromList = userContacts.get(fromProfile.uid) || [];
        if (!fromList.some((c) => c.contactUid === toProfile.uid)) {
          fromList.push({
            ownerUid: fromProfile.uid,
            contactUid: toProfile.uid,
            username: toProfile.username,
            handle: toProfile.handle,
            avatarUrl: toProfile.avatarUrl,
            bio: toProfile.bio,
            roomPassbox: fromProfile.personalPassbox,
            keyFingerprint: toProfile.keyFingerprint,
            avatar3D: toProfile.avatar3D,
            createdAt: now,
          });
          userContacts.set(fromProfile.uid, fromList);
        }
      }
    }

    res.json({
      request: existing,
      contacts: userContacts.get(existing.toUid) || [],
    });
  });

  // Group Chats Endpoints
  app.get('/api/groups', (req, res) => {
    const uid = String(req.query.uid || '');
    const allGroups = Array.from(groupChats.values());
    const filtered = uid ? allGroups.filter((g) => g.memberUids.includes(uid)) : allGroups;
    res.json({ groups: filtered });
  });

  app.post('/api/groups', async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (name.length < 2) {
      res.status(400).json({ error: 'Group name must be at least 2 characters.' });
      return;
    }
    const description = String(req.body?.description || 'End-to-end encrypted group room')
      .trim()
      .slice(0, 240);
    const creatorUid = String(req.body?.creatorUid || '');
    const creatorProfile = usersDirectory.get(creatorUid);
    if (!creatorProfile) {
      res.status(400).json({ error: 'Creator user profile must be registered first.' });
      return;
    }
    const invitedUids: string[] = Array.isArray(req.body?.memberUids) ? req.body.memberUids : [];
    const passboxCode = isValidPassboxCode(normalizePassboxCode(req.body?.passboxCode || ''))
      ? normalizePassboxCode(req.body.passboxCode)
      : generatePassboxCode();

    const uniqueMemberUids = Array.from(new Set([creatorProfile.uid, ...invitedUids]));
    const members = uniqueMemberUids.map((uid) => {
      const u = usersDirectory.get(uid) || creatorProfile;
      return {
        memberUid: u.uid,
        username: u.username,
        avatarUrl: u.avatarUrl,
        role: (u.uid === creatorProfile.uid ? 'owner' : 'member') as 'owner' | 'member',
      };
    });

    const now = new Date().toISOString();
    const groupId = `grp-${Date.now().toString(36)}`;
    const group: GroupChatRecord = {
      groupId,
      name,
      description,
      passboxCode,
      creatorUid: creatorProfile.uid,
      memberUids: uniqueMemberUids,
      members,
      createdAt: now,
      updatedAt: now,
    };
    groupChats.set(groupId, group);
    getOrCreateRoom(passboxCode);

    res.json({ group });
  });

  app.post('/api/groups/:groupId/invite', (req, res) => {
    const group = groupChats.get(req.params.groupId);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const memberUid = String(req.body?.memberUid || '');
    const targetUser = usersDirectory.get(memberUid);
    if (!targetUser) {
      res.status(404).json({ error: 'Invited user not found' });
      return;
    }
    if (!group.memberUids.includes(targetUser.uid)) {
      group.memberUids.push(targetUser.uid);
      group.members.push({
        memberUid: targetUser.uid,
        username: targetUser.username,
        avatarUrl: targetUser.avatarUrl,
        role: 'member',
      });
      group.updatedAt = new Date().toISOString();
    }
    res.json({ group });
  });

  // Rooms & Sync Endpoints (Pure Real-Time Human Messages — No Bot/Demo Seeding)
  app.get('/api/rooms/:code', (req, res) => {
    const code = normalizePassboxCode(req.params.code || '');
    if (!isValidPassboxCode(code)) {
      res.status(400).json({ error: 'Invalid 6-character alphanumeric passbox code' });
      return;
    }
    const room = getOrCreateRoom(code);
    res.json({
      roomCode: room.roomCode,
      messages: room.messages,
      peers: getRoomPeers(code),
    });
  });

  app.post('/api/rooms/:code/sync', (req, res) => {
    const code = normalizePassboxCode(req.params.code || '');
    if (!isValidPassboxCode(code)) {
      res.status(400).json({ error: 'Invalid passbox code' });
      return;
    }
    const room = getOrCreateRoom(code);
    const incoming: SyncableMessage[] = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const existingIds = new Set(room.messages.map((m) => m.id));

    const newlyAdded: SyncableMessage[] = [];
    for (const msg of incoming) {
      if (msg && msg.id && !existingIds.has(msg.id)) {
        const syncedMsg: SyncableMessage = { ...msg, roomCode: code, syncStatus: 'synced' };
        room.messages.push(syncedMsg);
        existingIds.add(msg.id);
        newlyAdded.push(syncedMsg);
      }
    }
    room.messages.sort((a, b) => a.timestamp - b.timestamp);

    for (const msg of newlyAdded) {
      broadcastToRoom(code, { type: 'message:created', message: msg });
    }

    res.json({
      roomCode: room.roomCode,
      messages: room.messages,
      syncedCount: newlyAdded.length,
    });
  });

  // Toggle an emoji reaction on a specific message and sync across all connected peers
  app.post('/api/rooms/:code/messages/:messageId/react', (req, res) => {
    const code = normalizePassboxCode(req.params.code || '');
    if (!isValidPassboxCode(code)) {
      res.status(400).json({ error: 'Invalid passbox code' });
      return;
    }
    const emoji = String(req.body?.emoji || '').trim();
    const userId = String(req.body?.userId || '').trim();
    if (!emoji || !userId) {
      res.status(400).json({ error: 'emoji and userId are required' });
      return;
    }
    const room = getOrCreateRoom(code);
    const msg = room.messages.find((m) => m.id === req.params.messageId);
    if (!msg) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    msg.reactions = toggleMessageReaction(msg.reactions, emoji, userId);
    broadcastToRoom(code, {
      type: 'message:updated',
      message: msg,
    });
    res.json({ message: msg });
  });

  // Broadcast typing indicator status across room peers
  app.post('/api/rooms/:code/typing', (req, res) => {
    const code = normalizePassboxCode(req.params.code || '');
    if (!isValidPassboxCode(code)) {
      res.status(400).json({ error: 'Invalid passbox code' });
      return;
    }
    const userId = String(req.body?.userId || '').trim();
    const username = String(req.body?.username || '').trim();
    const isTyping = Boolean(req.body?.isTyping);
    if (userId && username) {
      broadcastToRoom(code, {
        type: 'typing:status',
        roomCode: code,
        userId,
        username,
        isTyping,
      });
    }
    res.json({ ok: true });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const clientRecord: ConnectedClient = {
      ws,
      clientId: `client-${Math.random().toString(36).slice(2, 9)}`,
      senderName: '',
      roomCode: '',
      inCall: false,
    };
    clients.add(clientRecord);

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'room:join') {
          const code = normalizePassboxCode(data.roomCode || '');
          if (!isValidPassboxCode(code)) return;

          const prevRoom = clientRecord.roomCode;
          clientRecord.roomCode = code;
          if (data.senderName) clientRecord.senderName = String(data.senderName).slice(0, 50);
          if (data.clientId) clientRecord.clientId = String(data.clientId);

          // Automatically register real connected human in usersDirectory if they have a name & uid
          if (clientRecord.clientId && clientRecord.senderName) {
            const existing = usersDirectory.get(clientRecord.clientId);
            if (!existing) {
              const now = new Date().toISOString();
              const fp = deriveSessionFingerprint(code);
              usersDirectory.set(clientRecord.clientId, {
                uid: clientRecord.clientId,
                username: clientRecord.senderName,
                handle: sanitizeHandle(clientRecord.senderName),
                avatarUrl: generateAvatarSvgDataUri(clientRecord.senderName, '#0284c7'),
                bio: '',
                personalPassbox: code,
                keyFingerprint: fp.hexFingerprint,
                avatar3D: DEFAULT_AVATAR_3D,
                createdAt: now,
                updatedAt: now,
              });
            }
          }

          if (prevRoom && prevRoom !== code) {
            broadcastToRoom(prevRoom, {
              type: 'presence:update',
              peers: getRoomPeers(prevRoom),
            });
          }

          const room = getOrCreateRoom(code);
          ws.send(
            JSON.stringify({
              type: 'room:init',
              roomCode: code,
              messages: room.messages,
              peers: getRoomPeers(code),
            })
          );

          broadcastToRoom(code, {
            type: 'presence:update',
            peers: getRoomPeers(code),
          });
        } else if (data.type === 'message:send') {
          const msg = data.message as SyncableMessage;
          if (!msg || !msg.id || !clientRecord.roomCode) return;

          const room = getOrCreateRoom(clientRecord.roomCode);
          const exists = room.messages.some((m) => m.id === msg.id);
          const storedMsg: SyncableMessage = {
            ...msg,
            roomCode: clientRecord.roomCode,
            syncStatus: 'synced',
          };
          if (!exists) {
            room.messages.push(storedMsg);
            room.messages.sort((a, b) => a.timestamp - b.timestamp);
          }

          broadcastToRoom(clientRecord.roomCode, {
            type: 'message:created',
            message: storedMsg,
          });
          // Clear typing status immediately when message is sent
          broadcastToRoom(clientRecord.roomCode, {
            type: 'typing:status',
            roomCode: clientRecord.roomCode,
            userId: storedMsg.senderId || clientRecord.clientId,
            username: storedMsg.senderName || clientRecord.senderName,
            isTyping: false,
          });
        } else if (data.type === 'message:react') {
          const roomCode = normalizePassboxCode(data.roomCode || clientRecord.roomCode || '');
          const messageId = String(data.messageId || '');
          const emoji = String(data.emoji || '').trim();
          const userId = String(data.userId || clientRecord.clientId || '').trim();
          if (!roomCode || !messageId || !emoji || !userId) return;

          const room = getOrCreateRoom(roomCode);
          const msg = room.messages.find((m) => m.id === messageId);
          if (msg) {
            msg.reactions = toggleMessageReaction(msg.reactions, emoji, userId);
            broadcastToRoom(roomCode, {
              type: 'message:updated',
              message: msg,
            });
          }
        } else if (data.type === 'typing:update') {
          const roomCode = normalizePassboxCode(data.roomCode || clientRecord.roomCode || '');
          const userId = String(data.userId || clientRecord.clientId || '').trim();
          const username = String(data.username || clientRecord.senderName || '').trim();
          const isTyping = Boolean(data.isTyping);
          if (roomCode && userId && username) {
            broadcastToRoom(
              roomCode,
              {
                type: 'typing:status',
                roomCode,
                userId,
                username,
                isTyping,
              },
              ws
            );
          }
        } else if (data.type === 'sync:batch') {
          if (!clientRecord.roomCode) return;
          const room = getOrCreateRoom(clientRecord.roomCode);
          const batch: SyncableMessage[] = Array.isArray(data.messages) ? data.messages : [];
          const existingIds = new Set(room.messages.map((m) => m.id));

          for (const msg of batch) {
            if (msg && msg.id && !existingIds.has(msg.id)) {
              const syncedMsg: SyncableMessage = {
                ...msg,
                roomCode: clientRecord.roomCode,
                syncStatus: 'synced',
              };
              room.messages.push(syncedMsg);
              existingIds.add(msg.id);
              broadcastToRoom(clientRecord.roomCode, {
                type: 'message:created',
                message: syncedMsg,
              });
            }
          }
          room.messages.sort((a, b) => a.timestamp - b.timestamp);
          ws.send(
            JSON.stringify({
              type: 'room:init',
              roomCode: clientRecord.roomCode,
              messages: room.messages,
              peers: getRoomPeers(clientRecord.roomCode),
            })
          );
        } else if (data.type === 'call:state') {
          const wasInCall = clientRecord.inCall;
          clientRecord.inCall = Boolean(data.inCall);
          clientRecord.callMode = data.callMode;
          if (clientRecord.roomCode) {
            broadcastToRoom(clientRecord.roomCode, {
              type: 'presence:update',
              peers: getRoomPeers(clientRecord.roomCode),
            });
            if (!wasInCall && clientRecord.inCall) {
              broadcastToRoom(
                clientRecord.roomCode,
                {
                  type: 'call:incoming',
                  roomCode: clientRecord.roomCode,
                  callerName: clientRecord.senderName || 'Connected Peer',
                  callMode: clientRecord.callMode || 'video',
                },
                ws
              );
            }
          }
        } else if (
          data.type === 'webrtc:offer' ||
          data.type === 'webrtc:answer' ||
          data.type === 'webrtc:ice-candidate' ||
          data.type === 'webrtc:hangup'
        ) {
          const roomCode = normalizePassboxCode(data.roomCode || clientRecord.roomCode || '');
          if (roomCode) {
            broadcastToRoom(
              roomCode,
              {
                ...data,
                roomCode,
                fromClientId: clientRecord.clientId,
                fromName: clientRecord.senderName || 'Encrypted Peer',
              },
              ws
            );
          }
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      const prevRoom = clientRecord.roomCode;
      clients.delete(clientRecord);
      if (prevRoom) {
        broadcastToRoom(prevRoom, {
          type: 'presence:update',
          peers: getRoomPeers(prevRoom),
        });
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CipherLink E2EE Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
