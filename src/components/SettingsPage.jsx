import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Mic,
  MicOff,
  Headphones,
  Activity,
  User,
  Check,
  Shield,
  Bell,
  LogOut,
  Keyboard,
  Monitor,
  Wifi,
  Info,
  ChevronDown,
  Bluetooth,
  Volume2
} from 'lucide-react';
import { useVoice } from '../context/VoiceContext';
import { useAuth } from '../context/AuthContext';

const SIDEBAR_ITEMS = [
  { id: 'account',    label: 'My Account',      icon: User,     group: 'USER SETTINGS' },
  { id: 'voice',      label: 'Voice & Video',    icon: Mic,      group: 'APP SETTINGS'  },
  { id: 'notifs',     label: 'Notifications',    icon: Bell,     group: 'APP SETTINGS'  },
  { id: 'appearance', label: 'Appearance',       icon: Monitor,  group: 'APP SETTINGS'  },
  { id: 'privacy',    label: 'Privacy & Safety', icon: Shield,   group: 'APP SETTINGS'  },
  { id: 'keybinds',   label: 'Keybinds',         icon: Keyboard, group: 'APP SETTINGS'  },
];

export default function SettingsPage({ onClose }) {
  const [activeTab, setActiveTab] = useState('voice');
  const {
    microphones,
    speakers,
    selectedMic,
    selectedSpeaker,
    changeMicrophone,
    changeSpeaker,
    isNoiseSuppressionEnabled,
    toggleNoiseSuppression,
    updateAudioDevices,
  } = useVoice();
  const { user, signOut } = useAuth();

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = [...new Set(SIDEBAR_ITEMS.map(i => i.group))];

  // helper: label for selected device
  const micLabel    = microphones.find(m => m.deviceId === selectedMic)?.label    || 'Default Microphone';
  const speakerLabel = speakers.find(s => s.deviceId === selectedSpeaker)?.label  || 'Default Speaker';

  return (
    <div className="fixed inset-0 z-[200] flex bg-[#111214] animate-in fade-in duration-150">

      {/* ─── Left Sidebar ─── */}
      <div
        className="w-[236px] shrink-0 flex flex-col"
        style={{ background: 'linear-gradient(to right, #1e1f22 0%, #1e1f22 100%)' }}
      >
        {/* top spacer */}
        <div className="h-14" />
        <div className="flex-1 overflow-y-auto discord-scrollbar pr-1 pl-2 pb-6">
          {groups.map(group => (
            <div key={group} className="mb-1">
              <p className="text-[11px] font-bold tracking-widest text-[#80848e] uppercase px-2.5 pt-4 pb-1.5">
                {group}
              </p>
              {SIDEBAR_ITEMS.filter(i => i.group === group).map(item => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-sm font-medium transition-all cursor-pointer text-left ${
                      active
                        ? 'bg-[#404249] text-white'
                        : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'
                    }`}
                  >
                    <Icon size={16} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Divider + Log Out */}
          <div className="mt-2 pt-2 border-t border-[#2b2d31]/60">
            <button
              type="button"
              onClick={() => { signOut(); onClose(); }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-sm font-medium text-[#949ba4] hover:bg-[#35373c] hover:text-[#f23f43] transition cursor-pointer"
            >
              <span>Log Out</span>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* thin separator */}
      <div className="w-px bg-[#2b2d31] shrink-0" />

      {/* ─── Content Area ─── */}
      <div className="flex-1 flex flex-col bg-[#313338] min-w-0">
        <div className="flex-1 overflow-y-auto discord-scrollbar">
          <div className="max-w-[740px] mx-auto px-10 pt-14 pb-16">

            {/* ══════════════ VOICE & VIDEO ══════════════ */}
            {activeTab === 'voice' && (
              <div>
                {/* Page heading */}
                <h2 className="text-white text-xl font-semibold mb-8 pb-4 border-b border-[#3f4147]">
                  Voice &amp; Video
                </h2>

                {/* ── VOICE section ── */}
                <p className="text-xs font-bold tracking-widest text-[#949ba4] uppercase mb-5">Voice</p>

                {/* Microphone + Speaker row (side by side like Discord) */}
                <div className="flex gap-6 mb-8">
                  {/* Microphone */}
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-[#dbdee1] uppercase tracking-wide mb-2">
                      Microphone
                    </label>
                    <DeviceDropdown
                      devices={microphones}
                      selected={selectedMic}
                      label={micLabel}
                      onSelect={changeMicrophone}
                      onRefresh={updateAudioDevices}
                      iconType="mic"
                      placeholder="Default Microphone"
                    />
                  </div>

                  {/* Speaker */}
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-[#dbdee1] uppercase tracking-wide mb-2">
                      Speaker
                    </label>
                    <DeviceDropdown
                      devices={speakers}
                      selected={selectedSpeaker}
                      label={speakerLabel}
                      onSelect={changeSpeaker}
                      onRefresh={updateAudioDevices}
                      iconType="speaker"
                      placeholder="Default Speaker"
                    />
                  </div>
                </div>

                {/* ── NOISE SUPPRESSION section ── */}
                <div className="h-px bg-[#3f4147] mb-6" />
                <p className="text-xs font-bold tracking-widest text-[#949ba4] uppercase mb-5">Advanced</p>

                <div className="flex items-start justify-between gap-6 py-4 border-b border-[#3f4147]">
                  <div className="flex-1">
                    <p className="text-white text-sm font-semibold mb-1 flex items-center gap-2">
                      <Activity size={15} className={isNoiseSuppressionEnabled ? 'text-[#23a55a]' : 'text-[#80848e]'} />
                      AI Noise Suppression
                      {isNoiseSuppressionEnabled && (
                        <span className="text-[10px] bg-[#23a55a]/20 text-[#23a55a] px-1.5 py-0.5 rounded font-bold tracking-wide">
                          ON
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[#949ba4] leading-relaxed">
                      Filters background noise from your microphone and from incoming audio using a neural network (RNNoise) — applied on both ends of the call in real time.
                    </p>
                  </div>

                  {/* Toggle Switch */}
                  <button
                    type="button"
                    onClick={toggleNoiseSuppression}
                    aria-label="Toggle Noise Suppression"
                    className={`relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5865f2] mt-0.5 ${
                      isNoiseSuppressionEnabled ? 'bg-[#23a55a]' : 'bg-[#4f545c]'
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-all duration-200 ${
                        isNoiseSuppressionEnabled ? 'left-[22px]' : 'left-[3px]'
                      }`}
                    />
                  </button>
                </div>

                {/* Info note */}
                <div className="mt-4 flex items-start gap-2.5 p-3.5 bg-[#2b2d31] rounded-lg border border-[#3f4147]">
                  <Info size={14} className="text-[#5865f2] shrink-0 mt-0.5" />
                  <p className="text-[12px] text-[#949ba4] leading-relaxed">
                    Noise suppression uses <strong className="text-[#dbdee1]">RNNoise WASM</strong> — a lightweight neural network that runs entirely in your browser.
                    It works on <strong className="text-[#dbdee1]">both ends</strong> of the call for maximum clarity.
                    Disable it on low-end devices if you notice high CPU usage.
                  </p>
                </div>
              </div>
            )}

            {/* ══════════════ MY ACCOUNT ══════════════ */}
            {activeTab === 'account' && (
              <div>
                <h2 className="text-white text-xl font-semibold mb-8 pb-4 border-b border-[#3f4147]">
                  My Account
                </h2>

                {/* Profile card */}
                <div className="rounded-lg overflow-hidden border border-[#3f4147] mb-8">
                  {/* Banner */}
                  <div className="h-24 bg-gradient-to-r from-[#5865f2] to-[#7289da]" />
                  {/* Avatar row */}
                  <div className="bg-[#232428] px-6 pb-5 pt-0 flex items-end gap-4 relative">
                    <div className="-mt-10 w-20 h-20 rounded-full bg-[#5865f2] border-[5px] border-[#232428] flex items-center justify-center text-white text-2xl font-bold shrink-0 overflow-hidden">
                      {user?.avatar_url
                        ? <img src={user.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                        : (user?.display_name || user?.username || 'U').substring(0, 2).toUpperCase()
                      }
                    </div>
                    <div className="pb-1">
                      <p className="text-white font-bold text-lg leading-tight">{user?.display_name || user?.username}</p>
                      <p className="text-[#949ba4] text-sm">@{user?.username}</p>
                    </div>
                  </div>

                  {/* Info rows */}
                  <div className="bg-[#2b2d31] px-6 py-4 border-t border-[#3f4147] flex flex-col gap-4">
                    <InfoRow label="DISPLAY NAME"  value={user?.display_name || '—'} />
                    <InfoRow label="USERNAME"       value={`@${user?.username}`} />
                    <InfoRow label="EMAIL"          value={user?.email} />
                  </div>
                </div>
              </div>
            )}

            {/* ══════════════ PLACEHOLDER TABS ══════════════ */}
            {['notifs', 'appearance', 'privacy', 'keybinds'].includes(activeTab) && (
              <div className="flex flex-col items-center justify-center h-80 text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-[#2b2d31] flex items-center justify-center">
                  <Wifi size={28} className="text-[#5865f2]" />
                </div>
                <p className="text-white font-semibold text-lg">Under Development</p>
                <p className="text-[#949ba4] text-sm max-w-xs">
                  This settings section is coming soon!
                </p>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ─── Close Button (top-right) ─── */}
      <div className="absolute top-4 right-6 flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#f23f43] text-[#949ba4] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          title="Close (Esc)"
        >
          <X size={18} />
        </button>
        <span className="text-[10px] text-[#80848e] select-none">ESC</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   DeviceDropdown — Discord-style select dropdown
   ────────────────────────────────────────────── */
function DeviceDropdown({ devices, selected, label, onSelect, onRefresh, iconType, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const DeviceIcon = iconType === 'mic' ? Mic : Headphones;

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => { onRefresh?.(); setOpen(v => !v); }}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded bg-[#1e1f22] border text-sm text-[#dbdee1] cursor-pointer transition-colors hover:border-[#5865f2]/60 ${
          open ? 'border-[#5865f2]' : 'border-[#3f4147]'
        }`}
      >
        <DeviceIcon size={15} className="text-[#949ba4] shrink-0" />
        <span className="flex-1 truncate text-left">{label || placeholder}</span>
        <ChevronDown size={14} className={`text-[#949ba4] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-[#111214] border border-[#3f4147] rounded-lg shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
          <div className="max-h-52 overflow-y-auto discord-scrollbar py-1">
            {devices.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[#80848e] flex items-center gap-2">
                <DeviceIcon size={13} />
                {placeholder}
              </div>
            ) : (
              devices.map(device => {
                const isSel = device.deviceId === selected;
                return (
                  <button
                    key={device.deviceId}
                    type="button"
                    onClick={() => { onSelect(device.deviceId); setOpen(false); }}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer transition-colors text-left ${
                      isSel
                        ? 'bg-[#5865f2]/20 text-white'
                        : 'text-[#dbdee1] hover:bg-[#2b2d31] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <DeviceIcon size={13} className={isSel ? 'text-[#5865f2] shrink-0' : 'text-[#80848e] shrink-0'} />
                      <span className="truncate">{device.label}</span>
                    </div>
                    {isSel && <Check size={14} className="text-[#5865f2] shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────
   InfoRow
   ────────────────────────────────────────────── */
function InfoRow({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-bold tracking-widest text-[#949ba4] uppercase mb-1">{label}</p>
      <p className="text-white text-sm">{value}</p>
    </div>
  );
}
