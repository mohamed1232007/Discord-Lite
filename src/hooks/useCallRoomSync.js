import { useEffect, useRef } from 'react';
import { callApi } from '../services/callApi';

export const useCallRoomSync = ({
  token,
  userId,
  activeRoomId,
  incomingRoomId,
  onInvitation,
  onActiveRoom,
  onIncomingRoomEnded,
  onActiveRoomEnded,
}) => {
  const callbacksRef = useRef({});
  useEffect(() => {
    callbacksRef.current = {
      onInvitation,
      onActiveRoom,
      onIncomingRoomEnded,
      onActiveRoomEnded,
    };
  });

  useEffect(() => {
    if (!userId || !token || activeRoomId || incomingRoomId) return undefined;
    let checking = false;
    const checkForInvitation = async () => {
      if (checking) return;
      checking = true;
      try {
        const { invitation } = await callApi(token, '/invitations');
        if (invitation) callbacksRef.current.onInvitation?.(invitation);
      } catch (error) {
        console.error('[Call] Failed to check incoming calls:', error);
      } finally {
        checking = false;
      }
    };

    checkForInvitation();
    const timer = window.setInterval(checkForInvitation, 2500);
    return () => window.clearInterval(timer);
  }, [activeRoomId, incomingRoomId, token, userId]);

  useEffect(() => {
    if (!activeRoomId || !token) return undefined;
    let checking = false;
    const syncActiveRoom = async () => {
      if (checking) return;
      checking = true;
      try {
        const roomData = await callApi(token, `/${activeRoomId}`);
        if (roomData.room.status === 'ended') {
          callbacksRef.current.onActiveRoomEnded?.();
        } else {
          callbacksRef.current.onActiveRoom?.(roomData);
        }
      } catch (error) {
        console.error('[Call] Failed to synchronize call room:', error);
      } finally {
        checking = false;
      }
    };

    syncActiveRoom();
    const timer = window.setInterval(syncActiveRoom, 2500);
    return () => window.clearInterval(timer);
  }, [activeRoomId, token]);

  useEffect(() => {
    if (!incomingRoomId || !token || activeRoomId) return undefined;
    let checking = false;
    const checkIncomingRoom = async () => {
      if (checking) return;
      checking = true;
      try {
        const { room } = await callApi(token, `/${incomingRoomId}`);
        if (room.status === 'ended') callbacksRef.current.onIncomingRoomEnded?.();
      } catch (error) {
        console.error('[Call] Failed to check incoming call status:', error);
      } finally {
        checking = false;
      }
    };

    checkIncomingRoom();
    const timer = window.setInterval(checkIncomingRoom, 2500);
    return () => window.clearInterval(timer);
  }, [activeRoomId, incomingRoomId, token]);
};
