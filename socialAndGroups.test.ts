import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeHandle,
  validateProfileInput,
  searchUsersDirectory,
  buildDefaultDirectoryUsers,
  shouldTriggerNotification,
  removeContactByUid,
  parseReadyPlayerMeMessage,
  computeExpressionMorphWeights,
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_AVATAR_3D,
  type ContactEntryRecord,
  type UserProfileRecord,
} from './socialAndGroups';

test('sanitizeHandle produces valid lowercase alphanumeric handles', () => {
  assert.equal(sanitizeHandle('Sunita Sutar!'), 'sunita_sutar');
  assert.equal(sanitizeHandle('a'), 'a_peer');
});

test('validateProfileInput enforces blueprint constraints on username, bio, and passbox', () => {
  const valid = validateProfileInput({
    username: 'Sunita Sutar',
    bio: 'End-to-End Encrypted Real-Time Chat',
    personalPassbox: '7x9k2m',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.normalizedHandle, 'sunita_sutar');
  assert.equal(valid.normalizedPassbox, '7X9K2M');

  const tooShort = validateProfileInput({ username: 'A' });
  assert.equal(tooShort.valid, false);
});

test('buildDefaultDirectoryUsers returns empty array with no fake or demo people and searchUsersDirectory filters real users', () => {
  const defaultDir = buildDefaultDirectoryUsers();
  assert.equal(defaultDir.length, 0);

  const realUsers: UserProfileRecord[] = [
    {
      uid: 'uid-real-1',
      username: 'Sunita Sutar',
      handle: 'sunita_sutar',
      avatarUrl: '',
      bio: 'Encrypted Peer 1',
      personalPassbox: '7X9K2M',
      keyFingerprint: 'FP1',
      avatar3D: DEFAULT_AVATAR_3D,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      uid: 'uid-real-2',
      username: 'Rohan Sharma',
      handle: 'rohan_sharma',
      avatarUrl: '',
      bio: 'Encrypted Peer 2',
      personalPassbox: '6H2J8R',
      keyFingerprint: 'FP2',
      avatar3D: DEFAULT_AVATAR_3D,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  const byHandle = searchUsersDirectory(realUsers, 'rohan_sharma');
  assert.equal(byHandle.length, 1);
  assert.equal(byHandle[0].username, 'Rohan Sharma');

  const byPassbox = searchUsersDirectory(realUsers, '6H2J8R');
  assert.equal(byPassbox.length, 1);
  assert.equal(byPassbox[0].username, 'Rohan Sharma');

  const excludeSelf = searchUsersDirectory(realUsers, '', 'uid-real-1');
  assert.equal(excludeSelf.length, 1);
  assert.equal(excludeSelf[0].uid, 'uid-real-2');
});

test('shouldTriggerNotification respects master toggle, Do Not Disturb, and per-channel settings', () => {
  assert.equal(shouldTriggerNotification(DEFAULT_NOTIFICATION_PREFS, 'message'), true);
  assert.equal(shouldTriggerNotification(DEFAULT_NOTIFICATION_PREFS, 'call'), true);

  const dndPrefs = { ...DEFAULT_NOTIFICATION_PREFS, doNotDisturb: true };
  assert.equal(shouldTriggerNotification(dndPrefs, 'call'), false);

  const mutedMessages = { ...DEFAULT_NOTIFICATION_PREFS, newMessages: false };
  assert.equal(shouldTriggerNotification(mutedMessages, 'message'), false);
  assert.equal(shouldTriggerNotification(mutedMessages, 'call'), true);
});

test('removeContactByUid removes the target contact cleanly', () => {
  const contacts: ContactEntryRecord[] = [
    {
      ownerUid: 'u1',
      contactUid: 'uid-real-1',
      username: 'Sunita Sutar',
      handle: 'sunita_sutar',
      avatarUrl: '',
      bio: 'Bio 1',
      roomPassbox: '7X9K2M',
      keyFingerprint: 'FP1',
      createdAt: '2026-01-01',
    },
    {
      ownerUid: 'u1',
      contactUid: 'uid-real-2',
      username: 'Rohan Sharma',
      handle: 'rohan_sharma',
      avatarUrl: '',
      bio: 'Bio 2',
      roomPassbox: '4P8W3Q',
      keyFingerprint: 'FP2',
      createdAt: '2026-01-01',
    },
  ];
  const afterRemove = removeContactByUid(contacts, 'uid-real-1');
  assert.equal(afterRemove.length, 1);
  assert.equal(afterRemove[0].contactUid, 'uid-real-2');
});

test('parseReadyPlayerMeMessage extracts v1.avatar.exported GLB URLs and v1.frame.ready events', () => {
  const readyRes = parseReadyPlayerMeMessage(
    JSON.stringify({ source: 'readyplayerme', eventName: 'v1.frame.ready' })
  );
  assert.equal(readyRes.type, 'frame-ready');

  const exportedRes = parseReadyPlayerMeMessage({
    source: 'readyplayerme',
    eventName: 'v1.avatar.exported',
    data: { url: 'https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb' },
  });
  assert.equal(exportedRes.type, 'avatar-exported');
  assert.equal(exportedRes.glbUrl, 'https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb');

  const ignored = parseReadyPlayerMeMessage({ source: 'other', eventName: 'v1.avatar.exported' });
  assert.equal(ignored.type, 'ignore');
});

test('computeExpressionMorphWeights maps Snapchat expressions and voice energy to GLTF morph targets', () => {
  const wink = computeExpressionMorphWeights('wink-star', 0);
  assert.equal(wink.eyeBlinkLeft, 1.0);
  assert.ok(wink.mouthSmile > 0.8);

  const laugh = computeExpressionMorphWeights('hype-laugh', 0.9);
  assert.ok(laugh.mouthOpen >= 0.88);
  assert.ok(laugh.jawOpen >= 0.88);

  const focus = computeExpressionMorphWeights('cyber-focus', 0.5);
  assert.ok(focus.browInnerUp > 0.6);
  assert.ok(focus.mouthOpen >= 0.35);
});
