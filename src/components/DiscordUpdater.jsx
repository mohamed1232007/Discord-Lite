import { useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, RotateCw } from 'lucide-react';
import { useVoice } from '../context/VoiceContext';

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export default function DiscordUpdater() {
  const { activeCall } = useVoice();
  const updateRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [version, setVersion] = useState('');
  const [deferred, setDeferred] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) return undefined;

    let disposed = false;
    let checking = false;
    let interval;

    const checkForUpdates = async () => {
      if (disposed || checking || updateRef.current) return;
      checking = true;
      let update;

      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        update = await check();
        if (!update) return;
        if (disposed) {
          await update.close();
          return;
        }

        setVersion(update.version);
        setStatus('downloading');
        let downloaded = 0;
        let contentLength = 0;

        await update.download((event) => {
          if (disposed) return;
          if (event.event === 'Started') {
            contentLength = event.data.contentLength || 0;
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
            }
          } else if (event.event === 'Finished') {
            setProgress(100);
          }
        });

        if (disposed) {
          await update.close();
          return;
        }

        updateRef.current = update;
        setStatus('ready');
      } catch (error) {
        if (update && update !== updateRef.current) {
          await update.close().catch((closeError) => {
            console.warn('[Updater] Could not release an incomplete update:', closeError);
          });
        }
        if (!disposed) {
          setStatus('idle');
          console.warn('[Updater] Background update check or download failed:', error);
        }
      } finally {
        checking = false;
      }
    };

    const initialCheck = window.setTimeout(() => {
      void checkForUpdates();
      interval = window.setInterval(() => {
        void checkForUpdates();
      }, UPDATE_CHECK_INTERVAL_MS);
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
      if (updateRef.current) {
        const pendingUpdate = updateRef.current;
        updateRef.current = null;
        void pendingUpdate.close().catch((error) => {
          console.warn('[Updater] Could not release the pending update:', error);
        });
      }
    };
  }, []);

  const restartToUpdate = async () => {
    if (installing || !updateRef.current) return;
    if (activeCall && !window.confirm('Restarting now will end your active call. Continue?')) return;

    setDeferred(false);
    setInstalling(true);
    setInstallError('');
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await updateRef.current.install({ restartAfterInstall: true });
      await relaunch();
    } catch (error) {
      setInstalling(false);
      setInstallError('The update could not be installed. Please try again later.');
      console.error('[Updater] Could not install the downloaded update:', error);
    }
  };

  if (status === 'idle') return null;

  return (
    <aside
      className="fixed bottom-4 right-4 z-[100] w-[min(92vw,360px)] rounded-2xl border border-white/10 bg-[#171923]/95 p-4 text-white shadow-2xl backdrop-blur-xl"
      aria-live="polite"
      aria-label="Application update"
    >
      {status === 'downloading' ? (
        <>
          <div className="flex items-center gap-3">
            <Download size={18} className="shrink-0 text-[#aeb8ff]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Downloading update in background</p>
              <p className="mt-1 text-xs text-white/55">Version {version} · {progress}%</p>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full rounded-full bg-[#7289ff] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      ) : deferred ? (
        <div className="flex items-center gap-3">
          <RotateCw size={18} className="shrink-0 text-[#aeb8ff]" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm font-semibold">Update {version} is ready</p>
          <button
            type="button"
            className="text-xs text-white/60 hover:text-white"
            onClick={() => setDeferred(false)}
          >
            Review
          </button>
          <button
            type="button"
            className="rounded-lg bg-[#5865f2] px-3 py-1.5 text-xs font-semibold hover:bg-[#4752c4]"
            onClick={restartToUpdate}
          >
            Restart
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {installing ? (
            <LoaderCircle size={18} className="shrink-0 animate-spin text-[#aeb8ff]" aria-hidden="true" />
          ) : (
            <RotateCw size={18} className="shrink-0 text-[#aeb8ff]" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {installing ? 'Installing update…' : `Update ${version} is ready`}
            </p>
            {installError && <p className="mt-1 text-xs text-red-300">{installError}</p>}
            {!installing && (
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  className="rounded-lg bg-[#5865f2] px-3 py-1.5 text-xs font-semibold hover:bg-[#4752c4] disabled:cursor-wait disabled:opacity-60"
                  onClick={restartToUpdate}
                  disabled={installing}
                >
                  Restart now
                </button>
                <button
                  type="button"
                  className="text-xs text-white/60 hover:text-white"
                  onClick={() => setDeferred(true)}
                >
                  Later
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
