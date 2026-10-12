// 게임 상태 머신
const GameState = {
  LOBBY: 'LOBBY',
  ROLE_ASSIGNMENT: 'ROLE_ASSIGNMENT',
  SPEAKING: 'SPEAKING',         // 순서대로 설명하기
  DISCUSSION: 'DISCUSSION',     // 자유 토론
  VOTING: 'VOTING',
  VOTE_RESULT: 'VOTE_RESULT',
  GUESSING: 'GUESSING',         // 라이어 마지막 추측
  GAME_RESULT: 'GAME_RESULT',
  FINISHED: 'FINISHED',
};

const GameMode = {
  NORMAL: 'NORMAL',   // 일반 모드
  FOOL: 'FOOL',       // 바보 모드
};

const SpeakingMode = {
  SEQUENTIAL: 'SEQUENTIAL',  // 순서대로
  FREE: 'FREE',               // 자유 토론
};

const TieRule = {
  LIAR_WINS: 'LIAR_WINS',
  REVOTE: 'REVOTE',
};

module.exports = { GameState, GameMode, SpeakingMode, TieRule };
