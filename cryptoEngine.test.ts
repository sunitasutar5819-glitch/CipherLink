import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePassboxCode,
  isValidPassboxCode,
  generatePassboxCode,
  deriveSessionFingerprint,
  encryptPayload,
  decryptPayload,
  encryptFileInChunks,
  reconcileOfflineQueue,
  toggleMessageReaction,
  filterMessagesBySearchQuery,
  formatTypingStatusText,
  formatBytes,
  type SyncableMessage,
} from './cryptoEngine';

test('Passbox code normalization and validation enforce 6 alphanumeric characters', () => {
  assert.equal(normalizePassboxCode('ab-12 c9!'), 'AB12C9');
  assert.equal(isValidPassboxCode('AB12C9'), true);
  assert.equal(isValidPassboxCode('AB12'), false);
  assert.equal(isValidPassboxCode('ab12c9'), false);

  const generated = generatePassboxCode();
  assert.equal(generated.length, 6);
  assert.equal(isValidPassboxCode(generated), true);
});

test('Session fingerprint derivation is deterministic for identical 6-digit passbox codes', () => {
  const fpA = deriveSessionFingerprint('7X9K2M');
  const fpB = deriveSessionFingerprint('7x9k2m');
  const fpOther = deriveSessionFingerprint('4P8W3Q');

  assert.equal(fpA.hexFingerprint, fpB.hexFingerprint);
  assert.deepEqual(fpA.sasBlocks, fpB.sasBlocks);
  assert.notEqual(fpA.hexFingerprint, fpOther.hexFingerprint);
  assert.equal(fpA.sasBlocks.length, 4);
});

test('AES-256-GCM payload encryption and decryption round-trip succeeds and rejects wrong passbox', async () => {
  const passbox = '9K4L2P';
  const secretMessage = 'Verify zero-knowledge E2EE stream at 02:30 UTC.';
  const envelope = await encryptPayload(secretMessage, passbox);

  assert.equal(envelope.algorithm, 'AES-256-GCM');
  assert.ok(envelope.ciphertextBase64.length > 0);
  assert.ok(envelope.sha256Digest.length >= 32);

  const decrypted = await decryptPayload(envelope, passbox);
  assert.equal(decrypted, secretMessage);

  await assert.rejects(async () => {
    await decryptPayload(envelope, 'WRONG1');
  });
});

test('Unlimited-size chunked file encryption computes chunks and integrity digests accurately', async () => {
  const passbox = '8M3N5R';
  const sample = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
  // Simulate a 4.5 GB 4K raw video file with no size limit
  const fourPointFiveGb = 4.5 * 1024 * 1024 * 1024;
  const result = await encryptFileInChunks(
    'satellite_telemetry_raw_4k.mp4',
    'video/mp4',
    fourPointFiveGb,
    sample,
    passbox,
    1024 * 1024 // 1 MB chunks
  );

  assert.equal(result.originalSize, fourPointFiveGb);
  assert.equal(result.totalChunks, 4608);
  assert.equal(result.encryptedSize, fourPointFiveGb + 4608 * 16);
  assert.equal(result.chunks.length, 8);
  assert.equal(formatBytes(fourPointFiveGb), '4.50 GB');
});

test('Offline sync queue reconciliation merges and deduplicates messages idempotently', async () => {
  const env = await encryptPayload('Offline test', '7X9K2M');
  const existing: SyncableMessage[] = [
    {
      id: 'msg-1',
      roomCode: '7X9K2M',
      senderId: 'u1',
      senderName: 'Alex',
      timestamp: 1000,
      kind: 'text',
      text: 'First message',
      envelope: env,
      syncStatus: 'synced',
    },
    {
      id: 'msg-2',
      roomCode: '7X9K2M',
      senderId: 'u1',
      senderName: 'Alex',
      timestamp: 2000,
      kind: 'text',
      text: 'Queued while offline',
      envelope: env,
      syncStatus: 'queued-offline',
    },
  ];

  const serverAckAndNew: SyncableMessage[] = [
    {
      id: 'msg-2',
      roomCode: '7X9K2M',
      senderId: 'u1',
      senderName: 'Alex',
      timestamp: 2000,
      kind: 'text',
      text: 'Queued while offline',
      envelope: env,
      syncStatus: 'synced',
    },
    {
      id: 'msg-3',
      roomCode: '7X9K2M',
      senderId: 'u2',
      senderName: 'Elena',
      timestamp: 1500,
      kind: 'text',
      text: 'Sent while peer was offline',
      envelope: env,
      syncStatus: 'synced',
    },
  ];

  const merged = reconcileOfflineQueue(existing, serverAckAndNew);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((m) => m.id), ['msg-1', 'msg-3', 'msg-2']);
  assert.equal(merged.find((m) => m.id === 'msg-2')?.syncStatus, 'synced');
});

test('toggleMessageReaction adds, toggles off, and syncs multiple user emoji reactions cleanly', () => {
  let reactions = toggleMessageReaction(undefined, '❤️', 'user-1');
  assert.deepEqual(reactions, { '❤️': ['user-1'] });

  reactions = toggleMessageReaction(reactions, '❤️', 'user-2');
  assert.deepEqual(reactions, { '❤️': ['user-1', 'user-2'] });

  reactions = toggleMessageReaction(reactions, '👍', 'user-1');
  assert.deepEqual(reactions, { '❤️': ['user-1', 'user-2'], '👍': ['user-1'] });

  // Toggling off user-1 on 👍 removes the 👍 key completely
  reactions = toggleMessageReaction(reactions, '👍', 'user-1');
  assert.deepEqual(reactions, { '❤️': ['user-1', 'user-2'] });
});

test('filterMessagesBySearchQuery filters room messages by text, GIF title, file name, or sender', async () => {
  const env = await encryptPayload('Search test', '7X9K2M');
  const messages: SyncableMessage[] = [
    {
      id: 'm1',
      roomCode: '7X9K2M',
      senderId: 'u1',
      senderName: 'Sunita',
      timestamp: 1000,
      kind: 'text',
      text: 'Zero-knowledge handshake verified',
      envelope: env,
    },
    {
      id: 'm2',
      roomCode: '7X9K2M',
      senderId: 'u2',
      senderName: 'Rohan',
      timestamp: 2000,
      kind: 'gif',
      gifTitle: 'Celebration Dance',
      envelope: env,
    },
  ];

  assert.equal(filterMessagesBySearchQuery(messages, '').length, 2);
  assert.equal(filterMessagesBySearchQuery(messages, 'handshake').length, 1);
  assert.equal(filterMessagesBySearchQuery(messages, 'dance')[0].id, 'm2');
  assert.equal(filterMessagesBySearchQuery(messages, 'nonexistent').length, 0);
});

test('formatTypingStatusText formats single and multiple typing peers while excluding current user', () => {
  assert.equal(
    formatTypingStatusText([{ userId: 'me', username: 'Me' }], 'me'),
    ''
  );
  assert.equal(
    formatTypingStatusText(
      [
        { userId: 'me', username: 'Me' },
        { userId: 'u2', username: 'Rohan' },
      ],
      'me'
    ),
    'Rohan is typing...'
  );
  assert.equal(
    formatTypingStatusText(
      [
        { userId: 'u2', username: 'Rohan' },
        { userId: 'u3', username: 'Priya' },
      ],
      'me'
    ),
    'Rohan, Priya are typing...'
  );
});
