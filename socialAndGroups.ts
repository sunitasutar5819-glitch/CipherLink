import {
  normalizePassboxCode,
  isValidPassboxCode,
  generatePassboxCode,
} from './cryptoEngine';

export interface Avatar3DConfig {
  skinTone: string;
  hairStyle: 'cyber-spiky' | 'sleek-wave' | 'curly-crown' | 'minimal-dome';
  hairColor: string;
  accessory: 'cyber-visor' | 'aviator-shades' | 'gold-crown' | 'studio-headphones' | 'none';
  expression: 'chill-smile' | 'wink-star' | 'cyber-focus' | 'hype-laugh';
  outfitColor: string;
  bgAura: string;
  avatarGlbUrl?: string;
  eyeColor?: string;
  beardStyle?: 'sculpted' | 'clean';
  cameraFraming?: 'bust' | 'waist' | 'full';
  studioMode?: 'three-gltf' | 'rpm-creator';
}

export interface NotificationPreferences {
  enabled: boolean;
  newMessages: boolean;
  incomingCalls: boolean;
  contactRequests: boolean;
  backgroundAlerts: boolean;
  doNotDisturb: boolean;
  soundTheme: 'cyber-chime' | 'crystal-ping' | 'sonar-pulse' | 'silent';
}

export interface AppNotificationItem {
  id: string;
  kind: 'message' | 'call' | 'contact' | 'security';
  title: string;
  body: string;
  senderName?: string;
  roomCode?: string;
  timestamp: number;
  read: boolean;
}

export interface UserProfileRecord {
  uid: string;
  username: string;
  handle: string;
  avatarUrl: string;
  bio: string;
  personalPassbox: string;
  keyFingerprint: string;
  avatarGlbUrl?: string;
  avatar3D?: Avatar3DConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ContactRequestRecord {
  id: string;
  fromUid: string;
  fromUsername: string;
  fromAvatarUrl: string;
  fromPassbox: string;
  toUid: string;
  toUsername: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  updatedAt: string;
}

export interface ContactEntryRecord {
  ownerUid: string;
  contactUid: string;
  username: string;
  handle: string;
  avatarUrl: string;
  bio: string;
  roomPassbox: string;
  keyFingerprint: string;
  avatar3D?: Avatar3DConfig;
  createdAt: string;
}

export interface GroupChatRecord {
  groupId: string;
  name: string;
  description: string;
  passboxCode: string;
  creatorUid: string;
  memberUids: string[];
  members: Array<{
    memberUid: string;
    username: string;
    avatarUrl: string;
    role: 'owner' | 'member';
  }>;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_AVATAR_GLB_URL = '/models/readyplayer.me.glb';

export const DEFAULT_AVATAR_3D: Avatar3DConfig = {
  skinTone: '#f1c27d',
  hairStyle: 'cyber-spiky',
  hairColor: '#0ea5e9',
  accessory: 'cyber-visor',
  expression: 'chill-smile',
  outfitColor: '#0284c7',
  bgAura: '#0f172a',
  avatarGlbUrl: DEFAULT_AVATAR_GLB_URL,
  eyeColor: '#38bdf8',
  beardStyle: 'sculpted',
  cameraFraming: 'bust',
  studioMode: 'three-gltf',
};

export function parseReadyPlayerMeMessage(eventData: unknown): {
  type: 'frame-ready' | 'avatar-exported' | 'ignore';
  glbUrl?: string;
} {
  let parsed: Record<string, unknown> | null = null;
  if (typeof eventData === 'string') {
    try {
      parsed = JSON.parse(eventData) as Record<string, unknown>;
    } catch {
      return { type: 'ignore' };
    }
  } else if (eventData && typeof eventData === 'object') {
    parsed = eventData as Record<string, unknown>;
  }
  if (!parsed || parsed.source !== 'readyplayerme') {
    return { type: 'ignore' };
  }
  if (parsed.eventName === 'v1.frame.ready') {
    return { type: 'frame-ready' };
  }
  if (parsed.eventName === 'v1.avatar.exported') {
    const dataObj = parsed.data as Record<string, unknown> | undefined;
    const rawUrl = typeof dataObj?.url === 'string' ? dataObj.url.trim() : '';
    if (rawUrl) {
      return { type: 'avatar-exported', glbUrl: rawUrl };
    }
  }
  return { type: 'ignore' };
}

export interface ExpressionPoseRigTarget {
  mouthSmile: number;
  mouthSmileLeft: number;
  mouthSmileRight: number;
  mouthOpen: number;
  jawOpen: number;
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  browInnerUp: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  leftEyeScaleY: number;
  rightArmRaise: number;
}

export function computeExpressionMorphWeights(
  expression: Avatar3DConfig['expression'],
  voiceEnergy = 0
): ExpressionPoseRigTarget {
  const clampedVoice = Math.max(0, Math.min(1, voiceEnergy));
  switch (expression) {
    case 'wink-star':
      return {
        mouthSmile: 0.88,
        mouthSmileLeft: 0.92,
        mouthSmileRight: 0.82,
        mouthOpen: Math.max(0.16, clampedVoice * 0.85),
        jawOpen: Math.max(0.16, clampedVoice * 0.85),
        eyeBlinkLeft: 1.0,
        eyeBlinkRight: 0,
        browInnerUp: 0.45,
        headPitch: -0.05,
        headYaw: -0.14,
        headRoll: 0.14,
        leftEyeScaleY: 0.1,
        rightArmRaise: 0.38,
      };
    case 'cyber-focus':
      return {
        mouthSmile: 0.14,
        mouthSmileLeft: 0.14,
        mouthSmileRight: 0.14,
        mouthOpen: Math.max(0.02, clampedVoice * 0.75),
        jawOpen: Math.max(0.02, clampedVoice * 0.75),
        eyeBlinkLeft: 0.12,
        eyeBlinkRight: 0.12,
        browInnerUp: 0.72,
        headPitch: 0.08,
        headYaw: 0.06,
        headRoll: -0.03,
        leftEyeScaleY: 0.88,
        rightArmRaise: 0.12,
      };
    case 'hype-laugh':
      return {
        mouthSmile: 0.96,
        mouthSmileLeft: 0.96,
        mouthSmileRight: 0.96,
        mouthOpen: Math.max(0.88, clampedVoice * 0.98),
        jawOpen: Math.max(0.88, clampedVoice * 0.98),
        eyeBlinkLeft: 0.25,
        eyeBlinkRight: 0.25,
        browInnerUp: 0.85,
        headPitch: -0.16,
        headYaw: 0.04,
        headRoll: 0.06,
        leftEyeScaleY: 0.82,
        rightArmRaise: 0.45,
      };
    case 'chill-smile':
    default:
      return {
        mouthSmile: 0.76,
        mouthSmileLeft: 0.76,
        mouthSmileRight: 0.76,
        mouthOpen: Math.max(0.08, clampedVoice * 0.85),
        jawOpen: Math.max(0.08, clampedVoice * 0.85),
        eyeBlinkLeft: 0,
        eyeBlinkRight: 0,
        browInnerUp: 0.22,
        headPitch: -0.02,
        headYaw: 0.05,
        headRoll: 0.03,
        leftEyeScaleY: 1.0,
        rightArmRaise: 0.05,
      };
  }
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  enabled: true,
  newMessages: true,
  incomingCalls: true,
  contactRequests: true,
  backgroundAlerts: true,
  doNotDisturb: false,
  soundTheme: 'cyber-chime',
};

export function shouldTriggerNotification(
  prefs: NotificationPreferences,
  kind: AppNotificationItem['kind']
): boolean {
  if (!prefs.enabled || prefs.doNotDisturb) return false;
  if (kind === 'message') return prefs.newMessages;
  if (kind === 'call') return prefs.incomingCalls;
  if (kind === 'contact') return prefs.contactRequests;
  return true;
}

export function removeContactByUid(
  contacts: ContactEntryRecord[],
  contactUidToRemove: string
): ContactEntryRecord[] {
  return contacts.filter((c) => c.contactUid !== contactUidToRemove);
}

export function sanitizeHandle(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return cleaned.length >= 2 ? cleaned : `${cleaned || 'user'}_peer`;
}

export function validateProfileInput(input: {
  username: string;
  handle?: string;
  bio?: string;
  personalPassbox?: string;
}): { valid: boolean; error?: string; normalizedHandle: string; normalizedPassbox: string } {
  const trimmedName = (input.username || '').trim();
  if (trimmedName.length < 2 || trimmedName.length > 50) {
    return {
      valid: false,
      error: 'Username must be between 2 and 50 characters.',
      normalizedHandle: '',
      normalizedPassbox: '',
    };
  }
  const normalizedHandle = sanitizeHandle(input.handle || trimmedName);
  const bio = (input.bio || '').trim();
  if (bio.length > 240) {
    return {
      valid: false,
      error: 'Bio must be 240 characters or fewer.',
      normalizedHandle,
      normalizedPassbox: '',
    };
  }
  const normalizedPassbox = input.personalPassbox
    ? normalizePassboxCode(input.personalPassbox)
    : generatePassboxCode();
  if (!isValidPassboxCode(normalizedPassbox)) {
    return {
      valid: false,
      error: 'Personal passbox must be 6 alphanumeric characters.',
      normalizedHandle,
      normalizedPassbox,
    };
  }
  return {
    valid: true,
    normalizedHandle,
    normalizedPassbox,
  };
}

export function searchUsersDirectory(
  users: UserProfileRecord[],
  queryText: string,
  excludeUid?: string
): UserProfileRecord[] {
  const q = queryText.trim().toLowerCase();
  return users.filter((u) => {
    if (excludeUid && u.uid === excludeUid) return false;
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q) ||
      u.handle.toLowerCase().includes(q) ||
      u.personalPassbox.toLowerCase().includes(q) ||
      u.bio.toLowerCase().includes(q)
    );
  });
}

export function generateAvatarSvgDataUri(name: string, bgHex = '#0284c7'): string {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('')
      .slice(0, 2) || 'CL';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bgHex}"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
    </defs>
    <rect width="120" height="120" rx="24" fill="url(#g)"/>
    <circle cx="95" cy="25" r="32" fill="rgba(255,255,255,0.08)"/>
    <text x="60" y="68" text-anchor="middle" fill="#f8fafc" font-family="sans-serif" font-weight="700" font-size="40">${initials}</text>
  </svg>`;
  if (typeof Buffer !== 'undefined') {
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Returns an empty directory by default — only real registered users populate the directory.
 */
export function buildDefaultDirectoryUsers(): UserProfileRecord[] {
  return [];
}
