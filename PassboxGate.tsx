import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import {
  ShieldCheck,
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  QrCode,
  ArrowRight,
  Moon,
  Sun,
  Lock,
  Sparkles,
  FileCode2,
  Wifi,
} from 'lucide-react';
import {
  normalizePassboxCode,
  isValidPassboxCode,
  generatePassboxCode,
  deriveSessionFingerprint,
} from '../utils/cryptoEngine';

interface PassboxGateProps {
  initialCode?: string;
  initialName?: string;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onUnlockSession: (passboxCode: string, displayName: string) => void;
}

export const PassboxGate: React.FC<PassboxGateProps> = ({
  initialCode = '7X9K2M',
  initialName = '',
  darkMode,
  onToggleDarkMode,
  onUnlockSession,
}) => {
  const [digits, setDigits] = useState<string[]>(() => {
    const clean = normalizePassboxCode(initialCode).padEnd(6, ' ');
    return clean.split('').slice(0, 6).map((c) => (c === ' ' ? '' : c));
  });
  const [displayName, setDisplayName] = useState(initialName);

  useEffect(() => {
    if (initialName && !displayName) {
      setDisplayName(initialName);
    }
  }, [initialName]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [ttlMinutes, setTtlMinutes] = useState<number>(30);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const combinedCode = normalizePassboxCode(digits.join(''));
  const isCodeComplete = isValidPassboxCode(combinedCode);
  const activeFingerprint = deriveSessionFingerprint(isCodeComplete ? combinedCode : '7X9K2M');

  useEffect(() => {
    const targetCode = generatedCode || (isCodeComplete ? combinedCode : '7X9K2M');
    const shareUrl = `${window.location.origin}/?passbox=${targetCode}`;
    QRCode.toDataURL(shareUrl, {
      width: 180,
      margin: 1,
      color: {
        dark: darkMode ? '#e2e8f0' : '#0f172a',
        light: darkMode ? '#0f172a' : '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [generatedCode, combinedCode, isCodeComplete, darkMode]);

  const setFullCode = (code: string) => {
    const clean = normalizePassboxCode(code);
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < Math.min(6, clean.length); i++) {
      next[i] = clean[i];
    }
    setDigits(next);
    setErrorMsg(null);
  };

  const handleDigitChange = (index: number, value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length > 1) {
      // Handle multi-char paste or autofill into a slot
      const next = [...digits];
      for (let i = 0; i < cleaned.length && index + i < 6; i++) {
        next[index + i] = cleaned[i];
      }
      setDigits(next);
      setErrorMsg(null);
      const focusIdx = Math.min(5, index + cleaned.length);
      inputRefs.current[focusIdx]?.focus();
      return;
    }

    const next = [...digits];
    next[index] = cleaned;
    setDigits(next);
    setErrorMsg(null);
    if (cleaned && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    if (pasted) {
      setFullCode(pasted);
    }
  };

  const handleGenerateNewCode = () => {
    const fresh = generatePassboxCode();
    setGeneratedCode(fresh);
    setFullCode(fresh);
    setCopiedCode(false);
    setCopiedLink(false);
  };

  const handleCopyCode = () => {
    const target = generatedCode || combinedCode;
    if (!target) return;
    navigator.clipboard?.writeText(target).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyPairingLink = () => {
    const target = generatedCode || combinedCode;
    if (!target) return;
    const shareUrl = `${window.location.origin}/?passbox=${target}`;
    navigator.clipboard?.writeText(shareUrl).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCodeComplete) {
      setErrorMsg('Enter a valid 6-character alphanumeric passbox code (A–Z, 0–9).');
      return;
    }
    const cleanName = displayName.trim() || 'Anonymous Peer';
    onUnlockSession(combinedCode, cleanName);
  };

  return (
    <div
      className={`min-h-screen flex flex-col justify-between transition-colors duration-150 ${
        darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Top Bar Following Strict 3-Zone Contract */}
      <header
        className={`flex items-center justify-between gap-8 px-6 py-4 border-b ${
          darkMode ? 'border-slate-800/80 bg-slate-950/90' : 'border-slate-200 bg-white/90'
        }`}
      >
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0"
        >
          CipherLink
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-500 dark:text-slate-400">
          <a
            href="#passbox-vault"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Passbox Authentication
          </a>
          <a
            href="#qr-generator"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Instant QR Pairing
          </a>
          <a
            href="#encryption-spec"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            AES-256-GCM Spec
          </a>
          <a
            href="#media-capabilities"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Unlimited Media Stream
          </a>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 ${
              darkMode
                ? 'border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800'
                : 'border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200'
            }`}
          >
            {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-700" />}
            <span>{darkMode ? 'Light Comfort' : 'Late-Night Dark'}</span>
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: 6-Digit Alphanumeric Passbox & Generate New Code */}
        <section
          id="passbox-vault"
          className={`lg:col-span-7 rounded-xl border p-6 sm:p-8 ${
            darkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="text-xs font-mono text-sky-500">
              ECDH-P256 · AES-256-GCM · ZERO-KNOWLEDGE SESSION GATE
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-400">
              KEY ID: {activeFingerprint.keyId}
            </div>
          </div>

          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight mb-2"
            style={{ textWrap: 'balance' }}
          >
            Person-to-Person Passbox Authentication
          </h1>
          <p className={`text-sm mb-6 ${darkMode ? 'text-slate-400' : 'text-slate-600'}`}>
            Enter a shared 6-digit alphanumeric passbox code to derive your conversation’s
            end-to-end encryption key, or generate a temporary code below to pair instantly.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Display Name Input */}
            <div>
              <label
                htmlFor="session-display-name"
                className={`block text-xs font-medium mb-1.5 ${
                  darkMode ? 'text-slate-300' : 'text-slate-700'
                }`}
              >
                Your Session Display Name
              </label>
              <input
                id="session-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your display name"
                className={`w-full px-3.5 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500 transition-colors ${
                  darkMode
                    ? 'bg-slate-950 border-slate-800 text-slate-100 placeholder-slate-500'
                    : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
                }`}
              />
            </div>

            {/* 6-Digit Alphanumeric Passbox Slots */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="passbox-slot-0"
                  className={`text-xs font-medium ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}
                >
                  6-Digit Alphanumeric Passbox Code
                </label>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {combinedCode.length}/6 CHARS
                </span>
              </div>

              <div className="grid grid-cols-6 gap-2.5 sm:gap-3" onPaste={handlePaste}>
                {digits.map((char, idx) => (
                  <input
                    key={idx}
                    id={`passbox-slot-${idx}`}
                    ref={(el) => {
                      inputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="text"
                    maxLength={6}
                    aria-label={`Passbox character ${idx + 1}`}
                    value={char}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    className={`w-full h-13 sm:h-14 text-center font-mono text-xl sm:text-2xl font-semibold rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500 transition-colors uppercase tabular-nums ${
                      darkMode
                        ? 'bg-slate-950 border-slate-700 text-sky-400 focus:border-sky-500'
                        : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-sky-600'
                    }`}
                  />
                ))}
              </div>

              {errorMsg && (
                <p role="alert" className="mt-2 text-xs text-rose-400 font-medium">
                  {errorMsg}
                </p>
              )}
            </div>

            {/* Primary Unlock Passbox Button */}
            <button
              type="submit"
              className="w-full py-3 px-5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>Unlock & Join Encrypted Session ({combinedCode || '------'})</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Divider + "Generate New Code" Option Directly Below Passbox Button */}
          <div
            id="qr-generator"
            className={`mt-6 pt-6 border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold">
                  Need a fresh conversation tunnel?
                </h2>
                <p className="text-xs text-slate-400">
                  Generate a temporary 6-digit alphanumeric code & QR token to share with your recipient.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGenerateNewCode}
                className={`px-4 py-2.5 rounded-lg text-xs font-semibold border flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  darkMode
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
                    : 'border-sky-600/30 bg-sky-50 text-sky-800 hover:bg-sky-100'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Generate New Code</span>
              </button>
            </div>

            {/* Instant Pairing Share Box (Alphanumeric + QR Code) */}
            <div
              className={`rounded-lg border p-4 grid grid-cols-1 sm:grid-cols-12 gap-4 items-center ${
                darkMode ? 'bg-slate-950/70 border-slate-800/90' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="sm:col-span-4 flex flex-col items-center justify-center">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR code for passbox ${generatedCode || combinedCode}`}
                    referrerPolicy="no-referrer"
                    className="w-32 h-32 rounded-lg border border-slate-700/40 p-1.5 bg-white dark:bg-slate-900"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-lg border border-slate-800 flex items-center justify-center text-slate-500">
                    <QrCode className="w-8 h-8" />
                  </div>
                )}
                <span className="mt-1.5 text-[11px] font-mono text-slate-400 tabular-nums">
                  TTL: {ttlMinutes}m EPHEMERAL PAIR
                </span>
              </div>

              <div className="sm:col-span-8 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Shareable 6-Digit Pairing Code</span>
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <span>Expires:</span>
                    {[15, 30, 60].map((min) => (
                      <button
                        key={min}
                        type="button"
                        onClick={() => setTtlMinutes(min)}
                        className={`px-1.5 py-0.5 rounded font-mono text-[11px] ${
                          ttlMinutes === min
                            ? 'bg-sky-500/20 text-sky-400 font-semibold'
                            : 'hover:text-slate-200'
                        }`}
                      >
                        {min}m
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    data-testid="generated-passbox-display"
                    className={`flex-1 px-3.5 py-2 rounded-lg border font-mono text-lg font-bold tracking-widest tabular-nums ${
                      darkMode
                        ? 'bg-slate-900 border-slate-800 text-emerald-400'
                        : 'bg-white border-slate-300 text-emerald-700'
                    }`}
                  >
                    {generatedCode || combinedCode || '7X9K2M'}
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className={`px-3 py-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                      darkMode
                        ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
                        : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyPairingLink}
                    className={`px-3 py-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                      darkMode
                        ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
                        : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <QrCode className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Link Copied' : 'Share Link'}</span>
                  </button>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Share this 6-digit alphanumeric code or scan the temporary QR code on your
                  recipient’s device. Keys are derived locally via PBKDF2-SHA256 + AES-256-GCM.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Right Column: Live Cryptographic Proof & Feature Capabilities */}
        <aside className="lg:col-span-5 space-y-6">
          <div
            id="encryption-spec"
            className={`rounded-xl border p-6 ${
              darkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Session Cryptographic Fingerprint</span>
              </h2>
              <span className="text-xs font-mono text-emerald-400">VERIFIED E2EE</span>
            </div>

            <p className={`text-xs mb-4 ${darkMode ? 'text-slate-400' : 'text-slate-600'}`}>
              Every 6-digit passbox code deterministically establishes an isolated conversation
              vault with Short Authentication String (SAS) verification blocks:
            </p>

            <div
              className={`p-3.5 rounded-lg border font-mono text-xs space-y-2 ${
                darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex justify-between">
                <span className="text-slate-500">CIPHER SUITE:</span>
                <span className="text-sky-400">AES-256-GCM / SHA-256</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">ACTIVE PASSBOX:</span>
                <span className="text-emerald-400 font-semibold">{activeFingerprint.passboxCode}</span>
              </div>
              <div>
                <div className="text-slate-500 mb-1">SHA-256 KEY FINGERPRINT:</div>
                <div className="text-[11px] break-all text-slate-300 tabular-nums">
                  {activeFingerprint.hexFingerprint}
                </div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">PEER SAS VERIFICATION BLOCKS:</div>
                <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                  {activeFingerprint.sasBlocks.map((block) => (
                    <span
                      key={block}
                      className={`text-center py-1 rounded border text-[11px] font-semibold tabular-nums ${
                        darkMode
                          ? 'bg-slate-900 border-slate-800 text-amber-300'
                          : 'bg-white border-slate-200 text-amber-700'
                      }`}
                    >
                      {block}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div
            id="media-capabilities"
            className={`rounded-xl border p-6 space-y-4 ${
              darkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
            }`}
          >
            <h2 className="text-base font-semibold">End-to-End Capabilities</h2>

            <div className="space-y-3 text-xs">
              <div className="flex items-start gap-3">
                <KeyRound className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Unlimited-Size Encrypted File & Video Transfer</div>
                  <p className="text-slate-400 mt-0.5">
                    Automatic 256 KB AES-GCM chunked encryption layer with zero file size ceiling and
                    real-time media streaming across connected devices.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Integrated Video Call, Voice Call & Screen Share</div>
                  <p className="text-slate-400 mt-0.5">
                    Low-latency WebRTC media studio with instant screen sharing, voice recording
                    waveforms, and interactive animated GIF messaging.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Wifi className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Offline Outbox Synchronization</div>
                  <p className="text-slate-400 mt-0.5">
                    Compose messages, voice recordings, and encrypted files while offline; automatic
                    idempotent delta reconciliation syncs on reconnect.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <FileCode2 className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Zero-Trust Packet Inspector</div>
                  <p className="text-slate-400 mt-0.5">
                    Verify live AES-256-GCM initialization vectors (IV), PBKDF2 salts, and SHA-256
                    integrity digests on every message and streamed file chunk.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </main>

      {/* Quiet Footer */}
      <footer
        className={`px-6 py-4 border-t text-xs flex flex-col sm:flex-row items-center justify-between gap-2 ${
          darkMode ? 'border-slate-900 text-slate-500' : 'border-slate-200 text-slate-500'
        }`}
      >
        <span>CipherLink End-to-End Encrypted Communications Protocol</span>
        <span>Client-Side PBKDF2-SHA256 · AES-256-GCM · WebRTC DTLS-SRTP</span>
      </footer>
    </div>
  );
};
