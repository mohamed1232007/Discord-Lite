import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AuthProvider, useAuth } from './context/AuthContext';
import { VoiceProvider, useVoice } from './context/VoiceContext';
import { ToastProvider } from './context/ToastContext';
import { NotificationProvider } from './context/NotificationContext';
import { ThemeProvider, useAppearanceTheme } from './context/ThemeContext';
import { THEME_OPTIONS } from './context/themeOptions';
import ServerSidebar from './components/ServerSidebar';
import DMSidebar from './components/DMSidebar';
import FriendsView from './components/FriendsView';
import ChatView from './components/ChatView';
import CallOverlay from './components/CallOverlay';
import DiscordUpdater from './components/DiscordUpdater';
import { BACKEND_URL } from './services/backendUrl';

// الشاشات الثقيلة تُحمّل عند الحاجة فقط لتقليل حجم الحزمة الأساسية
const CallScreen = lazy(() => import('./components/CallScreen'));
const LandingPage = lazy(() => import('./components/LandingPage'));
const LoginPage = lazy(() => import('./components/LoginPage'));

function LoadingScreen() {
  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[#05060b] px-5 text-white select-none">
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-[#0b0d1a] via-[#05060b] to-black" />
      <div aria-hidden="true" className="loading-orb pointer-events-none absolute -left-20 top-[16%] h-72 w-72 rounded-full bg-[#5865f2]/15 blur-[100px]" />
      <div aria-hidden="true" className="loading-orb loading-orb-two pointer-events-none absolute bottom-[8%] right-[12%] h-72 w-72 rounded-full bg-[#8b5cf6]/[0.12] blur-[110px]" />
      <div aria-hidden="true" className="loading-orb loading-orb-three pointer-events-none absolute right-[22%] top-[12%] h-44 w-44 rounded-full bg-[#67e8f9]/[0.08] blur-[90px]" />

      <div className="loading-glass-card relative w-full max-w-97.5 overflow-hidden rounded-[28px] bg-white/5.5 px-8 py-9 shadow-[0_28px_90px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
        <div className="relative flex flex-col items-center gap-8">
          <div className="flex items-center justify-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-white/20 bg-linear-to-br from-[#7884ff] to-[#5865f2] shadow-[0_8px_28px_rgba(88,101,242,0.32)]">
              <svg className="h-9 w-9 fill-white" viewBox="0 0 127.14 96.36" aria-hidden="true">
                <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z" />
              </svg>
            </div>
            <p className="text-xl font-semibold tracking-wide">Discord Lite</p>
          </div>
          <div className="w-full">
            <p className="mb-3 text-center text-sm text-white/65" role="status" aria-live="polite">
              Getting everything ready
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10 ring-1 ring-inset ring-white/6" role="progressbar" aria-label="Loading">
              <div className="app-loading-progress h-full rounded-full bg-linear-to-r from-[#7581ff] via-[#5865f2] to-[#8c74ff] shadow-[0_0_14px_rgba(88,101,242,0.7)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenFallback() {
  return <LoadingScreen />;
}

function MainApp({ deferredUpdate, onOpenUpdate }) {
  const { user, token, loading } = useAuth();
  const { resolvedTheme } = useAppearanceTheme();
  const { activeCall } = useVoice();
  // فحص التحديثات يعمل داخل Tauri فقط، ولا يتداخل مع نسخة المتصفح
  const isTauriApp = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
  // الصفحة المطلوبة من المستخدم (landing / login / app) مع حفظها للزيارة القادمة
  const [requestedView, setRequestedView] = useState(() => {
    const token = localStorage.getItem('dis_lite_token');
    if (token) return 'app';
    if (isTauriApp) return 'login';
    return window.location.pathname === '/login' ? 'login' : 'landing';
  });

  const changeView = useCallback((view, { replace = false } = {}) => {
    setRequestedView(view);

    if (isTauriApp) return;
    const path = view === 'login' ? '/login' : '/';
    if (window.location.pathname !== path) {
      const updateHistory = replace ? 'replaceState' : 'pushState';
      window.history[updateHistory]({ view }, '', path);
    }
  }, [isTauriApp]);

  useEffect(() => {
    if (isTauriApp) return undefined;

    const handlePopState = () => {
      const view = window.location.pathname === '/login' ? 'login' : 'landing';
      setRequestedView(view);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isTauriApp]);

  // الصفحة الفعلية مشتقة من حالة الدخول بدل تعديل الـ state داخل useEffect
  // (يمنع الـ re-render المزدوج ويمنع الدوران في حلقة تحديث)
  const currentView = user
    ? 'app'
    : (isTauriApp ? 'login' : (requestedView === 'landing' ? 'landing' : 'login'));

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!user) {
      delete root.dataset.appTheme;
      root.style.removeProperty('color-scheme');
      return;
    }

    root.dataset.appTheme = resolvedTheme;
    root.style.colorScheme = ['light', 'ash'].includes(resolvedTheme) ? 'light' : 'dark';

    return () => {
      delete root.dataset.appTheme;
      root.style.removeProperty('color-scheme');
    };
  }, [user, resolvedTheme]);

  useEffect(() => {
    if (!isTauriApp) return undefined;

    const backgroundColor = user
      ? THEME_OPTIONS.find((theme) => theme.id === resolvedTheme)?.swatch
      : '#000000';
    if (!backgroundColor) {
      console.error(`[Appearance] No desktop background color is defined for "${resolvedTheme}".`);
      return undefined;
    }

    let cancelled = false;
    const updateDesktopBackground = async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        if (!cancelled) {
          await getCurrentWebviewWindow().setBackgroundColor(backgroundColor);
        }
      } catch (error) {
        console.error('[Appearance] Could not update the desktop window background:', error);
      }
    };

    void updateDesktopBackground();
    return () => {
      cancelled = true;
    };
  }, [isTauriApp, user, resolvedTheme]);

  const [activeTab, setActiveTab] = useState('dm');
  const [selectedChat, setSelectedChat] = useState(null);
  const [targetMessageId, setTargetMessageId] = useState(null);
  const [notificationTarget, setNotificationTarget] = useState(null);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const openingNotificationTargetRef = useRef(null);

  const openChat = useCallback((chat, messageId = null) => {
    setSelectedChat(chat);
    setIsChatVisible(!!chat);
    setTargetMessageId(chat ? messageId : null);
  }, []);

  useEffect(() => {
    if (!isTauriApp) return undefined;

    let disposed = false;
    let unlisten;
    const listenForNotificationTargets = async () => {
      try {
        unlisten = await listen('notification-open', (event) => {
          setNotificationTarget(event.payload);
        });
        if (disposed) {
          unlisten();
          return;
        }

        const target = await invoke('take_notification_target');
        if (!disposed && target) setNotificationTarget(target);
      } catch (error) {
        console.error('[Notifications] Could not initialize notification navigation:', error);
      }
    };

    void listenForNotificationTargets();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isTauriApp]);

  useEffect(() => {
    if (!notificationTarget || !token) return;
    const targetKey = `${notificationTarget.friendId}:${notificationTarget.messageId}`;
    if (openingNotificationTargetRef.current === targetKey) return;
    openingNotificationTargetRef.current = targetKey;

    const openNotificationDestination = async () => {
      try {
        // 1. فتح فوري بدون أي تأخير إذا كان الصديق مخزن مسبقاً
        let friend = null;
        try {
          const cached = JSON.parse(window.localStorage.getItem('dis_lite_friends_cache') || '[]');
          friend = cached.find((c) => c.id === notificationTarget.friendId) || null;
        } catch (cacheErr) {
          console.warn('[Notifications] Could not read cached friends:', cacheErr);
        }

        if (friend) {
          setActiveTab('dm');
          openChat(friend, notificationTarget.messageId);
          return;
        }

        // 2. وإذا لم يكن في الكاش، نجلبه من السيرفر ونفتح المحادثة
        const response = await fetch(`${BACKEND_URL}/friends`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(`Could not load friends (${response.status}).`);
        }

        const { friends = [] } = await response.json();
        friend = friends.find((candidate) => candidate.id === notificationTarget.friendId);
        if (!friend) {
          throw new Error('The sender is no longer available in your friends list.');
        }

        setActiveTab('dm');
        openChat(friend, notificationTarget.messageId);
      } catch (error) {
        console.error('[Notifications] Could not open the message destination:', error);
      } finally {
        openingNotificationTargetRef.current = null;
        setNotificationTarget((current) => (
          current?.friendId === notificationTarget.friendId
          && current?.messageId === notificationTarget.messageId
            ? null
            : current
        ));
      }
    };

    openNotificationDestination();
  }, [notificationTarget, token, openChat]);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <Suspense fallback={<ScreenFallback />}>
      {currentView === 'landing' ? (
        <LandingPage
          deferredUpdate={deferredUpdate}
          onOpenUpdate={onOpenUpdate}
          onOpenApp={() => changeView('app')}
          onOpenLogin={() => {
            if (user) {
              changeView('app');
            } else {
              changeView('login');
            }
          }}
        />
      ) : currentView === 'login' ? (
        <LoginPage
          deferredUpdate={deferredUpdate}
          onOpenUpdate={onOpenUpdate}
          onBackToLanding={isTauriApp ? undefined : () => changeView('landing')}
          onSuccess={() => changeView('app', { replace: true })}
        />
      ) : (
        <NotificationProvider onOpenChat={openChat}>
          <div className="flex h-screen w-screen overflow-hidden bg-[#000000] text-[#dbdee1] font-sans antialiased flex-col">
            {/* إشعار الرنين الوارد للمكالمات */}
            <CallOverlay onCallStarted={() => setIsChatVisible(false)} />

            <div className="flex-1 flex overflow-hidden">
              {/* 1. Leftmost Server Sidebar الثابت (بدون زر هوم كما طلبت) */}
              <ServerSidebar
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              />

              {/* 2. القائمة الجانبية الأصلية للرسائل والأصدقاء */}
              <DMSidebar
                selectedChat={selectedChat}
                isChatVisible={isChatVisible}
                onSelectChat={openChat}
                onShowCall={() => setIsChatVisible(false)}
                onOpenAuth={() => changeView('login')}
              />

              {/* 3. الجانب الأيمن: شاشة الكول الكبيرة أو الشات أو الأصدقاء */}
              {activeCall ? (
                <div className={!isChatVisible ? 'flex min-w-0 flex-1' : 'hidden'}>
                  <Suspense fallback={<ScreenFallback />}>
                    <CallScreen
                      deferredUpdate={deferredUpdate}
                      onOpenUpdate={onOpenUpdate}
                      onOpenChat={(participant) => {
                      const chatUser = participant?.id ? participant : activeCall.friend;
                      if (chatUser?.id) openChat(chatUser);
                      }}
                    />
                  </Suspense>
                </div>
              ) : null}

              {selectedChat ? (
                <div className={activeCall && !isChatVisible ? 'hidden' : 'flex min-w-0 flex-1 transition-opacity duration-200 ease-out'}>
                  <ChatView
                    key={selectedChat.id}
                    user={selectedChat}
                    targetMessageId={targetMessageId}
                    deferredUpdate={deferredUpdate}
                    onOpenUpdate={onOpenUpdate}
                    onBack={() => openChat(null)}
                    onCallStarted={() => setIsChatVisible(false)}
                  />
                </div>
              ) : !activeCall ? (
                <FriendsView
                  onStartChat={openChat}
                  deferredUpdate={deferredUpdate}
                  onOpenUpdate={onOpenUpdate}
                />
              ) : null}
            </div>
          </div>
        </NotificationProvider>
      )}
    </Suspense>
  );
}

function AppContent() {
  const [deferredUpdate, setDeferredUpdate] = useState(false);
  const openUpdate = useCallback(() => setDeferredUpdate(false), []);

  return (
    <>
      <DiscordUpdater
        deferredUpdate={deferredUpdate}
        setDeferredUpdate={setDeferredUpdate}
      />
      <MainApp
        deferredUpdate={deferredUpdate}
        onOpenUpdate={openUpdate}
      />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <VoiceProvider>
            <AppContent />
          </VoiceProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
