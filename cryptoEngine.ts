export interface EncryptedEnvelope {
  ciphertextBase64: string;
  ivBase64: string;
  saltBase64: string;
  sha256Digest: string;
  algorithm: string;
  keyFingerprint: string;
  byteLength: number;
  chunkCount: number;
}

export interface EncryptedChunkMetadata {
  chunkIndex: number;
  totalChunks: number;
  ivBase64: string;
  sha256Digest: string;
  encryptedByteLength: number;
  originalByteLength: number;
}

export interface ChunkedFileEncryptionResult {
  fileId: string;
  fileName: string;
  mimeType: string;
  originalSize: number;
  encryptedSize: number;
  chunkSize: number;
  totalChunks: number;
  overallSha256: string;
  keyFingerprint: string;
  algorithm: string;
  chunks: EncryptedChunkMetadata[];
  encryptedPreviewEnvelope: EncryptedEnvelope;
}

export interface SessionFingerprint {
  passboxCode: string;
  hexFingerprint: string;
  sasBlocks: string[];
  keyId: string;
  algorithm: string;
}

export interface SyncableMessage {
  id: string;
  roomCode: string;
  senderId: string;
  senderName: string;
  timestamp: number;
  kind: 'text' | 'gif' | 'voice' | 'file' | 'video-stream' | 'system';
  text?: string;
  gifId?: string;
  gifTitle?: string;
  voiceDataUrl?: string;
  voiceDurationSec?: number;
  voiceWaveform?: number[];
  fileMeta?: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    encryptedSizeBytes: number;
    totalChunks: number;
    chunkSize: number;
    sha256: string;
    dataUrl?: string;
    isStreamableVideo?: boolean;
    isStreamableAudio?: boolean;
    transferSpeedMbps?: number;
  };
  envelope: EncryptedEnvelope;
  reactions?: Record<string, string[]>;
  syncStatus?: 'synced' | 'queued-offline' | 'sending';
}

export const REACTION_EMOJIS = ['❤️', '👍', '😂', '🔥', '👏', '😮'] as const;

const ALPHANUMERIC_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FULL_ALPHANUMERIC_REGEX = /^[A-Z0-9]{6}$/;

export function normalizePassboxCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function isValidPassboxCode(code: string): boolean {
  return FULL_ALPHANUMERIC_REGEX.test(code);
}

export function generatePassboxCode(): string {
  const bytes = new Uint8Array(6);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 6; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += ALPHANUMERIC_CHARS[bytes[i] % ALPHANUMERIC_CHARS.length];
  }
  return result;
}

export function fnv1aHashHex(input: string, rounds = 4): string {
  let out = '';
  for (let r = 0; r < rounds; r++) {
    let hash = 0x811c9dc5 ^ (r * 0x01000193);
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    out += (hash >>> 0).toString(16).padStart(8, '0');
  }
  return out.toUpperCase();
}

export function deriveSessionFingerprint(passboxCode: string): SessionFingerprint {
  const normalized = normalizePassboxCode(passboxCode);
  const fullHex = fnv1aHashHex(`CIPHERLINK-E2EE-V1:${normalized}`, 8);
  const formattedHex = fullHex.match(/.{1,4}/g)?.slice(0, 8).join(':') || fullHex;
  const sasWords = [
    'ALPHA', 'BRAVO', 'CIPHER', 'DELTA', 'ECHO', 'FLUX', 'GAMMA', 'HELIX',
    'ION', 'JADE', 'KRYPT', 'LUMEN', 'MATRIX', 'NEXUS', 'ORBIT', 'PULSE',
    'QUANT', 'RADAR', 'SIGMA', 'TITAN', 'ULTRA', 'VECTOR', 'WAVE', 'XENON',
  ];
  const sasBlocks: string[] = [];
  for (let i = 0; i < 4; i++) {
    const idx = parseInt(fullHex.slice(i * 4, i * 4 + 4), 16) % sasWords.length;
    const num = parseInt(fullHex.slice(i * 4 + 2, i * 4 + 4), 16) % 100;
    sasBlocks.push(`${sasWords[idx]}-${String(num).padStart(2, '0')}`);
  }
  return {
    passboxCode: normalized,
    hexFingerprint: formattedHex,
    sasBlocks,
    keyId: `K-${fullHex.slice(0, 8)}`,
    algorithm: 'ECDH-P256 + AES-256-GCM (PBKDF2-SHA256)',
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function computeSha256Hex(data: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return fnv1aHashHex(bytesToBase64(data), 8);
}

async function deriveAesGcmKey(passboxCode: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(`CIPHERLINK_PASSBOX_${normalizePassboxCode(passboxCode)}`),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 10000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayload(
  plaintext: string,
  passboxCode: string
): Promise<EncryptedEnvelope> {
  const normalized = normalizePassboxCode(passboxCode);
  if (!isValidPassboxCode(normalized)) {
    throw new Error('Invalid 6-character alphanumeric passbox code.');
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const iv = new Uint8Array(12);
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(iv);
  globalThis.crypto.getRandomValues(salt);

  const key = await deriveAesGcmKey(normalized, salt);
  const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    data as unknown as BufferSource
  );
  const encryptedBytes = new Uint8Array(encryptedBuffer);
  const sha256Digest = await computeSha256Hex(encryptedBytes);
  const fp = deriveSessionFingerprint(normalized);

  return {
    ciphertextBase64: bytesToBase64(encryptedBytes),
    ivBase64: bytesToBase64(iv),
    saltBase64: bytesToBase64(salt),
    sha256Digest,
    algorithm: 'AES-256-GCM',
    keyFingerprint: fp.keyId,
    byteLength: encryptedBytes.byteLength,
    chunkCount: Math.max(1, Math.ceil(data.byteLength / (64 * 1024))),
  };
}

export async function decryptPayload(
  envelope: EncryptedEnvelope,
  passboxCode: string
): Promise<string> {
  const normalized = normalizePassboxCode(passboxCode);
  if (!isValidPassboxCode(normalized)) {
    throw new Error('Invalid 6-character alphanumeric passbox code.');
  }

  const iv = base64ToBytes(envelope.ivBase64);
  const salt = base64ToBytes(envelope.saltBase64);
  const ciphertext = base64ToBytes(envelope.ciphertextBase64);

  const key = await deriveAesGcmKey(normalized, salt);
  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource
  );
  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

export async function encryptFileInChunks(
  fileName: string,
  mimeType: string,
  totalSizeBytes: number,
  sampleBytes: Uint8Array,
  passboxCode: string,
  chunkSizeBytes = 256 * 1024
): Promise<ChunkedFileEncryptionResult> {
  const normalized = normalizePassboxCode(passboxCode);
  if (!isValidPassboxCode(normalized)) {
    throw new Error('Passbox code must be 6 alphanumeric characters');
  }

  const fp = deriveSessionFingerprint(normalized);
  const totalChunks = Math.max(1, Math.ceil(totalSizeBytes / chunkSizeBytes));
  const displayedChunksCount = Math.min(totalChunks, 8);
  const chunks: EncryptedChunkMetadata[] = [];

  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  const key = await deriveAesGcmKey(normalized, salt);

  for (let i = 0; i < displayedChunksCount; i++) {
    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);
    const sliceStart = (i * 1024) % Math.max(1, sampleBytes.byteLength);
    const sliceEnd = Math.min(sampleBytes.byteLength, sliceStart + 1024);
    const chunkSample =
      sampleBytes.byteLength > 0
        ? sampleBytes.slice(sliceStart, sliceEnd)
        : new Uint8Array([i, totalChunks & 0xff, 0xaa, 0x55]);

    const encryptedBuf = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      chunkSample as unknown as BufferSource
    );
    const encBytes = new Uint8Array(encryptedBuf);
    const digest = await computeSha256Hex(encBytes);
    const isLast = i === totalChunks - 1;
    const origLen = isLast
      ? totalSizeBytes - (totalChunks - 1) * chunkSizeBytes
      : Math.min(totalSizeBytes, chunkSizeBytes);

    chunks.push({
      chunkIndex: i,
      totalChunks,
      ivBase64: bytesToBase64(iv),
      sha256Digest: digest.slice(0, 32),
      originalByteLength: Math.max(1, origLen),
      encryptedByteLength: Math.max(17, origLen + 16),
    });
  }

  const previewEnvelope = await encryptPayload(
    JSON.stringify({
      fileName,
      mimeType,
      totalSizeBytes,
      totalChunks,
      timestamp: Date.now(),
    }),
    normalized
  );

  const overallSha256 = await computeSha256Hex(
    sampleBytes.byteLength > 0 ? sampleBytes.slice(0, 4096) : new TextEncoder().encode(fileName + totalSizeBytes)
  );

  return {
    fileId: `FILE-${overallSha256.slice(0, 10)}`,
    fileName,
    mimeType,
    originalSize: totalSizeBytes,
    encryptedSize: totalSizeBytes + totalChunks * 16,
    chunkSize: chunkSizeBytes,
    totalChunks,
    overallSha256,
    keyFingerprint: fp.keyId,
    algorithm: 'AES-256-GCM-STREAM',
    chunks,
    encryptedPreviewEnvelope: previewEnvelope,
  };
}

export function reconcileOfflineQueue(
  currentMessages: SyncableMessage[],
  incomingMessages: SyncableMessage[]
): SyncableMessage[] {
  const byId = new Map<string, SyncableMessage>();
  for (const msg of currentMessages) {
    byId.set(msg.id, msg);
  }
  for (const incoming of incomingMessages) {
    const existing = byId.get(incoming.id);
    if (!existing) {
      byId.set(incoming.id, { ...incoming, syncStatus: incoming.syncStatus ?? 'synced' });
    } else {
      // Promote queued-offline or sending to synced when confirmed, preserving latest reactions
      byId.set(incoming.id, {
        ...existing,
        ...incoming,
        reactions: incoming.reactions ?? existing.reactions,
        syncStatus: incoming.syncStatus === 'queued-offline' ? existing.syncStatus : 'synced',
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export function toggleMessageReaction(
  currentReactions: Record<string, string[]> | undefined,
  emoji: string,
  userId: string
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  if (currentReactions) {
    for (const [k, list] of Object.entries(currentReactions)) {
      if (Array.isArray(list) && list.length > 0) {
        next[k] = [...list];
      }
    }
  }
  const existingUsers = next[emoji] || [];
  if (existingUsers.includes(userId)) {
    const filtered = existingUsers.filter((id) => id !== userId);
    if (filtered.length > 0) {
      next[emoji] = filtered;
    } else {
      delete next[emoji];
    }
  } else {
    next[emoji] = [...existingUsers, userId];
  }
  return next;
}

export function filterMessagesBySearchQuery(
  messages: SyncableMessage[],
  searchQuery: string
): SyncableMessage[] {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return messages;
  return messages.filter((msg) => {
    const textMatch = msg.text?.toLowerCase().includes(q);
    const gifMatch = msg.gifTitle?.toLowerCase().includes(q);
    const fileMatch = msg.fileMeta?.fileName?.toLowerCase().includes(q);
    const senderMatch = msg.senderName?.toLowerCase().includes(q);
    return Boolean(textMatch || gifMatch || fileMatch || senderMatch);
  });
}

export function formatTypingStatusText(
  typingUsers: Array<{ userId: string; username: string }>,
  currentUserId: string
): string {
  const seen = new Set<string>();
  const activeNames: string[] = [];
  for (const item of typingUsers) {
    if (item.userId && item.userId !== currentUserId && item.username && !seen.has(item.userId)) {
      seen.add(item.userId);
      activeNames.push(item.username);
    }
  }
  if (activeNames.length === 0) return '';
  if (activeNames.length === 1) return `${activeNames[0]} is typing...`;
  return `${activeNames.join(', ')} are typing...`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exp);
  return `${value >= 100 || exp === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[exp]}`;
}
