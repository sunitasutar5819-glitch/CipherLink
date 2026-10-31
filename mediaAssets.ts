export const GIPHY_API_KEY = '15nVqlZKOiNycG281MaOLRZgaMMV7Hqu';

export interface CuratedGifItem {
  id: string;
  title: string;
  category: 'All' | 'Security' | 'Reactions' | 'Late Night' | 'Ship It';
  keywords: string[];
  accentFrom: string;
  accentTo: string;
  caption: string;
  motif: 'lock' | 'radar' | 'rocket' | 'wave' | 'terminal' | 'moon' | 'spark' | 'shield';
  giphyUrl?: string;
}

export const CURATED_GIFS: CuratedGifItem[] = [
  {
    id: 'cipher-lock',
    title: 'Zero-Knowledge Handshake Verified',
    category: 'Security',
    keywords: ['lock', 'verified', 'secure', 'encrypt', 'handshake', 'passbox'],
    accentFrom: '#0ea5e9',
    accentTo: '#10b981',
    caption: 'AES-256-GCM LOCKED',
    motif: 'lock',
    giphyUrl: 'https://media.giphy.com/media/YQitE4YNQNahy/giphy.gif',
  },
  {
    id: 'late-night-coding',
    title: 'Midnight Dark Mode Flow',
    category: 'Late Night',
    keywords: ['night', 'dark', 'moon', 'chill', 'coffee', 'late'],
    accentFrom: '#6366f1',
    accentTo: '#0ea5e9',
    caption: '02:00 AM ZERO GLARE',
    motif: 'moon',
    giphyUrl: 'https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif',
  },
  {
    id: 'ship-it-fast',
    title: 'Multi-Gigabyte Stream Launched',
    category: 'Ship It',
    keywords: ['ship', 'rocket', 'fast', 'transfer', 'launch', 'go'],
    accentFrom: '#f59e0b',
    accentTo: '#ef4444',
    caption: 'CHUNK STREAM LIVE',
    motif: 'rocket',
    giphyUrl: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
  },
  {
    id: 'radar-sync',
    title: 'Peer Synchronized Across Devices',
    category: 'Security',
    keywords: ['sync', 'radar', 'peer', 'online', 'connected'],
    accentFrom: '#10b981',
    accentTo: '#14b8a6',
    caption: 'P2P MESH SYNCED',
    motif: 'radar',
    giphyUrl: 'https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif',
  },
  {
    id: 'mind-blown-spark',
    title: 'Instant Decryption Complete',
    category: 'Reactions',
    keywords: ['wow', 'spark', 'thumbs', 'yes', 'awesome', 'great'],
    accentFrom: '#ec4899',
    accentTo: '#8b5cf6',
    caption: '100% INTEGRITY',
    motif: 'spark',
    giphyUrl: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
  },
  {
    id: 'audio-wave-vibe',
    title: 'High-Fidelity Voice Wave',
    category: 'Reactions',
    keywords: ['voice', 'audio', 'wave', 'music', 'sound', 'hear'],
    accentFrom: '#06b6d4',
    accentTo: '#3b82f6',
    caption: 'LOSSLESS PCM STREAM',
    motif: 'wave',
    giphyUrl: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  },
  {
    id: 'terminal-approved',
    title: 'Cryptographic Proof Accepted',
    category: 'Ship It',
    keywords: ['code', 'terminal', 'approved', 'ok', 'check', 'done'],
    accentFrom: '#22c55e',
    accentTo: '#059669',
    caption: 'SHA-256 MATCH',
    motif: 'terminal',
    giphyUrl: 'https://media.giphy.com/media/3oKIPnAiaMCws8nOsE/giphy.gif',
  },
  {
    id: 'quantum-shield',
    title: 'End-to-End Tunnel Shielded',
    category: 'Security',
    keywords: ['shield', 'guard', 'privacy', 'safe', 'tunnel'],
    accentFrom: '#3b82f6',
    accentTo: '#1d4ed8',
    caption: 'E2EE SHIELD ACTIVE',
    motif: 'shield',
    giphyUrl: 'https://media.giphy.com/media/L95W4wv8nnb9K/giphy.gif',
  },
];

/**
 * Generates a real playable WAV data URL containing a pleasant synthesized chime/voice-like harmonic cadence.
 * Used both as a fallback when headless Chromium has no physical microphone and for deterministic voice note playback.
 */
export function generateSynthesizedVoiceWavDataUrl(durationSec = 2.4, frequencyBase = 260): string {
  const sampleRate = 16000;
  const numSamples = Math.max(1600, Math.floor(sampleRate * durationSec));
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const syllableEnvelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.2 * t);
    const fade = Math.min(1, t * 12) * Math.min(1, (durationSec - t) * 8);
    const freq = frequencyBase + 45 * Math.sin(2 * Math.PI * 1.5 * t);
    const sample =
      Math.sin(2 * Math.PI * freq * t) * 0.45 +
      Math.sin(2 * Math.PI * (freq * 1.5) * t) * 0.25 +
      Math.sin(2 * Math.PI * (freq * 2) * t) * 0.12;
    const pcmValue = Math.max(-1, Math.min(1, sample * syllableEnvelope * fade));
    view.setInt16(44 + i * 2, pcmValue * 28000, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export function generateWaveformBars(count = 28, seed = 42): number[] {
  const bars: number[] = [];
  let s = seed;
  for (let i = 0; i < count; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const normalized = 0.2 + ((s >>> 0) / 4294967296) * 0.8;
    bars.push(Number(normalized.toFixed(2)));
  }
  return bars;
}
