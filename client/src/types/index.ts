export type GameState =
  | 'LOBBY' | 'ROLE_ASSIGNMENT' | 'SPEAKING' | 'DISCUSSION'
  | 'VOTING' | 'VOTE_RESULT' | 'DEFENSE' | 'ELIMINATION_VOTE'
  | 'GUESSING' | 'GAME_RESULT' | 'FINISHED';

export type GameMode = 'NORMAL' | 'FOOL';
export type SpeakingMode = 'SEQUENTIAL' | 'FREE';
export type TieRule = 'LIAR_WINS' | 'REVOTE';

export interface Player {
  userId: string; nickname: string; avatar: string; color: string;
  isHost: boolean; connected: boolean;
}
export interface Speech {
  userId: string; nickname: string; avatar: string; color: string;
  text: string; timestamp: number; timedOut?: boolean;
}
export interface ChatMessage {
  id: string; type: 'chat' | 'system'; subType?: string;
  userId?: string; nickname?: string; avatar?: string; color?: string;
  text: string; timestamp: number;
}
export interface GameState_Public {
  state: GameState;
  speakingOrder: string[];
  currentSpeakerIndex: number;
  speeches: Speech[];
  voteEndTime?: number;
  speakEndTime?: number;
  discussionEndTime?: number;
  defenseEndTime?: number;
  eliminationEndTime?: number;
  hasVoted: boolean;
  myVote?: string;
  voteCount: number;
  quickVoteCount?: number;
  myQuickVote?: boolean;
  accusedLiars: string[];
  defenseText?: string | null;
  eliminateCount?: number;
  spareCount?: number;
  myEliminationVote?: string;
  guess?: { word: string; correct: boolean } | null;
  result?: GameResult | null;
  roundCount?: number;
  allLiars?: string[];
  citizenWord?: string;
  liarWord?: string | null;
  allVotes?: Record<string, string>;
}
export interface GameResult {
  winner: 'liar' | 'citizen'; reason: string;
  liars: string[]; citizenWord: string; liarWord: string | null;
  accusedLiars: string[]; votes: Record<string, string>;
  guess?: { word: string; correct: boolean };
  tally?: Record<string, number>;
  players?: Player[];
}
export interface Room {
  roomId: string; name: string; hostId: string; isPrivate: boolean;
  gameMode: GameMode; speakingMode: SpeakingMode; topic: string;
  liarCount: number; voteTimeLimit: number; speakTimeLimit: number;
  discussionTimeLimit?: number; tieRule: TieRule; maxRevotes: number;
  minPlayers: number; maxPlayers: number; state: GameState;
  players: Player[]; customWords?: string[];
  game: GameState_Public | null; messages: ChatMessage[];
}
export interface RoomListItem {
  roomId: string; name: string; hostName: string;
  playerCount: number; maxPlayers: number; state: GameState;
  gameMode: GameMode; topic: string; isPrivate: boolean;
  createdAt: number; liarCount: number; speakingMode: SpeakingMode;
}
export interface SecretInfo {
  isLiar: boolean; word: string | null; hint: string | null;
}
export interface UserProfile {
  userId: string; sessionId: string; nickname: string;
  avatar: string; color: string; roomId: string | null;
}

export const TOPICS = [
  '랜덤', '게임', '만화및애니메이션', '밈', '과일', '음식',
  '동물', '인물', '영화', '음악', '장소', '사물', '스포츠', '커스텀',
] as const;

export const TOPIC_LABELS: Record<string, string> = {
  '랜덤': '🎲 랜덤', '게임': '🎮 게임', '만화및애니메이션': '📺 만화/애니',
  '밈': '😂 밈', '과일': '🍎 과일', '음식': '🍜 음식', '동물': '🐾 동물',
  '인물': '👤 인물', '영화': '🎬 영화', '음악': '🎵 음악', '장소': '📍 장소',
  '사물': '📦 사물', '스포츠': '⚽ 스포츠', '커스텀': '✏️ 커스텀',
};

export const AVATAR_OPTIONS = [
  '🎭', '🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦋',
  '🎃', '👾', '🤖', '👻', '🌟', '🔥', '❄️', '🌈',
];
export const COLOR_OPTIONS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#06b6d4',
];
