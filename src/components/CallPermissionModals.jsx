import { AppWindow, Mic, Monitor, ShieldCheck, Video } from 'lucide-react';

const modalPanel = 'w-full max-w-md rounded-2xl border border-[#2b2d31] bg-[#1e1f22] p-6 text-white shadow-2xl';
const secondaryButton = 'rounded-lg border border-[#3f4147] px-4 py-2 text-sm font-semibold text-[#dbdee1] transition hover:bg-white/[0.06]';
const primaryButton = 'rounded-lg bg-[#5865f2] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4752c4]';

export function MediaPermissionModal({ request, onContinue, onCancel }) {
  if (!request) return null;

  const isCamera = request.kind === 'camera';
  const Icon = isCamera ? Video : Mic;
  const deviceName = isCamera ? 'microphone and camera' : 'microphone';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section className={modalPanel} role="dialog" aria-modal="true" aria-labelledby="media-permission-title">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#5865f2]/15 text-[#aeb8ff]">
          <Icon size={24} />
        </div>
        <h2 id="media-permission-title" className="text-lg font-bold">Allow {deviceName} access</h2>
        <p className="mt-2 text-sm leading-6 text-[#b5bac1]">
          Discord Lite needs your {deviceName} to join the call. After you continue, Windows may show its
          secure permission prompt; choose Allow to proceed.
        </p>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#2b2d31] p-3 text-xs leading-5 text-[#b5bac1]">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#23a55a]" />
          <span>You can change device permissions later in Windows Settings.</span>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className={secondaryButton} onClick={onCancel}>Not now</button>
          <button type="button" className={primaryButton} onClick={onContinue}>Continue</button>
        </div>
      </section>
    </div>
  );
}

export function ScreenSharePicker({ open, onCancel, onSelect }) {
  if (!open) return null;

  const options = [
    { type: 'monitor', label: 'Entire screen', Icon: Monitor },
    { type: 'window', label: 'Application window', Icon: AppWindow },
  ];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section className={modalPanel} role="dialog" aria-modal="true" aria-labelledby="screen-share-title">
        <h2 id="screen-share-title" className="text-lg font-bold">Choose what to share</h2>
        <p className="mt-2 text-sm leading-6 text-[#b5bac1]">
          Choose a source type here. Windows will then open its secure chooser so you can select the exact
          screen or window to share.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {options.map(({ type, label, Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => onSelect(type)}
              className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-xl border border-[#3f4147] bg-[#2b2d31] px-4 py-5 text-sm font-semibold transition hover:border-[#7289ff] hover:bg-[#31343a]"
            >
              <Icon size={26} className="text-[#aeb8ff]" />
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className={secondaryButton} onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
