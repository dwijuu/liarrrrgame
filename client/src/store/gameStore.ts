import { create } from 'zustand';
import type { Room, RoomListItem, SecretInfo, UserProfile, GameResult, ChatMessage, Player, Speech } from '../types';

interface GameStore {
  // 유저
  user: UserProfile | null;
  setUser: (user: UserProfile | null) => void;

  // 방
  room: Room | null;
  setRoom: (room: Room | null) => void;
  updateRoom: (partial: Partial<Room>) => void;

  // 방 목록
  roomList: RoomListItem[];
  setRoomList: (list: RoomListItem[]) => void;
  addRoom: (room: RoomListItem) => void;
  updateRoomInList: (room: RoomListItem) => void;
  removeRoomFromList: (roomId: string) => void;

  // 비밀 정보
  secretInfo: SecretInfo | null;
  setSecretInfo: (info: SecretInfo | null) => void;

  // 게임 결과
  gameResult: GameResult | null;
  setGameResult: (result: GameResult | null) => void;

  // 연결 상태
  connected: boolean;
  setConnected: (v: boolean) => void;

  // 페이지
  page: 'profile' | 'lobby' | 'room' | 'game';
  setPage: (p: 'profile' | 'lobby' | 'room' | 'game') => void;

  // 액션
  addMessage: (msg: ChatMessage) => void;
  updatePlayers: (players: Player[]) => void;
  addSpeech: (speech: Speech) => void;
  setVoteResult: (data: { accusedId: string; accusedNickname: string; isLiar: boolean; tally: Record<string, number> }) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  user: null,
  setUser: (user) => set({ user }),

  room: null,
  setRoom: (room) => set({ room }),
  updateRoom: (partial) => set(state => state.room ? { room: { ...state.room, ...partial } } : {}),

  roomList: [],
  setRoomList: (list) => set({ roomList: list }),
  addRoom: (room) => set(state => ({ roomList: [room, ...state.roomList] })),
  updateRoomInList: (room) => set(state => ({
    roomList: state.roomList.map(r => r.roomId === room.roomId ? room : r),
  })),
  removeRoomFromList: (roomId) => set(state => ({
    roomList: state.roomList.filter(r => r.roomId !== roomId),
  })),

  secretInfo: null,
  setSecretInfo: (info) => set({ secretInfo: info }),

  gameResult: null,
  setGameResult: (result) => set({ gameResult: result }),

  connected: false,
  setConnected: (v) => set({ connected: v }),

  page: 'profile',
  setPage: (p) => set({ page: p }),

  addMessage: (msg) => set(state => state.room ? {
    room: { ...state.room, messages: [...(state.room.messages || []).slice(-199), msg] }
  } : {}),

  updatePlayers: (players) => set(state => state.room ? {
    room: { ...state.room, players }
  } : {}),

  addSpeech: (speech) => set(state => {
    if (!state.room?.game) return {};
    return {
      room: {
        ...state.room,
        game: {
          ...state.room.game,
          speeches: [...state.room.game.speeches, speech],
        },
      },
    };
  }),

  setVoteResult: (data) => set(state => {
    if (!state.room?.game) return {};
    return {
      room: {
        ...state.room,
        game: {
          ...state.room.game,
          accusedLiars: [...state.room.game.accusedLiars, data.accusedId],
        },
      },
    };
  }),
}));
