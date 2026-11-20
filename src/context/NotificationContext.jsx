/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from './AuthContext';
import { BACKEND_URL } from '../services/backendUrl';
import { playMessageReceivedSound } from '../utils/soundEffects';
import { InAppToastContainer } from '../components/InAppNotificationToast';

const NOTIFICATION_SETTINGS_KEY = 'dis_lite_notification_settings';

const DEFAULT_SETTINGS = {
  desktopNotifications: true,
  notificationSounds: true,
};

function generateUserAvatarDataUrl(name) {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // خلفية شفافة بالكامل
    ctx.clearRect(0, 0, 128, 128);

    // دائرة أصغر متناسقة مع صورة المستخدم (نصف القطر 38 من 128)
    // خلفية شفافة/فاتحة ناعمة متناسقة مع بروفايل المستخدم
    ctx.fillStyle = '#e3e5e8';
    ctx.beginPath();
    ctx.arc(64, 64, 38, 0, Math.PI * 2);
    ctx.fill();

    // الحروف باللون الغامق المميز لليوزر تماماً مثل بروفايل ديسكورد
    const cleanName = (name || 'U').trim();
    const words = cleanName.split(/\s+/).filter(Boolean);
    let initials = '';
    if (words.length > 1) {
      initials = (words[0][0] + words[1][0]).toUpperCase();
    } else {
      initials = cleanName.substring(0, 2).toUpperCase();
    }

    ctx.fillStyle = '#111214';
    ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 64, 65);

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[Notifications] Failed to generate avatar data URL:', err);
    return null;
  }
}

function readStoredSettings() {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const NotificationContext = createContext(null);

export function NotificationProvider({ children, onOpenChat }) {
  const { token } = useAuth();
  const [settings, setSettings] = useState(readStoredSettings);
  const [inAppToasts, setInAppToasts] = useState([]);
  const onOpenChatRef = useRef(onOpenChat);
  const handledMessageIdsRef = useRef(new Set());
  const friendProfilesCacheRef = useRef({
    token: null,
    expiresAt: 0,
    profiles: null,
    pending: null,
  });

  useEffect(() => {
    onOpenChatRef.current = onOpenChat;
  }, [onOpenChat]);

  /** إضافة إشعار داخلي للقائمة */
  const pushInAppToast = useCallback((toast) => {
    setInAppToasts((prev) => {
      // نحتفظ بأقصى 5 إشعارات في نفس الوقت
      const next = [...prev, toast];
      return next.length > 5 ? next.slice(next.length - 5) : next;
    });
  }, []);

  /** مسح إشعار بعد الإغلاق أو النقر */
  const dismissInAppToast = useCallback((id) => {
    setInAppToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** فتح المحادثة عند النقر على الإشعار */
  const handleToastOpen = useCallback((sender, messageId) => {
    if (onOpenChatRef.current && sender) {
      onOpenChatRef.current(sender, messageId ?? null);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return undefined;
    if (window.Notification.permission !== 'default') return undefined;

    const enableNotificationsOnInteraction = () => {
      window.Notification.requestPermission().catch((err) => {
        console.warn('[Notifications] Permission request error:', err);
      });
      window.removeEventListener('click', enableNotificationsOnInteraction);
      window.removeEventListener('keydown', enableNotificationsOnInteraction);
    };

    window.addEventListener('click', enableNotificationsOnInteraction, { once: true });
    window.addEventListener('keydown', enableNotificationsOnInteraction, { once: true });

    return () => {
      window.removeEventListener('click', enableNotificationsOnInteraction);
      window.removeEventListener('keydown', enableNotificationsOnInteraction);
    };
  }, []);

  const updateSettings = useCallback((updates) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(next));
      } catch (err) {
        console.warn('[Notifications] Failed to save settings:', err);
      }
      return next;
    });
  }, []);

  const requestDesktopPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    if (window.Notification.permission === 'granted') return 'granted';
    try {
      const permission = await window.Notification.requestPermission();
      return permission;
    } catch (err) {
      console.warn('[Notifications] Permission request error:', err);
      return 'denied';
    }
  }, []);

  const claimMessageNotification = useCallback((messageId) => {
    const id = String(messageId || `${Date.now()}_${Math.random()}`);
    const handledIds = handledMessageIdsRef.current;
    if (handledIds.has(id)) return false;
    if (handledIds.size >= 500) {
      handledIds.delete(handledIds.values().next().value);
    }
    handledIds.add(id);
    return true;
  }, []);

  const resolveSenderProfile = useCallback(async (sender) => {
    if (sender?.avatar_url || sender?.avatarUrl || !sender?.id || !token) return sender;

    let cache = friendProfilesCacheRef.current;
    if (cache.token !== token) {
      cache = { token, expiresAt: 0, profiles: null, pending: null };
      friendProfilesCacheRef.current = cache;
    }

    if (!cache.profiles && !cache.pending || cache.expiresAt <= Date.now() && !cache.pending) {
      const request = (async () => {
        const response = await fetch(`${BACKEND_URL}/friends`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(`Could not load sender profiles (${response.status}).`);
        }

        const data = await response.json();
        const profiles = new Map(
          (Array.isArray(data.friends) ? data.friends : [])
            .filter((friend) => friend?.id)
            .map((friend) => [friend.id, friend]),
        );
        if (friendProfilesCacheRef.current.token === token) {
          friendProfilesCacheRef.current = {
            token,
            expiresAt: Date.now() + 30000,
            profiles,
            pending: null,
          };
        }
        return profiles;
      })();
      friendProfilesCacheRef.current = { ...cache, pending: request };
      cache = friendProfilesCacheRef.current;
    }

    try {
      const profiles = cache.pending ? await cache.pending : cache.profiles;
      return profiles?.get(sender.id) || sender;
    } catch (error) {
      if (cache.pending && friendProfilesCacheRef.current.pending === cache.pending) {
        friendProfilesCacheRef.current = {
          token,
          expiresAt: 0,
          profiles: null,
          pending: null,
        };
      }
      throw error;
    }
  }, [token]);

  const showNotification = useCallback(({ sender, content, fileUrl, id: messageId }) => {
    const notificationId = messageId || `${Date.now()}_${Math.random()}`;
    if (!claimMessageNotification(notificationId)) return;

    const currentSettings = readStoredSettings();

    if (currentSettings.notificationSounds) {
      playMessageReceivedSound();
    }

    const displayBody = typeof content === 'string' && content.trim()
      ? content.trim()
      : fileUrl
        ? 'Sent an attachment'
        : 'Sent you a new message';

    const presentNotification = async () => {
      let resolvedSender = sender;
      try {
        resolvedSender = await resolveSenderProfile(sender);
      } catch (error) {
        console.warn('[Notifications] Could not resolve sender profile:', error);
      }

      const senderName = resolvedSender?.display_name || resolvedSender?.username || 'Friend';
      let rawAvatarUrl = resolvedSender?.avatar_url || resolvedSender?.avatarUrl || null;
      if (rawAvatarUrl && typeof rawAvatarUrl === 'string') {
        rawAvatarUrl = rawAvatarUrl.trim();
        if (rawAvatarUrl.startsWith('/')) {
          rawAvatarUrl = `${BACKEND_URL}${rawAvatarUrl}`;
        }
      }

      if (currentSettings.desktopNotifications) {
        const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
        const windowFocused = typeof document !== 'undefined' && document.hasFocus();

        // بيانات الإشعار الداخلي (مشتركة بين الحالتين)
        const toastData = {
          id: notificationId,
          senderName,
          body: displayBody,
          avatarUrl: rawAvatarUrl || null,   // URL حقيقي فقط — الكومبوننت يرسم الحروف كـ fallback
          sender: resolvedSender,
          messageId: messageId ?? null,
        };

        if (isTauri) {
          const avatarUrl = (rawAvatarUrl && typeof rawAvatarUrl === 'string' && rawAvatarUrl.trim())
            ? rawAvatarUrl.trim()
            : generateUserAvatarDataUrl(senderName);
          invoke('show_desktop_notification', {
            title: senderName,
            body: displayBody,
            avatarUrl: avatarUrl || null,
            activationUrl: resolvedSender?.id && messageId
              ? `discordlite://message/${resolvedSender.id}/${messageId}`
              : null,
          }).catch((err) => console.warn('[Notifications] Tauri desktop notification failed:', err));

          if (windowFocused) {
            pushInAppToast(toastData);
          }
        } else {
          // المتصفح (Web):
          // المستخدم طلب: "المفروض تبقي بره بس واتاكد ان رساله المتصفح زي التطبيق"
          // تظهر في الويندوز بنسخة مطابقة للتطبيق عبر native notification فقط
          const avatarUrl = (rawAvatarUrl && typeof rawAvatarUrl === 'string' && rawAvatarUrl.trim())
            ? rawAvatarUrl.trim()
            : generateUserAvatarDataUrl(senderName);

          const hasNativeNotification = typeof window !== 'undefined' && 'Notification' in window;
          let shownNative = false;

          const triggerBrowserNotification = () => {
            try {
              const nativeNotif = new window.Notification(senderName, {
                body: displayBody,
                icon: avatarUrl || '/app-icon.png',
                badge: '/app-icon.png',
                tag: `dm_${resolvedSender?.id || 'unknown'}`,
                silent: true,
              });
              window.setTimeout(() => nativeNotif.close(), 6000);
              nativeNotif.onclick = () => {
                window.focus();
                if (resolvedSender && onOpenChatRef.current) {
                  onOpenChatRef.current(resolvedSender, messageId);
                }
                nativeNotif.close();
              };
              return true;
            } catch (err) {
              console.warn('[Notifications] Native browser notification failed:', err);
              return false;
            }
          };

          if (hasNativeNotification && window.Notification.permission === 'granted') {
            shownNative = triggerBrowserNotification();
          } else if (hasNativeNotification && window.Notification.permission === 'default') {
            window.Notification.requestPermission().then((permission) => {
              if (permission === 'granted') {
                triggerBrowserNotification();
              } else {
                pushInAppToast(toastData);
              }
            }).catch(() => {
              pushInAppToast(toastData);
            });
            return;
          }

          // لا نظهر الإشعار الداخلي (جوه الصفحة) إذا تم إرسال الإشعار الخارجي (بره المتصفح)
          // نظهره فقط كـ fallback إذا كان المتصفح لا يدعم أو حظر الإشعارات الخارجية
          if (!shownNative && (!hasNativeNotification || window.Notification.permission === 'denied')) {
            pushInAppToast(toastData);
          }
        }
      }
    };

    presentNotification().catch((error) => {
      console.error('[Notifications] Could not present message notification:', error);
    });

  }, [claimMessageNotification, resolveSenderProfile, pushInAppToast]);

  return (
    <NotificationContext.Provider
      value={{
        settings,
        updateSettings,
        requestDesktopPermission,
        showNotification,
      }}
    >
      {children}
      {/* إشعارات داخلية (ويب + Tauri لما النافذة مفتوحة) */}
      <InAppToastContainer
        toasts={inAppToasts}
        onDismiss={dismissInAppToast}
        onOpen={handleToastOpen}
      />
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
}
