import { useState, useRef, useEffect } from 'react';
import {
  X,
  Mic,
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
  ChevronDown
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

const NOISE_LEVEL_OPTIONS = [
  { id: 'standard', title: 'Standard', badge: 'Default', desc: 'Balanced. Removes typing, fans and background hum while keeping your voice natural.' },
  { id: 'strong', title: 'Strong', desc: 'A different AI model with a stricter filter. Cleaner in noisy rooms, but may clip quiet speech.' },
  { id: 'max', title: 'Maximum', desc: 'The strongest AI model with the strictest noise gate. Cuts the most background noise, but quiet speech may be clipped.' },
  { id: 'voiceFocus', title: 'Voice Focus (Silero VAD)', desc: 'GTCRN, device noise suppression, and Silero speech detection work together to reduce background noise and keyboard clicks while keeping speech audible.' },
];

export default function SettingsPage({ onClose }) {
  const [activeTab, setActiveTab] = useState('voice');
  const {
    microphones,
    speakers,
    selectedMic,
    selectedSpeaker,
    micVolume,
    speakerVolume,
    changeMicVolume,
    changeSpeakerVolume,
    changeMicrophone,
    changeSpeaker,
    isNoiseSuppressionEnabled,
    toggleNoiseSuppression,
    noiseLevel,
    changeNoiseLevel,
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
  const micLabel = selectedMic === 'default'
    ? 'Default Microphone'
    : microphones.find((mic) => mic.deviceId === selectedMic)?.label || 'Saved microphone unavailable';
  const speakerLabel = selectedSpeaker === 'default'
    ? 'Default Speaker'
    : speakers.find((speaker) => speaker.deviceId === selectedSpeaker)?.label || 'Saved speaker unavailable';

  return (
    <div
      className="settings-overlay-enter fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="User settings"
        className="settings-panel-enter relative flex h-[min(88vh,760px)] w-full max-w-[1120px] overflow-hidden rounded-xl border border-white/10 bg-[#0b0b0d] shadow-[0_24px_80px_rgba(0,0,0,0.8)]"
      >

      {/* ─── Left Sidebar ─── */}
      <div
        className="w-[190px] shrink-0 flex flex-col sm:w-[236px]"
        style={{ background: '#070708' }}
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
      <div className="flex-1 flex flex-col bg-[#0b0b0d] min-w-0">
        <div className="flex-1 overflow-y-auto discord-scrollbar">
          <div className="max-w-[740px] mx-auto px-5 pt-14 pb-12 sm:px-10 sm:pt-14 sm:pb-16">

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

                {/* ── Volume Sliders (Microphone Volume & Speaker Volume) like Discord ── */}
                <div className="flex gap-6 mb-7">
                  {/* Microphone Volume */}
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <label htmlFor="mic-volume-slider" className="text-xs font-semibold text-[#dbdee1] tracking-wide">
                        Microphone Volume
                      </label>
                      <span className="text-xs text-[#949ba4] font-medium tabular-nums">
                        {Math.round(micVolume * 100)}%
                      </span>
                    </div>
                    <div className="py-1">
                      <input
                        id="mic-volume-slider"
                        type="range"
                        min="0"
                        max="200"
                        step="1"
                        value={Math.round(micVolume * 100)}
                        onChange={(e) => changeMicVolume(Number(e.target.value) / 100)}
                        className="discord-volume-slider w-full"
                        style={{
                          background: `linear-gradient(to right, #5865f2 0%, #5865f2 ${(Math.round(micVolume * 100) / 200) * 100}%, #3b3d44 ${(Math.round(micVolume * 100) / 200) * 100}%, #3b3d44 100%)`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Speaker Volume */}
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <label htmlFor="speaker-volume-slider" className="text-xs font-semibold text-[#dbdee1] tracking-wide">
                        Speaker Volume
                      </label>
                      <span className="text-xs text-[#949ba4] font-medium tabular-nums">
                        {Math.round(speakerVolume * 100)}%
                      </span>
                    </div>
                    <div className="py-1">
                      <input
                        id="speaker-volume-slider"
                        type="range"
                        min="0"
                        max="200"
                        step="1"
                        value={Math.round(speakerVolume * 100)}
                        onChange={(e) => changeSpeakerVolume(Number(e.target.value) / 100)}
                        className="discord-volume-slider w-full"
                        style={{
                          background: `linear-gradient(to right, #5865f2 0%, #5865f2 ${(Math.round(speakerVolume * 100) / 200) * 100}%, #3b3d44 ${(Math.round(speakerVolume * 100) / 200) * 100}%, #3b3d44 100%)`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-[#80848e] -mt-4 mb-6">
                  Microphone volume and speaker volume settings are saved on this computer.
                </p>

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
                      Processes your microphone before it is sent. Every participant applies noise suppression on their own device; incoming audio is not filtered a second time.
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

                {isNoiseSuppressionEnabled && (
                  <div className="py-4 border-b border-[#3f4147]" role="radiogroup" aria-label="Noise suppression strength">
                    <p className="text-white text-sm font-semibold mb-3">Suppression strength</p>
                    <div className="grid gap-2">
                      {NOISE_LEVEL_OPTIONS.map((option) => {
                        const selected = noiseLevel === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => changeNoiseLevel(option.id)}
                            className={`text-left p-3 rounded-lg border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5865f2] ${
                              selected ? 'border-[#5865f2] bg-[#5865f2]/10' : 'border-[#3f4147] bg-[#2b2d31] hover:bg-[#313338]'
                            }`}
                          >
                            <span className="flex items-center gap-2 text-sm font-semibold text-white">
                              <span className={`w-3.5 h-3.5 rounded-full border-2 ${selected ? 'border-[#5865f2] bg-[#5865f2]' : 'border-[#80848e]'}`} />
                              {option.title}
                              {option.badge && (
                                <span className="text-[10px] bg-[#23a55a]/20 text-[#23a55a] px-1.5 py-0.5 rounded font-bold tracking-wide">
                                  {option.badge}
                                </span>
                              )}
                            </span>
                            <span className="block mt-1 ml-[22px] text-xs text-[#949ba4] leading-relaxed">{option.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-[#80848e] mt-3">
                      Saved on this computer. Changes apply immediately, even during a call.
                    </p>
                  </div>
                )}

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
      <div className="absolute right-4 top-3 z-10 flex flex-col items-center gap-1 sm:right-6">
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
      </section>
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
            <button
              type="button"
              onClick={() => { onSelect('default'); setOpen(false); }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer transition-colors text-left ${
                selected === 'default'
                  ? 'bg-[#5865f2]/20 text-white'
                  : 'text-[#dbdee1] hover:bg-[#2b2d31] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <DeviceIcon size={13} className={selected === 'default' ? 'text-[#5865f2] shrink-0' : 'text-[#80848e] shrink-0'} />
                <span className="truncate">{placeholder}</span>
              </div>
              {selected === 'default' && <Check size={14} className="text-[#5865f2] shrink-0" />}
            </button>
            {devices.length === 0 ? (
              null
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
