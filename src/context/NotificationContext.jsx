/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { playMessageReceivedSound } from '../utils/soundEffects';

const NOTIFICATION_SETTINGS_KEY = 'dis_lite_notification_settings';

const DEFAULT_SETTINGS = {
  desktopNotifications: true,
  notificationSounds: true,
};

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
  const [settings, setSettings] = useState(readStoredSettings);
  const onOpenChatRef = useRef(onOpenChat);
  const handledMessageIdsRef = useRef(new Set());

  useEffect(() => {
    onOpenChatRef.current = onOpenChat;
  }, [onOpenChat]);

  useEffect(() => {
    if (
      settings.desktopNotifications &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      window.Notification.permission === 'default'
    ) {
      window.Notification.requestPermission().catch(() => {});
    }
  }, [settings.desktopNotifications]);

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

  const showNotification = useCallback(({ sender, content, fileUrl, id: messageId }) => {
    const notificationId = messageId || `${Date.now()}_${Math.random()}`;
    if (!claimMessageNotification(notificationId)) return;

    const currentSettings = readStoredSettings();

    if (currentSettings.notificationSounds) {
      playMessageReceivedSound();
    }

    const senderName = sender?.display_name || sender?.username || 'Friend';
    const displayBody = typeof content === 'string' && content.trim()
      ? content.trim()
      : fileUrl
        ? 'Sent an attachment'
        : 'Sent you a new message';

    // 1. إشعار سطح المكتب
    if (currentSettings.desktopNotifications) {
      if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        invoke('show_desktop_notification', {
          title: senderName,
          body: displayBody,
          avatarUrl: sender?.avatar_url || null,
          activationUrl: sender?.id && messageId
            ? `discordlite://message/${sender.id}/${messageId}`
            : null,
        }).catch((err) => console.warn('[Notifications] Tauri desktop notification failed:', err));
      } else if (typeof window !== 'undefined' && 'Notification' in window) {
        const triggerBrowserNotification = () => {
          try {
            const nativeNotif = new window.Notification(senderName, {
              body: displayBody,
              icon: sender?.avatar_url || '/favicon.svg',
              tag: `dm_${sender?.id || 'unknown'}`,
              silent: true,
            });
            nativeNotif.onclick = () => {
              window.focus();
              if (sender && onOpenChatRef.current) {
                onOpenChatRef.current(sender, messageId);
              }
              nativeNotif.close();
            };
          } catch (err) {
            console.warn('[Notifications] Native notification failed:', err);
          }
        };

        if (window.Notification.permission === 'granted') {
          triggerBrowserNotification();
        } else if (window.Notification.permission === 'default') {
          window.Notification.requestPermission().then((permission) => {
            if (permission === 'granted') triggerBrowserNotification();
          }).catch(() => {});
        }
      }
    }

  }, [claimMessageNotification]);

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
