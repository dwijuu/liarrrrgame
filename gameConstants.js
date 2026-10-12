// 게임 상태 머신
const GameState = {
  LOBBY: 'LOBBY',
  ROLE_ASSIGNMENT: 'ROLE_ASSIGNMENT',
  SPEAKING: 'SPEAKING',             // 순서대로 설명하기
  DISCUSSION: 'DISCUSSION',         // 자유 토론
  VOTING: 'VOTING',                 // 투표
  VOTE_RESULT: 'VOTE_RESULT',       // 투표 결과
  DEFENSE: 'DEFENSE',               // 지목된 사람 반론
  ELIMINATION_VOTE: 'ELIMINATION_VOTE', // 처형 투표
  GUESSING: 'GUESSING',             // 라이어 마지막 추측
  GAME_RESULT: 'GAME_RESULT',
  FINISHED: 'FINISHED',
};

const GameMode = {
  NORMAL: 'NORMAL',
  FOOL: 'FOOL',
};

const SpeakingMode = {
  SEQUENTIAL: 'SEQUENTIAL',
  FREE: 'FREE',
};

const TieRule = {
  LIAR_WINS: 'LIAR_WINS',
  REVOTE: 'REVOTE',
};

module.exports = { GameState, GameMode, SpeakingMode, TieRule };
