import React, { useState } from 'react';
import {
  Bell,
  BellOff,
  PhoneIncoming,
  MessageSquare,
  UserPlus,
  ShieldAlert,
  Volume2,
  CheckCheck,
  Trash2,
  X,
  Sliders,
} from 'lucide-react';
import {
  type NotificationPreferences,
  type AppNotificationItem,
} from '../utils/socialAndGroups';

interface NotificationCenterModalProps {
  notifications: AppNotificationItem[];
  preferences: NotificationPreferences;
  darkMode: boolean;
  onUpdatePreferences: (next: NotificationPreferences) => void;
  onMarkAllRead: () => void;
  onClearNotifications: () => void;
  onOpenRoomFromNotification: (roomCode: string, senderName: string) => void;
  onClose: () => void;
}

export function playNotificationChime(theme: NotificationPreferences['soundTheme']) {
  if (theme === 'silent') return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const baseFreq =
      theme === 'cyber-chime' ? 587.33 : theme === 'crystal-ping' ? 783.99 : 440;
    osc.type = theme === 'sonar-pulse' ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.45, ctx.currentTime + 0.18);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Ignore audio context block in un-interacted browser tabs
  }
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  notifications,
  preferences,
  darkMode,
  onUpdatePreferences,
  onMarkAllRead,
  onClearNotifications,
  onOpenRoomFromNotification,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'feed' | 'settings'>('feed');
  const [browserPermissionStatus, setBrowserPermissionStatus] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const handleRequestBrowserPermission = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const perm = await Notification.requestPermission();
      setBrowserPermissionStatus(perm);
    } catch {
      // Ignore
    }
  };

  const renderIcon = (kind: AppNotificationItem['kind']) => {
    switch (kind) {
      case 'call':
        return <PhoneIncoming className="w-4 h-4 text-emerald-400" />;
      case 'contact':
        return <UserPlus className="w-4 h-4 text-amber-400" />;
      case 'security':
        return <ShieldAlert className="w-4 h-4 text-purple-400" />;
      case 'message':
      default:
        return <MessageSquare className="w-4 h-4 text-sky-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div
        role="dialog"
        aria-label="Notification Center and Settings"
        className={`w-full max-w-2xl max-h-[86vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden ${
          darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between gap-4 px-6 py-4 border-b ${
            darkMode ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('feed')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'feed'
                  ? 'bg-sky-500 text-slate-950'
                  : darkMode
                  ? 'text-slate-300 hover:bg-slate-800'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Activity Alerts ({notifications.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-sky-500 text-slate-950'
                  : darkMode
                  ? 'text-slate-300 hover:bg-slate-800'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Notification Settings</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Notification Center"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === 'feed' ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-400">
                  Real-time alerts from connected peers
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Mark All Read</span>
                  </button>
                  <button
                    type="button"
                    onClick={onClearNotifications}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              {notifications.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <BellOff className="w-7 h-7 text-slate-500 mx-auto" />
                  <div className="text-sm font-semibold">No recent notifications</div>
                  <p className="text-xs text-slate-400">
                    New messages, incoming E2EE calls, and contact requests will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
                        !n.read
                          ? darkMode
                            ? 'bg-sky-500/10 border-sky-500/40'
                            : 'bg-sky-50 border-sky-200'
                          : darkMode
                          ? 'bg-slate-950/60 border-slate-800'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 shrink-0 mt-0.5">
                          {renderIcon(n.kind)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold flex items-center gap-2">
                            <span>{n.title}</span>
                            {!n.read && (
                              <span className="text-[10px] font-mono text-sky-400">NEW</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{n.body}</p>
                          <div className="text-[10px] font-mono tabular-nums text-slate-500 mt-1">
                            {new Date(n.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </div>
                        </div>
                      </div>

                      {n.roomCode && (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenRoomFromNotification(n.roomCode!, n.senderName || 'Peer');
                            onClose();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs shrink-0 cursor-pointer"
                        >
                          Open
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    key: 'enabled' as const,
                    title: 'Master Notifications',
                    desc: 'Enable all real-time alerts and chimes',
                  },
                  {
                    key: 'doNotDisturb' as const,
                    title: 'Do Not Disturb (Quiet Hours)',
                    desc: 'Mute popups and chimes during focus sessions',
                  },
                  {
                    key: 'newMessages' as const,
                    title: 'New Message Alerts',
                    desc: 'Notify on incoming E2EE text, GIF, and voice notes',
                  },
                  {
                    key: 'incomingCalls' as const,
                    title: 'Incoming Call Ringtones',
                    desc: 'Priority banner & chime for voice/video/screen calls',
                  },
                  {
                    key: 'contactRequests' as const,
                    title: 'Contact Request Alerts',
                    desc: 'Alert when peers send or accept contact requests',
                  },
                  {
                    key: 'backgroundAlerts' as const,
                    title: 'Background Tab & Desktop Alerts',
                    desc: 'Deliver OS notifications when CipherLink is in background',
                  },
                ].map((item) => (
                  <label
                    key={item.key}
                    className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer ${
                      darkMode ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold">{item.title}</div>
                      <div className="text-[11px] text-slate-400">{item.desc}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={preferences[item.key]}
                      onChange={(e) =>
                        onUpdatePreferences({
                          ...preferences,
                          [item.key]: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded text-sky-500"
                    />
                  </label>
                ))}
              </div>

              {/* Sound Chime Selector */}
              <div
                className={`p-4 rounded-xl border space-y-2.5 ${
                  darkMode ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    <Volume2 className="w-4 h-4 text-sky-400" />
                    <span>Notification Chime & Ringtone Synthesis</span>
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      { id: 'cyber-chime', label: 'Cyber Chime' },
                      { id: 'crystal-ping', label: 'Crystal Ping' },
                      { id: 'sonar-pulse', label: 'Sonar Pulse' },
                      { id: 'silent', label: 'Silent' },
                    ] as const
                  ).map((snd) => (
                    <button
                      key={snd.id}
                      type="button"
                      onClick={() => {
                        onUpdatePreferences({ ...preferences, soundTheme: snd.id });
                        playNotificationChime(snd.id);
                      }}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                        preferences.soundTheme === snd.id
                          ? 'border-sky-500 bg-sky-500/20 text-sky-300 font-semibold'
                          : 'border-slate-800 hover:bg-slate-800 text-slate-400'
                      }`}
                    >
                      {snd.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Browser OS Background Notification Permission */}
              <div
                className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                  darkMode ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div>
                  <div className="text-xs font-semibold">
                    Browser Desktop Notification Permission
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Current status: <span className="font-mono uppercase">{browserPermissionStatus}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRequestBrowserPermission}
                  className="px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs cursor-pointer"
                >
                  Authorize Background Desktop Alerts
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
