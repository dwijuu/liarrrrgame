import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { connectSocket, getSocket } from '../utils/socket';
import { useGameStore } from '../store/gameStore';
import type { Room, RoomListItem, SecretInfo, GameResult, ChatMessage, Player, Speech, GameState_Public } from '../types';

export function useSocketEvents() {
  const store = useGameStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    const socket = connectSocket();

    socket.on('connect', () => {
      storeRef.current.setConnected(true);
      const sessionId = localStorage.getItem('liar_session_id');
      const nickname = localStorage.getItem('liar_nickname');
      const avatar = localStorage.getItem('liar_avatar');
      const color = localStorage.getItem('liar_color');
      if (sessionId && nickname) {
        socket.emit('user:join', { sessionId, nickname, avatar, color }, (res: any) => {
          if (!res.error) {
            localStorage.setItem('liar_session_id', res.sessionId);
            storeRef.current.setUser(res);
            storeRef.current.setConnected(true);
            if (res.roomId) storeRef.current.setPage('room');
            else if (storeRef.current.page === 'profile') {
              storeRef.current.setPage('lobby');
              socket.emit('lobby:subscribe');
            }
          }
        });
      }
    });

    socket.on('disconnect', () => { storeRef.current.setConnected(false); });
    socket.on('reconnect', () => { toast('재연결됨', { icon: '✅' }); storeRef.current.setConnected(true); });
    socket.on('connect_error', () => { /* 재시도 중, connected 유지 */ });

    // ── 방 이벤트 ──────────────────────────────────────────────
    socket.on('room:state', (room: Room) => {
      storeRef.current.setRoom(room);
      if (room.state === 'LOBBY') storeRef.current.setPage('room');
      else storeRef.current.setPage('game');
    });
    socket.on('room:player_joined', ({ player }: { player: Player }) => {
      const cur = storeRef.current.room?.players || [];
      if (!cur.find(p => p.userId === player.userId))
        storeRef.current.updateRoom({ players: [...cur, player] });
      toast(`${player.nickname}님 입장`, { icon: '👋', duration: 2000 });
    });
    socket.on('room:player_update', ({ players }: { players: Player[] }) => {
      storeRef.current.updatePlayers(players);
    });
    socket.on('room:host_changed', ({ hostId, hostNickname }: any) => {
      storeRef.current.updateRoom({ hostId });
      toast(`${hostNickname}님이 방장이 되었습니다.`, { icon: '👑' });
    });
    socket.on('room:settings_updated', (settings: Partial<Room>) => {
      storeRef.current.updateRoom(settings);
    });
    socket.on('room:message', (msg: ChatMessage) => { storeRef.current.addMessage(msg); });
    socket.on('room:system_message', ({ text, type }: any) => {
      storeRef.current.addMessage({ id: Date.now().toString(), type: 'system', subType: type, text, timestamp: Date.now() });
    });
    socket.on('room:closed', ({ message }: any) => {
      toast.error(message);
      storeRef.current.setRoom(null); storeRef.current.setSecretInfo(null);
      storeRef.current.setGameResult(null); storeRef.current.setPage('lobby');
      socket.emit('lobby:subscribe');
    });

    // ── 게임 이벤트 ────────────────────────────────────────────
    socket.on('game:started', (data: any) => {
      storeRef.current.updateRoom({ state: data.state });
      storeRef.current.setGameResult(null);
      storeRef.current.updateRoom({
        game: {
          state: data.state, speakingOrder: data.speakingOrder,
          currentSpeakerIndex: 0, speeches: [],
          hasVoted: false, voteCount: 0, quickVoteCount: 0,
          accusedLiars: [], guess: null, result: null,
          roundCount: data.roundCount || 1,
        } as GameState_Public,
      });
    });

    socket.on('game:secret', (info: SecretInfo) => {
      storeRef.current.setSecretInfo(info);
      // 제시어 표시 toast 제거 - 화면에서 직접 확인
    });

    socket.on('game:phase_change', (data: any) => {
      storeRef.current.updateRoom({ state: data.state });
      const cur = storeRef.current.room?.game || {} as GameState_Public;
      storeRef.current.updateRoom({ game: { ...cur, ...data } as GameState_Public });
      if (data.state !== 'LOBBY') storeRef.current.setPage('game');

      // 라운드 재시작 알림
      if (data.state === 'ROLE_ASSIGNMENT' && data.roundCount > 1) {
        toast(`🔄 라운드 ${data.roundCount} 시작!`, { duration: 3000 });
      }
    });

    socket.on('game:round_restart', (data: any) => {
      const cur = storeRef.current.room?.game || {} as GameState_Public;
      storeRef.current.updateRoom({
        state: 'ROLE_ASSIGNMENT',
        game: { ...cur, state: 'ROLE_ASSIGNMENT', speakingOrder: data.speakingOrder, roundCount: data.roundCount, speeches: [], quickVoteCount: 0, defenseText: null, eliminateCount: 0, spareCount: 0 } as GameState_Public,
      });
      toast(`🔄 동률/살리기! 라운드 ${data.roundCount} 시작`, { duration: 4000 });
    });

    socket.on('game:speech_added', (speech: Speech) => {
      storeRef.current.addSpeech(speech);
    });
    socket.on('game:speaker_changed', (data: any) => {
      const cur = storeRef.current.room?.game;
      if (cur) storeRef.current.updateRoom({ game: { ...cur, currentSpeakerIndex: data.currentSpeakerIndex, speakEndTime: data.speakEndTime } });
    });
    socket.on('game:vote_cast', (data: any) => {
      const cur = storeRef.current.room?.game;
      if (cur) storeRef.current.updateRoom({ game: { ...cur, voteCount: data.voteCount } });
    });
    socket.on('game:vote_result', (data: any) => {
      storeRef.current.updateRoom({ state: 'VOTE_RESULT' });
      const cur = storeRef.current.room?.game;
      if (data.result === 'decided' && data.accusedId && cur) {
        storeRef.current.updateRoom({ game: { ...cur, accusedLiars: [...(cur.accusedLiars || []), data.accusedId] } });
      }
      if (data.result === 'tie') toast('🤝 동률! 라운드를 다시 시작합니다.', { duration: 4000 });
    });

    socket.on('game:quick_vote_cast', (data: any) => {
      const cur = storeRef.current.room?.game;
      if (cur) storeRef.current.updateRoom({ game: { ...cur, quickVoteCount: data.quickVoteCount } });
    });
    socket.on('game:defense_submitted', (data: any) => {
      const cur = storeRef.current.room?.game;
      if (cur) storeRef.current.updateRoom({ game: { ...cur, defenseText: data.text } });
    });
    socket.on('game:elimination_vote_cast', (data: any) => {
      const cur = storeRef.current.room?.game;
      if (cur) storeRef.current.updateRoom({ game: { ...cur, eliminateCount: data.eliminateCount, spareCount: data.spareCount } });
    });
    socket.on('game:elimination_result', (data: any) => {
      // GamePage에서 직접 처리
    });

    socket.on('game:result', (result: GameResult) => {
      storeRef.current.setGameResult(result);
      storeRef.current.updateRoom({ state: 'GAME_RESULT' });
      if (result.winner === 'liar') toast('🎭 라이어 승리!', { duration: 5000, style: { background: '#7c3aed', color: '#fff' } });
      else toast('✅ 시민 승리!', { duration: 5000, style: { background: '#059669', color: '#fff' } });
    });

    socket.on('game:reset', ({ room }: { room: Room }) => {
      storeRef.current.setRoom(room); storeRef.current.setSecretInfo(null);
      storeRef.current.setGameResult(null); storeRef.current.setPage('room');
    });

    // ── 로비 이벤트 ────────────────────────────────────────────
    socket.on('lobby:room_added', (r: RoomListItem) => storeRef.current.addRoom(r));
    socket.on('lobby:room_updated', (r: RoomListItem) => storeRef.current.updateRoomInList(r));
    socket.on('lobby:room_removed', ({ roomId }: any) => storeRef.current.removeRoomFromList(roomId));

    return () => {
      const events = [
        'connect', 'disconnect', 'reconnect', 'connect_error',
        'room:state', 'room:player_joined', 'room:player_update', 'room:host_changed',
        'room:settings_updated', 'room:message', 'room:system_message', 'room:closed',
        'game:started', 'game:secret', 'game:phase_change', 'game:round_restart',
        'game:speech_added', 'game:speaker_changed', 'game:vote_cast', 'game:vote_result',
        'game:quick_vote_cast', 'game:defense_submitted', 'game:elimination_vote_cast',
        'game:elimination_result', 'game:result', 'game:reset',
        'lobby:room_added', 'lobby:room_updated', 'lobby:room_removed',
      ];
      events.forEach(e => socket.off(e));
    };
  }, []);
}
