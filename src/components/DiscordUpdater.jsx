import { useState, useEffect } from 'react';

const DISCORD_FACTS = [
  'Spinning the hamster wheels...',
  'Checking for updates...',
  'Warming up voice channels...',
  'Connecting to Discord Lite...',
  'Did you know? Discord Lite is super fast & native!'
];

export default function DiscordUpdater({ onFinished }) {
  const [status, setStatus] = useState('checking'); // 'checking' | 'found' | 'downloading' | 'installing' | 'upToDate' | 'ready'
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Checking for updates...');
  const [downloadStats, setDownloadStats] = useState('');
  const [factIndex, setFactIndex] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  // تدوير عبارات ديسكورد الطريفة أثناء الفحص
  useEffect(() => {
    const timer = setInterval(() => {
      setFactIndex((prev) => (prev + 1) % DISCORD_FACTS.length);
    }, 2200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let progressTimer;

    async function checkForUpdates() {
      // 1. هل يعمل التطبيق داخل بيئة Tauri للديسكتوب؟
      const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);

      if (!isTauri) {
        // في المتصفح العادي: تخطي فوري وسلس
        setTimeout(() => {
          if (!isMounted) return;
          setStatus('ready');
          setStatusText('Starting Discord Lite...');
          setTimeout(() => {
            setFadeOut(true);
            setTimeout(onFinished, 400);
          }, 600);
        }, 1000);
        return;
      }

      try {
        // 2. استدعاء مكتبة Tauri Auto-Updater
        const { check } = await import('@tauri-apps/plugin-updater');
        const { relaunch } = await import('@tauri-apps/plugin-process');

        setStatusText('Checking for updates...');
        const update = await check();

        if (update && update.available) {
          console.log('[Updater] Update found:', update.version);
          if (!isMounted) return;

          // إظهار تنبيه بوجود تحديث جديد باللغة الإنجليزية كما طلب المستخدم
          setStatus('found');
          setStatusText('Update Available! Preparing download...');

          // انتظار ثانية ونصف ليرى المستخدم تنبيه التحديث بوضوح
          await new Promise((r) => setTimeout(r, 1500));
          if (!isMounted) return;

          setStatus('downloading');
          setStatusText('Downloading Update...');

          let downloaded = 0;
          let contentLength = 0;

          await update.downloadAndInstall((event) => {
            switch (event.event) {
              case 'Started':
                contentLength = event.data.contentLength || 0;
                if (contentLength > 0) {
                  clearInterval(progressTimer);
                  progressTimer = undefined;
                  setProgress(0);
                } else {
                  progressTimer = setInterval(() => {
                    setProgress((current) => Math.min(current + 2, 95));
                  }, 250);
                }
                break;
              case 'Progress':
                downloaded += event.data.chunkLength;
                if (contentLength > 0) {
                  const percent = Math.min(100, Math.round((downloaded / contentLength) * 100));
                  const dlMb = (downloaded / (1024 * 1024)).toFixed(1);
                  const totalMb = (contentLength / (1024 * 1024)).toFixed(1);
                  setProgress(percent);
                  setStatusText(`Downloading Update... ${percent}%`);
                  setDownloadStats(`${dlMb} MB / ${totalMb} MB`);
                } else if (!progressTimer) {
                  progressTimer = setInterval(() => {
                    setProgress((current) => Math.min(current + 2, 95));
                  }, 250);
                }
                break;
              case 'Finished':
                clearInterval(progressTimer);
                progressTimer = undefined;
                setProgress(100);
                setStatus('installing');
                setStatusText('Installing update & restarting...');
                break;
            }
          });

          if ('caches' in window) {
            try {
              const cacheNames = await window.caches.keys();
              await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
            } catch (error) {
              console.warn('[Updater] Could not clear outdated web caches:', error);
            }
          }

          // إعادة تشغيل التطبيق بالنسخة الجديدة فوراً
          clearInterval(progressTimer);
          setProgress(100);
          setStatusText('Update complete! Restarting Discord Lite...');
          setTimeout(async () => {
            await relaunch();
          }, 1200);
        } else {
          // لا يوجد تحديث جديد (التطبيق بأحدث نسخة)
          if (!isMounted) return;
          setStatus('upToDate');
          setStatusText('Discord Lite is up to date!');
          setTimeout(() => {
            setFadeOut(true);
            setTimeout(onFinished, 500);
          }, 900);
        }
      } catch (err) {
        clearInterval(progressTimer);
        console.warn('[Updater] Check failed or offline:', err);
        if (!isMounted) return;
        setStatus('ready');
        setStatusText('Starting Discord Lite...');
        setTimeout(() => {
          setFadeOut(true);
          setTimeout(onFinished, 500);
        }, 800);
      }
    }

    checkForUpdates();

    return () => {
      isMounted = false;
      clearInterval(progressTimer);
    };
  }, [onFinished]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#111214] select-none transition-opacity duration-500 ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Background Ambient Glow */}
      <div className="absolute w-96 h-96 bg-[#5865f2]/15 rounded-full blur-3xl pointer-events-none animate-pulse" />

      {/* Discord Clyde Logo with Animation */}
      <div className="relative mb-6 flex items-center justify-center">
        <div className="absolute -inset-4 bg-[#5865f2]/20 rounded-full blur-xl animate-ping opacity-75" />
        <div
          className={`w-24 h-24 rounded-3xl bg-[#5865f2] flex items-center justify-center shadow-2xl shadow-[#5865f2]/40 relative z-10 transition-all duration-500 ${
            status === 'downloading' ? 'scale-105 shadow-[#23a55a]/40' : 'hover:scale-105'
          }`}
        >
          <svg className="w-14 h-14 text-white" viewBox="0 0 127.14 96.36" fill="currentColor">
            <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z" />
          </svg>
        </div>
      </div>

      {/* App Title */}
      <h1 className="text-white text-2xl font-black tracking-wider mb-2">
        Discord Lite
      </h1>

      {/* Badge when Update is Found */}
      {(status === 'found' || status === 'downloading') && (
        <div className="mb-3 px-3 py-1 rounded-full bg-[#23a55a]/20 border border-[#23a55a]/50 text-[#23a55a] text-xs font-bold tracking-wider uppercase animate-pulse flex items-center gap-1.5 shadow-lg shadow-[#23a55a]/20">
          <span className="w-2 h-2 rounded-full bg-[#23a55a] inline-block animate-ping" />
          <span>New Update Available</span>
        </div>
      )}

      {/* Status Text & Indicator */}
      <div className="flex items-center gap-2.5 text-sm text-[#dbdee1] font-medium mb-3">
        {(status === 'checking' || status === 'found') && (
          <div className="w-4 h-4 border-2 border-[#5865f2] border-t-transparent rounded-full animate-spin" />
        )}
        {status === 'downloading' && (
          <div className="w-4 h-4 border-2 border-[#23a55a] border-t-transparent rounded-full animate-spin" />
        )}
        {status === 'installing' && (
          <div className="w-4 h-4 border-2 border-[#f0b132] border-t-transparent rounded-full animate-spin" />
        )}
        {status === 'upToDate' && (
          <span className="text-[#23a55a] text-base font-bold">✓</span>
        )}
        <span>{statusText}</span>
      </div>

      {/* Progress Bar with Discord Theme */}
      {status === 'downloading' || status === 'installing' ? (
        <div className="flex flex-col items-center gap-1.5 mb-4">
          <div className="w-72 h-2.5 bg-[#1e1f22] rounded-full overflow-hidden p-0.5 border border-[#2b2d31] shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-[#5865f2] via-[#23a55a] to-[#23a55a] rounded-full transition-all duration-200 shadow-[0_0_10px_rgba(35,165,90,0.6)]"
              style={{ width: `${progress}%` }}
            />
          </div>
          {status === 'downloading' && downloadStats && (
            <span className="text-[11px] text-[#949ba4] font-medium">
              {downloadStats}
            </span>
          )}
        </div>
      ) : (
        <div className="w-48 h-1 bg-[#1e1f22] rounded-full overflow-hidden mb-4">
          <div className="w-full h-full bg-gradient-to-r from-transparent via-[#5865f2] to-transparent animate-pulse" />
        </div>
      )}

      {/* Discord Loading Joke / Fact */}
      <p className="text-xs text-[#949ba4] italic text-center max-w-xs transition-opacity duration-300">
        "{DISCORD_FACTS[factIndex]}"
      </p>
    </div>
  );
}
