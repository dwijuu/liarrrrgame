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
      // 연결 성공 즉시 connected = true
      storeRef.current.setConnected(true);

      // 재연결 시 세션 복구
      const sessionId = localStorage.getItem('liar_session_id');
      const nickname = localStorage.getItem('liar_nickname');
      const avatar = localStorage.getItem('liar_avatar');
      const color = localStorage.getItem('liar_color');

      if (sessionId && nickname) {
        socket.emit('user:join', { sessionId, nickname, avatar, color }, (res: any) => {
          if (!res.error) {
            localStorage.setItem('liar_session_id', res.sessionId);
            storeRef.current.setUser(res);
            storeRef.current.setConnected(true); // 재확인
            if (res.roomId) {
              storeRef.current.setPage('room');
            } else if (storeRef.current.page === 'profile') {
              storeRef.current.setPage('lobby');
              socket.emit('lobby:subscribe');
            }
          }
        });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[소켓 끊김]', reason);
      storeRef.current.setConnected(false);
    });

    socket.on('reconnect', () => {
      toast('서버에 재연결되었습니다.', { icon: '✅' });
      storeRef.current.setConnected(true);
    });

    socket.on('connect_error', (err) => {
      console.log('[연결 오류]', err.message);
      // connected는 disconnect 이벤트에서만 false로 바꿈
      // connect_error 자체는 재시도 중이므로 false로 바꾸지 않음
    });

    // ── 방 이벤트 ────────────────────────────────────────────────────
    socket.on('room:state', (room: Room) => {
      storeRef.current.setRoom(room);
      const state = room.state;
      if (state === 'LOBBY') storeRef.current.setPage('room');
      else storeRef.current.setPage('game');
    });

    socket.on('room:player_joined', ({ player }: { player: Player }) => {
      const currentPlayers = storeRef.current.room?.players || [];
      if (!currentPlayers.find(p => p.userId === player.userId)) {
        storeRef.current.updateRoom({ players: [...currentPlayers, player] });
      }
      toast(`${player.nickname}님이 입장했습니다.`, { icon: '👋', duration: 2000 });
    });

    socket.on('room:player_update', ({ players }: { players: Player[] }) => {
      storeRef.current.updatePlayers(players);
    });

    socket.on('room:host_changed', ({ hostId, hostNickname }: { hostId: string; hostNickname: string }) => {
      storeRef.current.updateRoom({ hostId });
      toast(`${hostNickname}님이 방장이 되었습니다.`, { icon: '👑' });
    });

    socket.on('room:settings_updated', (settings: Partial<Room>) => {
      storeRef.current.updateRoom(settings);
    });

    socket.on('room:message', (msg: ChatMessage) => {
      storeRef.current.addMessage(msg);
    });

    socket.on('room:system_message', ({ text, type }: { text: string; type: string }) => {
      const msg: ChatMessage = {
        id: Date.now().toString() + Math.random(),
        type: 'system',
        subType: type,
        text,
        timestamp: Date.now(),
      };
      storeRef.current.addMessage(msg);
    });

    socket.on('room:closed', ({ message }: { message: string }) => {
      toast.error(message);
      storeRef.current.setRoom(null);
      storeRef.current.setSecretInfo(null);
      storeRef.current.setGameResult(null);
      storeRef.current.setPage('lobby');
      socket.emit('lobby:subscribe');
    });

    // ── 게임 이벤트 ───────────────────────────────────────────────────
    socket.on('game:started', (data: { state: string; players: Player[]; speakingOrder: string[] }) => {
      storeRef.current.updateRoom({ state: data.state as any });
      storeRef.current.setGameResult(null);
      storeRef.current.updateRoom({
        game: {
          state: data.state as any,
          speakingOrder: data.speakingOrder,
          currentSpeakerIndex: 0,
          speeches: [],
          voteEndTime: undefined,
          speakEndTime: undefined,
          discussionEndTime: undefined,
          revoteCount: 0,
          hasVoted: false,
          myVote: undefined,
          voteCount: 0,
          accusedLiars: [],
          guess: null,
          result: null,
          extendVoteActive: false,
          myExtendVote: undefined,
          extendVoteCount: 0,
        },
      });
    });

    socket.on('game:secret', (info: SecretInfo) => {
      storeRef.current.setSecretInfo(info);
      // 제시어 정보는 좌측 패널에서 항상 보이므로 toast 알림 제거
    });

    socket.on('game:phase_change', (data: Partial<GameState_Public> & { state: any }) => {
      const currentRoom = storeRef.current.room;
      storeRef.current.updateRoom({ state: data.state });
      if (currentRoom) {
        const currentGame = currentRoom.game || {} as GameState_Public;
        storeRef.current.updateRoom({
          game: {
            ...currentGame,
            ...data,
            extendVoteActive: (data as any).extendVoteActive ?? false,
          } as GameState_Public,
        });
      }
      const newState = data.state;
      if (newState !== 'LOBBY') {
        storeRef.current.setPage('game');
      }
    });

    socket.on('game:speech_added', (speech: Speech) => {
      storeRef.current.addSpeech(speech);
    });

    socket.on('game:speaker_changed', (data: {
      currentSpeakerIndex: number;
      currentSpeakerId: string;
      speakEndTime?: number;
    }) => {
      const currentGame = storeRef.current.room?.game;
      if (currentGame) {
        storeRef.current.updateRoom({
          game: {
            ...currentGame,
            currentSpeakerIndex: data.currentSpeakerIndex,
            speakEndTime: data.speakEndTime,
          },
        });
      }
    });

    socket.on('game:vote_cast', (data: { voterId: string; voteCount: number; totalPlayers: number }) => {
      const currentGame = storeRef.current.room?.game;
      if (currentGame) {
        storeRef.current.updateRoom({
          game: { ...currentGame, voteCount: data.voteCount },
        });
      }
    });

    socket.on('game:vote_result', (data: {
      result: string;
      accusedId?: string;
      accusedNickname?: string;
      accusedAvatar?: string;
      accusedColor?: string;
      isLiar?: boolean;
      tally?: Record<string, number>;
      revoteCount?: number;
      topTargets?: string[];
    }) => {
      storeRef.current.updateRoom({ state: 'VOTE_RESULT' });
      const currentGame = storeRef.current.room?.game;
      if (data.result === 'decided' && data.accusedId && currentGame) {
        storeRef.current.updateRoom({
          game: {
            ...currentGame,
            accusedLiars: [...(currentGame.accusedLiars || []), data.accusedId],
          },
        });
      } else if (data.result === 'tie') {
        toast('🤝 투표 동률! ' + (data.revoteCount ? '재투표 시작...' : '라이어 승리'), { duration: 4000 });
      } else if (data.result === 'no_votes') {
        toast('📭 유효한 투표가 없습니다. 라이어 승리!', { duration: 4000 });
      }
      // 지목 모달은 GamePage 내부에서 처리
    });

    socket.on('game:extend_vote_cast', (data: { userId: string; choice: string; extendVoteCount: number; totalPlayers: number }) => {
      const currentGame = storeRef.current.room?.game;
      if (currentGame) {
        storeRef.current.updateRoom({
          game: { ...currentGame, extendVoteCount: data.extendVoteCount },
        });
      }
    });

    socket.on('game:result', (result: GameResult) => {
      storeRef.current.setGameResult(result);
      storeRef.current.updateRoom({ state: 'GAME_RESULT' });
      if (result.winner === 'liar') {
        toast('🎭 라이어 승리!', { icon: '🏆', duration: 5000, style: { background: '#7c3aed', color: '#fff' } });
      } else {
        toast('✅ 시민 승리!', { icon: '🏆', duration: 5000, style: { background: '#059669', color: '#fff' } });
      }
    });

    socket.on('game:reset', ({ room }: { room: Room }) => {
      storeRef.current.setRoom(room);
      storeRef.current.setSecretInfo(null);
      storeRef.current.setGameResult(null);
      storeRef.current.setPage('room');
    });

    // ── 로비 이벤트 ───────────────────────────────────────────────────
    socket.on('lobby:room_added', (room: RoomListItem) => {
      storeRef.current.addRoom(room);
    });

    socket.on('lobby:room_updated', (room: RoomListItem) => {
      storeRef.current.updateRoomInList(room);
    });

    socket.on('lobby:room_removed', ({ roomId }: { roomId: string }) => {
      storeRef.current.removeRoomFromList(roomId);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('reconnect');
      socket.off('connect_error');
      socket.off('room:state');
      socket.off('room:player_joined');
      socket.off('room:player_update');
      socket.off('room:host_changed');
      socket.off('room:settings_updated');
      socket.off('room:message');
      socket.off('room:system_message');
      socket.off('room:closed');
      socket.off('game:started');
      socket.off('game:secret');
      socket.off('game:phase_change');
      socket.off('game:speech_added');
      socket.off('game:speaker_changed');
      socket.off('game:vote_cast');
      socket.off('game:vote_result');
      socket.off('game:extend_vote_cast');
      socket.off('game:result');
      socket.off('game:reset');
      socket.off('lobby:room_added');
      socket.off('lobby:room_updated');
      socket.off('lobby:room_removed');
    };
  }, []);
}
