import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

const AuthContext = createContext({});

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000/api';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('dis_lite_token'));
  const [loading, setLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState(new Set());

  // 1. جلب بيانات الحساب
  useEffect(() => {
    const fetchMe = async () => {
      const savedToken = localStorage.getItem('dis_lite_token');
      if (!savedToken) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${BACKEND_URL}/auth/me`, {
          headers: {
            'Authorization': `Bearer ${savedToken}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          localStorage.removeItem('dis_lite_token');
          setToken(null);
          setUser(null);
        }
      } catch (err) {
        console.error('Failed to authenticate with backend:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMe();
  }, []);

  // 2. تتبع الحضور الحقيقي بالثانية (Supabase Presence Tracking)
  // بمجرد فتح المتصفح يسجل أنه Online، وبمجرد قفل المتصفح أو التاب يتحول فوراً لـ Offline
  useEffect(() => {
    if (!user?.id) return;

    const presenceChannel = supabase.channel('online-users', {
      config: {
        presence: {
          key: user.id,
        },
      },
    });

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const activeIds = new Set(Object.keys(state));
        setOnlineUsers(activeIds);
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        setOnlineUsers((prev) => new Set([...prev, key]));
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        setOnlineUsers((prev) => {
          const updated = new Set(prev);
          updated.delete(key);
          return updated;
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            user_id: user.id,
            username: user.username,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      presenceChannel.unsubscribe();
    };
  }, [user?.id]);

  const signUp = async (email, password, username, displayName) => {
    const res = await fetch(`${BACKEND_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, username, displayName })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create account.');
    }

    localStorage.setItem('dis_lite_token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const signIn = async (email, password) => {
    const res = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to login.');
    }

    localStorage.setItem('dis_lite_token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const signOut = async () => {
    try {
      if (token) {
        await fetch(`${BACKEND_URL}/users/status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ status: 'offline' })
        });
      }
    } catch (e) {}

    localStorage.removeItem('dis_lite_token');
    localStorage.removeItem('dis_lite_view');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, onlineUsers, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
