const { v4: uuidv4 } = require('uuid');
const { GameState, GameMode, SpeakingMode, TieRule } = require('./gameConstants');
const { getRandomWord, getRandomCategory, getFoolModeWordPair } = require('./wordData');

const rooms = new Map();
const users = new Map();
const userSessions = new Map();

// ── 유저 관리 ──────────────────────────────────────────────────
function createUser(socketId, sessionId, nickname, avatar, color) {
  const userId = uuidv4();
  const user = { userId, socketId, sessionId, nickname, avatar, color, roomId: null, connected: true };
  users.set(socketId, user);
  userSessions.set(sessionId, { userId, nickname, avatar, color });
  return user;
}
function getUserBySocket(socketId) { return users.get(socketId); }
function getUserBySession(sessionId) {
  for (const [, user] of users) {
    if (user.sessionId === sessionId && user.connected) return user;
  }
  return null;
}
function removeUser(socketId) {
  const user = users.get(socketId);
  if (user) user.connected = false;
  return user;
}

// ── 방 관리 ──────────────────────────────────────────────────
function createRoom(hostUser, settings) {
  const roomId = generateRoomCode();
  const room = {
    roomId,
    name: settings.name || `${hostUser.nickname}의 방`,
    hostId: hostUser.userId,
    password: settings.password || null,
    isPrivate: !!settings.password,
    gameMode: settings.gameMode || GameMode.FOOL,
    speakingMode: settings.speakingMode || SpeakingMode.SEQUENTIAL,
    topic: settings.topic || '랜덤',
    customWords: settings.customWords || [],
    liarCount: settings.liarCount || 1,
    voteTimeLimit: settings.voteTimeLimit || 60,
    speakTimeLimit: settings.speakTimeLimit || 30,
    discussionTimeLimit: settings.discussionTimeLimit || 120,
    tieRule: settings.tieRule || TieRule.LIAR_WINS,
    maxRevotes: settings.maxRevotes || 1,
    minPlayers: settings.minPlayers || 3,
    maxPlayers: 20,
    state: GameState.LOBBY,
    players: [],
    game: null,
    createdAt: Date.now(),
    messages: [],
  };
  room.players.push({
    userId: hostUser.userId, nickname: hostUser.nickname, avatar: hostUser.avatar,
    color: hostUser.color, isHost: true, socketId: hostUser.socketId, connected: true,
  });
  hostUser.roomId = roomId;
  rooms.set(roomId, room);
  return room;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function getRoomList() {
  return [...rooms.values()].map(getRoomPublicInfo).sort((a, b) => b.createdAt - a.createdAt);
}

function getRoomPublicInfo(room) {
  return {
    roomId: room.roomId, name: room.name,
    hostName: room.players.find(p => p.userId === room.hostId)?.nickname || '',
    playerCount: room.players.filter(p => p.connected).length,
    maxPlayers: room.maxPlayers, state: room.state, gameMode: room.gameMode,
    topic: room.topic, isPrivate: room.isPrivate, createdAt: room.createdAt,
    liarCount: room.liarCount, speakingMode: room.speakingMode,
  };
}

function getRoomForPlayer(room, userId) {
  return {
    roomId: room.roomId, name: room.name, hostId: room.hostId, isPrivate: room.isPrivate,
    gameMode: room.gameMode, speakingMode: room.speakingMode, topic: room.topic,
    liarCount: room.liarCount, voteTimeLimit: room.voteTimeLimit, speakTimeLimit: room.speakTimeLimit,
    discussionTimeLimit: room.discussionTimeLimit, tieRule: room.tieRule,
    maxRevotes: room.maxRevotes, minPlayers: room.minPlayers, maxPlayers: room.maxPlayers,
    state: room.state,
    players: room.players.map(p => ({
      userId: p.userId, nickname: p.nickname, avatar: p.avatar, color: p.color,
      isHost: p.userId === room.hostId, connected: p.connected,
    })),
    customWords: room.hostId === userId ? room.customWords : undefined,
    game: room.game ? getGamePublicState(room, userId) : null,
    messages: room.messages.slice(-100),
  };
}

// ── 게임 관리 ──────────────────────────────────────────────────
function startGame(room) {
  const activePlayers = room.players.filter(p => p.connected);
  if (activePlayers.length < room.minPlayers)
    throw new Error(`최소 ${room.minPlayers}명이 필요합니다.`);
  if (room.liarCount >= activePlayers.length)
    throw new Error('라이어 수가 너무 많습니다.');

  let citizenWord, liarWord;
  if (room.topic === '랜덤') {
    citizenWord = getRandomWord(getRandomCategory());
  } else if (room.topic === '커스텀') {
    if (!room.customWords || room.customWords.length === 0)
      throw new Error('커스텀 제시어가 없습니다.');
    citizenWord = room.customWords[Math.floor(Math.random() * room.customWords.length)];
  } else {
    citizenWord = getRandomWord(room.topic);
  }
  if (!citizenWord) throw new Error('제시어를 가져올 수 없습니다.');

  if (room.gameMode === GameMode.FOOL) {
    if (room.topic === '커스텀') {
      const others = room.customWords.filter(w => w !== citizenWord);
      liarWord = others.length > 0 ? others[Math.floor(Math.random() * others.length)] : citizenWord;
    } else {
      liarWord = getFoolModeWordPair(citizenWord);
      if (!liarWord) throw new Error('바보 모드에 적합한 연관 단어 쌍이 없습니다.');
    }
  }

  const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
  const liars = new Set(shuffled.slice(0, room.liarCount).map(p => p.userId));
  const speakingOrder = [...activePlayers].sort(() => Math.random() - 0.5).map(p => p.userId);

  room.game = {
    citizenWord, liarWord: liarWord || null,
    liars,
    speakingOrder, currentSpeakerIndex: 0,
    speeches: [],
    votes: new Map(),
    voteEndTime: null, speakEndTime: null,
    discussionEndTime: null,
    quickVotes: new Set(),
    defenseText: null, defenseEndTime: null,
    eliminationVotes: new Map(), eliminationEndTime: null,
    accusedLiars: [],
    guess: null, result: null,
    startedAt: Date.now(),
    roundCount: 1,
  };
  room.state = GameState.ROLE_ASSIGNMENT;
  return room.game;
}

// 라운드 재시작 (같은 단어/라이어, 새 발언 순서)
function restartRound(room) {
  const activePlayers = room.players.filter(p => p.connected);
  room.game.speeches = [];
  room.game.votes = new Map();
  room.game.quickVotes = new Set();
  room.game.defenseText = null;
  room.game.eliminationVotes = new Map();
  room.game.accusedLiars = [];
  room.game.currentSpeakerIndex = 0;
  room.game.voteEndTime = null;
  room.game.speakEndTime = null;
  room.game.discussionEndTime = null;
  room.game.defenseEndTime = null;
  room.game.eliminationEndTime = null;
  room.game.speakingOrder = [...activePlayers].sort(() => Math.random() - 0.5).map(p => p.userId);
  room.game.roundCount = (room.game.roundCount || 1) + 1;
  room.state = GameState.ROLE_ASSIGNMENT;
  return room.game;
}

function getGamePublicState(room, userId) {
  const game = room.game;
  if (!game) return null;
  return {
    state: room.state,
    speakingOrder: game.speakingOrder,
    currentSpeakerIndex: game.currentSpeakerIndex,
    speeches: game.speeches,
    voteEndTime: game.voteEndTime,
    speakEndTime: game.speakEndTime,
    discussionEndTime: game.discussionEndTime,
    defenseEndTime: game.defenseEndTime,
    eliminationEndTime: game.eliminationEndTime,
    hasVoted: game.votes.has(userId),
    myVote: game.votes.get(userId),
    voteCount: game.votes.size,
    quickVoteCount: game.quickVotes.size,
    myQuickVote: game.quickVotes.has(userId),
    accusedLiars: game.accusedLiars,
    defenseText: game.defenseText,
    eliminateCount: [...game.eliminationVotes.values()].filter(v => v === 'eliminate').length,
    spareCount: [...game.eliminationVotes.values()].filter(v => v === 'spare').length,
    myEliminationVote: game.eliminationVotes.get(userId),
    guess: game.guess,
    result: game.result,
    roundCount: game.roundCount,
    ...(room.state === GameState.GAME_RESULT || room.state === GameState.FINISHED ? {
      allLiars: [...game.liars],
      citizenWord: game.citizenWord,
      liarWord: game.liarWord,
      allVotes: Object.fromEntries(game.votes),
    } : {}),
  };
}

function getSecretInfo(room, userId) {
  const game = room.game;
  if (!game) return null;
  const isLiar = game.liars && game.liars.has(userId);
  if (room.gameMode === GameMode.NORMAL) {
    return {
      isLiar,
      word: isLiar ? null : game.citizenWord,
      hint: isLiar ? '제시어가 없습니다. 시민들의 발언을 보고 제시어를 추측하세요.' : null,
    };
  }
  // FOOL 모드 (바보 모드):
  // 모든 플레이어가 키워드를 받으며, 자신이 시민인지 라이어인지 게임 중에는 전혀 알 수 없음!
  // isLiar를 null로 전달하여 역할을 노출하지 않음.
  return { isLiar: null, word: isLiar ? game.liarWord : game.citizenWord, hint: null };
}

// ── 투표 ──────────────────────────────────────────────────────
function castVote(room, voterId, targetId) {
  if (room.state !== GameState.VOTING) throw new Error('투표 단계가 아닙니다.');
  const game = room.game;
  if (game.votes.has(voterId)) throw new Error('이미 투표했습니다.');
  const activePlayers = room.players.filter(p => p.connected);
  if (!activePlayers.some(p => p.userId === targetId)) throw new Error('유효하지 않은 투표 대상입니다.');
  game.votes.set(voterId, targetId);
  const majority = Math.floor(activePlayers.length / 2) + 1;
  return { voted: true, earlyEnd: game.votes.size >= majority };
}

function tallyVotes(room) {
  const game = room.game;
  const tally = new Map();
  for (const [, targetId] of game.votes) tally.set(targetId, (tally.get(targetId) || 0) + 1);
  if (tally.size === 0) return { result: 'no_votes', tally: {} };
  const maxCount = Math.max(...tally.values());
  const topTargets = [...tally.entries()].filter(([, c]) => c === maxCount).map(([id]) => id);
  if (topTargets.length > 1) return { result: 'tie', tally: Object.fromEntries(tally), topTargets };
  const accusedId = topTargets[0];
  return { result: 'decided', accusedId, isLiar: game.liars.has(accusedId), tally: Object.fromEntries(tally) };
}

function castQuickVote(room, userId) {
  const game = room.game;
  game.quickVotes.add(userId);
  const activePlayers = room.players.filter(p => p.connected);
  const total = activePlayers.length;
  const count = game.quickVotes.size;
  const majority = count > total / 2;
  return { count, total, majority };
}

function castEliminationVote(room, voterId, choice) {
  const game = room.game;
  if (game.eliminationVotes.has(voterId)) throw new Error('이미 투표했습니다.');
  game.eliminationVotes.set(voterId, choice);
  const activePlayers = room.players.filter(p => p.connected);
  const eliminateCount = [...game.eliminationVotes.values()].filter(v => v === 'eliminate').length;
  const spareCount = [...game.eliminationVotes.values()].filter(v => v === 'spare').length;
  return { eliminateCount, spareCount, allVoted: game.eliminationVotes.size >= activePlayers.length };
}

function tallyEliminationVotes(room) {
  const game = room.game;
  const eliminateCount = [...game.eliminationVotes.values()].filter(v => v === 'eliminate').length;
  const spareCount = [...game.eliminationVotes.values()].filter(v => v === 'spare').length;
  return { eliminateCount, spareCount, eliminate: eliminateCount > spareCount };
}

function processLiarGuess(room, guess) {
  const game = room.game;
  const isCorrect = guess.trim() === game.citizenWord.trim() ||
    game.citizenWord.includes(guess.trim()) || guess.trim().includes(game.citizenWord.trim());
  game.guess = { word: guess, correct: isCorrect };
  game.result = { winner: isCorrect ? 'liar' : 'citizen', reason: isCorrect ? 'correct_guess' : 'wrong_guess' };
  return game.result;
}

function getRoom(roomId) { return rooms.get(roomId); }
function deleteRoom(roomId) { rooms.delete(roomId); }

function joinRoom(room, user, password) {
  if (room.isPrivate && room.password !== password) throw new Error('비밀번호가 틀렸습니다.');
  if (room.state !== GameState.LOBBY) throw new Error('게임이 진행 중인 방에는 입장할 수 없습니다.');
  if (room.players.filter(p => p.connected).length >= room.maxPlayers) throw new Error('방이 가득 찼습니다.');
  const existing = room.players.find(p => p.userId === user.userId);
  if (existing) {
    existing.socketId = user.socketId; existing.connected = true;
    user.roomId = room.roomId; return { rejoined: true };
  }
  room.players.push({ userId: user.userId, nickname: user.nickname, avatar: user.avatar, color: user.color, isHost: false, socketId: user.socketId, connected: true });
  user.roomId = room.roomId;
  return { rejoined: false };
}

function leaveRoom(room, userId) {
  const idx = room.players.findIndex(p => p.userId === userId);
  if (idx === -1) return {};
  const wasHost = room.players[idx].userId === room.hostId;
  room.players[idx].connected = false;
  if (wasHost) {
    const next = room.players.find(p => p.connected && p.userId !== userId);
    if (next) { room.hostId = next.userId; next.isHost = true; return { newHostId: next.userId, newHostNickname: next.nickname }; }
    return { deleteRoom: true };
  }
  return {};
}

function rejoinRoom(room, user) {
  const existing = room.players.find(p => p.userId === user.userId);
  if (!existing) return false;
  existing.socketId = user.socketId; existing.connected = true;
  user.roomId = room.roomId; return true;
}

function updateRoomSettings(room, userId, settings) {
  if (room.hostId !== userId) throw new Error('방장만 설정을 변경할 수 있습니다.');
  if (room.state !== GameState.LOBBY) throw new Error('게임 중에는 설정을 변경할 수 없습니다.');
  const allowed = ['name', 'password', 'gameMode', 'speakingMode', 'topic', 'liarCount', 'voteTimeLimit', 'speakTimeLimit', 'discussionTimeLimit', 'tieRule', 'maxRevotes', 'minPlayers', 'customWords'];
  for (const f of allowed) if (settings[f] !== undefined) room[f] = settings[f];
  room.isPrivate = !!room.password;
}

function resetGame(room) {
  room.state = GameState.LOBBY; room.game = null; room.messages = [];
  room.players = room.players.filter(p => p.connected);
  if (room.players.length > 0 && !room.players.find(p => p.userId === room.hostId && p.connected))
    room.hostId = room.players[0].userId;
}

function addMessage(room, message) {
  const msg = { id: uuidv4(), ...message, timestamp: Date.now() };
  room.messages.push(msg);
  if (room.messages.length > 200) room.messages = room.messages.slice(-200);
  return msg;
}

module.exports = {
  rooms, users, userSessions,
  createUser, getUserBySocket, getUserBySession, removeUser,
  createRoom, getRoomList, getRoomPublicInfo, getRoomForPlayer,
  startGame, restartRound, getGamePublicState, getSecretInfo,
  castVote, tallyVotes, castQuickVote, castEliminationVote, tallyEliminationVotes, processLiarGuess,
  getRoom, deleteRoom, joinRoom, leaveRoom, rejoinRoom,
  updateRoomSettings, resetGame, addMessage,
};
