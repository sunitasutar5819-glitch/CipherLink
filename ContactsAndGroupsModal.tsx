import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  UserCheck,
  Search,
  X,
  Check,
  Shield,
  PlusCircle,
  Upload,
  MessageSquareLock,
  Eye,
  Trash2,
  Sparkles,
} from 'lucide-react';
import {
  validateProfileInput,
  generateAvatarSvgDataUri,
  DEFAULT_AVATAR_3D,
  type UserProfileRecord,
  type ContactRequestRecord,
  type ContactEntryRecord,
  type GroupChatRecord,
  type Avatar3DConfig,
} from '../utils/socialAndGroups';
import { deriveSessionFingerprint } from '../utils/cryptoEngine';
import { Avatar3DStudio } from './Avatar3DStudio';

interface ContactsAndGroupsModalProps {
  initialTab: 'contacts' | 'profile' | 'groups';
  initialInspectedProfile?: UserProfileRecord | null;
  currentUser: UserProfileRecord;
  directoryUsers: UserProfileRecord[];
  contacts: ContactEntryRecord[];
  contactRequests: ContactRequestRecord[];
  groups: GroupChatRecord[];
  darkMode: boolean;
  onClose: () => void;
  onUpdateProfile: (updated: {
    username: string;
    bio: string;
    avatarUrl: string;
    avatarGlbUrl?: string;
    avatar3D?: Avatar3DConfig;
  }) => Promise<void>;
  onSendContactRequest: (toUid: string) => Promise<void>;
  onRespondContactRequest: (requestId: string, status: 'accepted' | 'declined') => Promise<void>;
  onRemoveContact: (contactUid: string) => Promise<void>;
  onCreateGroup: (name: string, description: string, memberUids: string[]) => Promise<void>;
  onInviteToGroup: (groupId: string, memberUid: string) => Promise<void>;
  onOpenRoom: (passboxCode: string, label: string) => void;
  onSend3DStickerToChat?: (dataUrl: string, caption: string) => void;
}

export const ContactsAndGroupsModal: React.FC<ContactsAndGroupsModalProps> = ({
  initialTab,
  initialInspectedProfile = null,
  currentUser,
  directoryUsers,
  contacts,
  contactRequests,
  groups,
  darkMode,
  onClose,
  onUpdateProfile,
  onSendContactRequest,
  onRespondContactRequest,
  onRemoveContact,
  onCreateGroup,
  onInviteToGroup,
  onOpenRoom,
  onSend3DStickerToChat,
}) => {
  const [activeTab, setActiveTab] = useState<'contacts' | 'profile' | 'groups'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectedProfile, setInspectedProfile] = useState<UserProfileRecord | null>(
    initialInspectedProfile
  );

  // Profile & 3D Avatar Editor state
  const [editUsername, setEditUsername] = useState(currentUser.username);
  const [editBio, setEditBio] = useState(currentUser.bio);
  const [editAvatar, setEditAvatar] = useState(currentUser.avatarUrl);
  const [editAvatar3D, setEditAvatar3D] = useState<Avatar3DConfig>(
    currentUser.avatar3D || DEFAULT_AVATAR_3D
  );
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);

  // New Group state
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [selectedMemberUids, setSelectedMemberUids] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);

  const filteredDirectory = directoryUsers.filter((u) => {
    if (u.uid === currentUser.uid) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q) ||
      u.handle.toLowerCase().includes(q) ||
      u.personalPassbox.toLowerCase().includes(q) ||
      u.bio.toLowerCase().includes(q)
    );
  });

  const pendingIncoming = contactRequests.filter(
    (r) => r.status === 'pending' && r.toUid === currentUser.uid
  );
  const pendingOutgoing = contactRequests.filter(
    (r) => r.status === 'pending' && r.fromUid === currentUser.uid
  );

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setEditAvatar(reader.result.slice(0, 65000));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateProfileInput({
      username: editUsername,
      bio: editBio,
      personalPassbox: currentUser.personalPassbox,
    });
    if (!check.valid) {
      setProfileFeedback(check.error || 'Invalid profile fields');
      return;
    }
    await onUpdateProfile({
      username: editUsername.trim(),
      bio: editBio.trim(),
      avatarUrl: editAvatar || generateAvatarSvgDataUri(editUsername, '#0284c7'),
      avatarGlbUrl: editAvatar3D.avatarGlbUrl,
      avatar3D: editAvatar3D,
    });
    setProfileFeedback('Profile & 3D GLTF Avatar saved and synchronized.');
    setTimeout(() => setProfileFeedback(null), 2500);
  };

  const handleCreateGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (groupName.trim().length < 2) {
      setGroupError('Group name must be at least 2 characters.');
      return;
    }
    setGroupError(null);
    await onCreateGroup(groupName.trim(), groupDesc.trim(), selectedMemberUids);
    setGroupName('');
    setGroupDesc('');
    setSelectedMemberUids([]);
  };

  const toggleMemberSelection = (uid: string) => {
    setSelectedMemberUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div
        role="dialog"
        aria-label="Contacts, 3D User Profile, and Encrypted Group Chats"
        className={`w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden ${
          darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Top Modal Header & Segmented Tabs */}
        <div
          className={`flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b ${
            darkMode ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab('contacts');
                setInspectedProfile(null);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'contacts'
                  ? 'bg-sky-500 text-slate-950'
                  : darkMode
                  ? 'text-slate-300 hover:bg-slate-800'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Contacts & Search ({contacts.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('groups');
                setInspectedProfile(null);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'groups'
                  ? 'bg-sky-500 text-slate-950'
                  : darkMode
                  ? 'text-slate-300 hover:bg-slate-800'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Group Chats ({groups.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('profile');
                setInspectedProfile(null);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-sky-500 text-slate-950'
                  : darkMode
                  ? 'text-slate-300 hover:bg-slate-800'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>My Profile & 3D Avatar</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Contacts and Groups Modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Inspected Other User Profile Drawer */}
          {inspectedProfile && (
            <div
              className={`mb-6 rounded-xl border p-5 ${
                darkMode ? 'bg-slate-950 border-sky-500/40' : 'bg-sky-50/50 border-sky-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <img
                    src={inspectedProfile.avatarUrl}
                    alt={inspectedProfile.username}
                    referrerPolicy="no-referrer"
                    className="w-16 h-16 rounded-xl object-cover border border-slate-700"
                  />
                  <div>
                    <h3 className="text-base font-bold">{inspectedProfile.username}</h3>
                    <div className="text-xs font-mono text-sky-400">
                      @{inspectedProfile.handle} · PASSBOX: {inspectedProfile.personalPassbox}
                    </div>
                    <p className="text-xs text-slate-300 mt-1">{inspectedProfile.bio}</p>
                    {inspectedProfile.avatar3D && (
                      <div className="text-[11px] font-mono text-emerald-400 mt-1">
                        3D AVATAR: {inspectedProfile.avatar3D.hairStyle.toUpperCase()} · AR{' '}
                        {inspectedProfile.avatar3D.accessory.toUpperCase()} · POSE{' '}
                        {inspectedProfile.avatar3D.expression.toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedProfile(null)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Close Profile View
                </button>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                <span className="text-slate-400">
                  E2EE FINGERPRINT: {inspectedProfile.keyFingerprint}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onOpenRoom(inspectedProfile.personalPassbox, inspectedProfile.username);
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-sans font-semibold text-xs cursor-pointer"
                >
                  Message {inspectedProfile.username}
                </button>
              </div>
            </div>
          )}

          {/* TAB 1: CONTACTS & USER SEARCH */}
          {activeTab === 'contacts' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Accepted Contacts & Incoming Contact Requests */}
              <div className="lg:col-span-6 space-y-5">
                {pendingIncoming.length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                      Incoming Contact Requests ({pendingIncoming.length})
                    </h3>
                    {pendingIncoming.map((req) => (
                      <div
                        key={req.id}
                        className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                          darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={req.fromAvatarUrl}
                            alt={req.fromUsername}
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-lg object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate">{req.fromUsername}</div>
                            <div className="text-[11px] font-mono text-slate-400">
                              Passbox: {req.fromPassbox}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onRespondContactRequest(req.id, 'accepted')}
                            aria-label={`Accept contact request from ${req.fromUsername}`}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Accept</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onRespondContactRequest(req.id, 'declined')}
                            aria-label={`Decline contact request from ${req.fromUsername}`}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-400 text-xs cursor-pointer"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold text-slate-400">
                    Your Verified Contacts ({contacts.length})
                  </h3>
                  {contacts.length === 0 ? (
                    <div className="p-6 rounded-xl border border-slate-800 text-center text-xs text-slate-400">
                      No contacts in your list yet. Search the directory on the right to add contacts.
                    </div>
                  ) : (
                    contacts.map((c) => {
                      const fullProfile = directoryUsers.find((u) => u.uid === c.contactUid);
                      return (
                        <div
                          key={c.contactUid}
                          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                            darkMode ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={c.avatarUrl}
                              alt={c.username}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-lg object-cover shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold truncate">{c.username}</div>
                              <div className="text-[11px] font-mono text-slate-400 truncate">
                                @{c.handle} · {c.roomPassbox}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {fullProfile && (
                              <button
                                type="button"
                                onClick={() => setInspectedProfile(fullProfile)}
                                aria-label={`View profile of ${c.username}`}
                                className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                                  darkMode
                                    ? 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
                                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Profile</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                onOpenRoom(c.roomPassbox, c.username);
                                onClose();
                              }}
                              aria-label={`Chat with ${c.username}`}
                              className="px-2.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <MessageSquareLock className="w-3.5 h-3.5" />
                              <span>Chat</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveContact(c.contactUid)}
                              aria-label={`Remove contact ${c.username}`}
                              className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: User Directory Search & Send Contact Request */}
              <div className="lg:col-span-6 space-y-4">
                <div>
                  <label htmlFor="user-directory-search" className="block text-xs font-semibold mb-1.5">
                    Search Users by Username, Handle, or Passbox Code
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="user-directory-search"
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by username, @handle, or 6-digit Passbox code..."
                      className={`w-full pl-9 pr-3 py-2 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                        darkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100 placeholder-slate-500'
                          : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
                      }`}
                    />
                  </div>
                </div>

                <div className="space-y-2.5">
                  {filteredDirectory.length === 0 ? (
                    <div className="p-6 rounded-xl border border-slate-800 text-center text-xs text-slate-400">
                      No other person is connected yet. Share your 6-digit Passbox code or link so real peers can join.
                    </div>
                  ) : (
                    filteredDirectory.map((user) => {
                      const isContact = contacts.some((c) => c.contactUid === user.uid);
                      const hasSentReq = pendingOutgoing.some((r) => r.toUid === user.uid);
                      const incomingReq = pendingIncoming.find((r) => r.fromUid === user.uid);
                      return (
                        <div
                          key={user.uid}
                          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                            darkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={user.avatarUrl}
                              alt={user.username}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-lg object-cover shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold truncate">{user.username}</div>
                              <div className="text-[11px] font-mono text-slate-400 truncate">
                                @{user.handle} · {user.personalPassbox}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setInspectedProfile(user)}
                              aria-label={`Inspect profile of ${user.username}`}
                              className={`px-2.5 py-1.5 rounded-lg border text-xs whitespace-nowrap shrink-0 cursor-pointer ${
                                darkMode
                                  ? 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
                                  : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              View Profile
                            </button>

                            {isContact ? (
                              <span className="px-2.5 py-1.5 text-xs font-mono text-emerald-400 whitespace-nowrap shrink-0">
                                Connected
                              </span>
                            ) : incomingReq ? (
                              <button
                                type="button"
                                onClick={() => onRespondContactRequest(incomingReq.id, 'accepted')}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Accept</span>
                              </button>
                            ) : hasSentReq ? (
                              <span className="px-2.5 py-1.5 text-xs font-mono text-amber-400 whitespace-nowrap shrink-0">
                                Request Sent
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onSendContactRequest(user.uid)}
                                aria-label={`Send contact request to ${user.username}`}
                                className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <UserPlus className="w-3.5 h-3.5" />
                                <span>Add Contact</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: GROUP CHATS (CREATE GROUP & INVITE MEMBERS) */}
          {activeTab === 'groups' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Create New Group Form */}
              <form onSubmit={handleCreateGroupSubmit} className="lg:col-span-5 space-y-4">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <PlusCircle className="w-4 h-4 text-sky-400" />
                  <span>Create Encrypted Group Chat</span>
                </h3>

                <div>
                  <label htmlFor="new-group-name" className="block text-xs font-medium mb-1">
                    Group Name
                  </label>
                  <input
                    id="new-group-name"
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="e.g. Incident Response E2EE"
                    className={`w-full px-3 py-2 text-xs rounded-lg border ${
                      darkMode
                        ? 'bg-slate-950 border-slate-800 text-slate-100'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                <div>
                  <label htmlFor="new-group-desc" className="block text-xs font-medium mb-1">
                    Group Mission / Topic
                  </label>
                  <input
                    id="new-group-desc"
                    type="text"
                    value={groupDesc}
                    onChange={(e) => setGroupDesc(e.target.value)}
                    placeholder="Encrypted file sharing & group calls"
                    className={`w-full px-3 py-2 text-xs rounded-lg border ${
                      darkMode
                        ? 'bg-slate-950 border-slate-800 text-slate-100'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                <div>
                  <span className="block text-xs font-medium mb-1.5">
                    Invite Initial Members ({selectedMemberUids.length} selected)
                  </span>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {directoryUsers
                      .filter((u) => u.uid !== currentUser.uid)
                      .map((u) => {
                        const checked = selectedMemberUids.includes(u.uid);
                        return (
                          <label
                            key={u.uid}
                            className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer ${
                              checked
                                ? 'border-sky-500/60 bg-sky-500/10'
                                : darkMode
                                ? 'border-slate-800 bg-slate-950/60'
                                : 'border-slate-200 bg-slate-50'
                            }`}
                          >
                            <span>{u.username} (@{u.handle})</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMemberSelection(u.uid)}
                              className="rounded text-sky-500"
                            />
                          </label>
                        );
                      })}
                  </div>
                </div>

                {groupError && <p className="text-xs text-rose-400">{groupError}</p>}

                <button
                  type="submit"
                  className="w-full py-2.5 px-4 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs cursor-pointer"
                >
                  Create Group & Generate Group Passbox
                </button>
              </form>

              {/* Active Group Chats List & Member Invites */}
              <div className="lg:col-span-7 space-y-4">
                <h3 className="text-sm font-bold">Active Encrypted Groups ({groups.length})</h3>
                {groups.map((grp) => (
                  <div
                    key={grp.groupId}
                    className={`p-4 rounded-xl border space-y-3 ${
                      darkMode ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold">{grp.name}</div>
                        <div className="text-xs text-slate-400">{grp.description}</div>
                        <div className="text-[11px] font-mono text-sky-400 mt-1">
                          GROUP PASSBOX: {grp.passboxCode} · {grp.members.length} MEMBERS
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenRoom(grp.passboxCode, `${grp.name} (Group)`);
                          onClose();
                        }}
                        className="px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs shrink-0 cursor-pointer"
                      >
                        Open Group Chat
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
                      <span className="text-xs text-slate-400">Members:</span>
                      {grp.members.map((m) => (
                        <span key={m.memberUid} className="text-xs font-medium text-slate-300">
                          {m.username}
                        </span>
                      ))}
                    </div>

                    {/* Quick Invite Member Dropdown/Buttons */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[11px] text-slate-400">Invite Peer:</span>
                      {directoryUsers
                        .filter((u) => !grp.memberUids.includes(u.uid))
                        .map((uninvited) => (
                          <button
                            key={uninvited.uid}
                            type="button"
                            onClick={() => onInviteToGroup(grp.groupId, uninvited.uid)}
                            className={`px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1 cursor-pointer ${
                              darkMode
                                ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-sky-300'
                                : 'border-slate-300 bg-white hover:bg-slate-100 text-sky-700'
                            }`}
                          >
                            <UserPlus className="w-3 h-3" />
                            <span>+ {uninvited.username.split(' ')[0]}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: USER PROFILE, SHORT BIO & SNAPCHAT-STYLE 3D AVATAR STUDIO */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              {/* Interactive 3D Avatar Customizer */}
              <Avatar3DStudio
                config={editAvatar3D}
                darkMode={darkMode}
                onChangeConfig={setEditAvatar3D}
                onCaptureAvatarDataUrl={(dataUrl, cfg) => {
                  setEditAvatar(dataUrl);
                  setEditAvatar3D(cfg);
                }}
                onSend3DStickerToChat={
                  onSend3DStickerToChat
                    ? (dataUrl, caption) => {
                        onSend3DStickerToChat(dataUrl, caption);
                        onClose();
                      }
                    : undefined
                }
              />

              <form onSubmit={handleSaveProfile} className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                <div className="md:col-span-4 flex items-center gap-4">
                  <img
                    src={editAvatar}
                    alt={editUsername}
                    referrerPolicy="no-referrer"
                    className="w-20 h-20 rounded-2xl object-cover border border-slate-700 shrink-0"
                  />
                  <div className="space-y-1.5">
                    <div className="text-sm font-bold">{editUsername}</div>
                    <div className="text-xs font-mono text-sky-400">
                      Passbox: {currentUser.personalPassbox}
                    </div>
                    <label
                      htmlFor="avatar-upload-input"
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                        darkMode
                          ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                          : 'border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-800'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload Photo</span>
                      <input
                        id="avatar-upload-input"
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                <div className="md:col-span-8 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="profile-username-input" className="block text-xs font-medium mb-1">
                        Display Name (2–50 characters)
                      </label>
                      <input
                        id="profile-username-input"
                        type="text"
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        className={`w-full px-3.5 py-2 text-sm rounded-lg border ${
                          darkMode
                            ? 'bg-slate-950 border-slate-800 text-slate-100'
                            : 'bg-slate-50 border-slate-300 text-slate-900'
                        }`}
                      />
                    </div>

                    <div>
                      <span className="block text-xs font-medium mb-1">
                        Public E2EE Key Fingerprint
                      </span>
                      <div
                        className={`px-3 py-2 rounded-lg border font-mono text-[11px] truncate ${
                          darkMode ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
                        }`}
                      >
                        {deriveSessionFingerprint(currentUser.personalPassbox).hexFingerprint}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="profile-bio-input" className="block text-xs font-medium mb-1">
                      Short Bio (visible to contacts and active chat peers)
                    </label>
                    <textarea
                      id="profile-bio-input"
                      rows={2}
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      className={`w-full px-3.5 py-2 text-sm rounded-lg border ${
                        darkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    />
                  </div>

                  {profileFeedback && (
                    <p className="text-xs font-medium text-emerald-400">{profileFeedback}</p>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs cursor-pointer"
                    >
                      Save Display Name, Bio & 3D Avatar
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
