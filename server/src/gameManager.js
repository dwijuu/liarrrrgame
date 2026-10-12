const { v4: uuidv4 } = require('uuid');
const { GameState, GameMode, SpeakingMode, TieRule } = require('./gameConstants');
const { getRandomWord, getRandomCategory, getFoolModeWordPair } = require('./wordData');

// 인메모리 게임 상태 저장소
const rooms = new Map();       // roomId -> Room
const users = new Map();       // socketId -> User
const userSessions = new Map(); // sessionId -> { userId, nickname, avatar, color }

// ===============================================================
// 유저 관리
// ===============================================================

function createUser(socketId, sessionId, nickname, avatar, color) {
  const userId = uuidv4();
  const user = { userId, socketId, sessionId, nickname, avatar, color, roomId: null, connected: true };
  users.set(socketId, user);
  userSessions.set(sessionId, { userId, nickname, avatar, color });
  return user;
}

function getUserBySocket(socketId) {
  return users.get(socketId);
}

function getUserBySession(sessionId) {
  const session = userSessions.get(sessionId);
  if (!session) return null;
  // 현재 소켓에서 같은 세션 아이디를 가진 유저 찾기
  for (const [, user] of users) {
    if (user.sessionId === sessionId && user.connected) return user;
  }
  return null;
}

function removeUser(socketId) {
  const user = users.get(socketId);
  if (user) {
    user.connected = false;
    // 세션은 유지 (재접속 가능)
  }
  return user;
}

// ===============================================================
// 방 관리
// ===============================================================

function createRoom(hostUser, settings) {
  const roomId = generateRoomCode();
  const room = {
    roomId,
    name: settings.name || `${hostUser.nickname}의 방`,
    hostId: hostUser.userId,
    password: settings.password || null,
    isPrivate: !!settings.password,
    gameMode: settings.gameMode || GameMode.NORMAL,
    speakingMode: settings.speakingMode || SpeakingMode.SEQUENTIAL,
    topic: settings.topic || '랜덤',
    customWords: settings.customWords || [],
    liarCount: settings.liarCount || 1,
    voteTimeLimit: settings.voteTimeLimit || 60,
    speakTimeLimit: settings.speakTimeLimit || 30,
    tieRule: settings.tieRule || TieRule.LIAR_WINS,
    maxRevotes: settings.maxRevotes || 1,
    minPlayers: settings.minPlayers || 3,
    maxPlayers: 20,
    state: GameState.LOBBY,
    players: [],          // { userId, nickname, avatar, color, isHost, socketId }
    game: null,           // 게임 진행 중 데이터
    createdAt: Date.now(),
    messages: [],         // 채팅 메시지
  };

  // 방장 추가
  room.players.push({
    userId: hostUser.userId,
    nickname: hostUser.nickname,
    avatar: hostUser.avatar,
    color: hostUser.color,
    isHost: true,
    socketId: hostUser.socketId,
    connected: true,
  });

  hostUser.roomId = roomId;
  rooms.set(roomId, room);
  return room;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  // 중복 체크
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function getRoomList() {
  const list = [];
  for (const [, room] of rooms) {
    list.push(getRoomPublicInfo(room));
  }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

function getRoomPublicInfo(room) {
  return {
    roomId: room.roomId,
    name: room.name,
    hostName: room.players.find(p => p.userId === room.hostId)?.nickname || '',
    playerCount: room.players.filter(p => p.connected).length,
    maxPlayers: room.maxPlayers,
    state: room.state,
    gameMode: room.gameMode,
    topic: room.topic,
    isPrivate: room.isPrivate,
    createdAt: room.createdAt,
    liarCount: room.liarCount,
    speakingMode: room.speakingMode,
  };
}

function getRoomForPlayer(room, userId) {
  // 플레이어용 방 정보 (게임 비밀 정보 제외)
  return {
    roomId: room.roomId,
    name: room.name,
    hostId: room.hostId,
    isPrivate: room.isPrivate,
    gameMode: room.gameMode,
    speakingMode: room.speakingMode,
    topic: room.topic,
    liarCount: room.liarCount,
    voteTimeLimit: room.voteTimeLimit,
    speakTimeLimit: room.speakTimeLimit,
    tieRule: room.tieRule,
    maxRevotes: room.maxRevotes,
    minPlayers: room.minPlayers,
    maxPlayers: room.maxPlayers,
    state: room.state,
    players: room.players.map(p => ({
      userId: p.userId,
      nickname: p.nickname,
      avatar: p.avatar,
      color: p.color,
      isHost: p.userId === room.hostId,
      connected: p.connected,
    })),
    customWords: room.hostId === userId ? room.customWords : undefined,
    // 게임 중이면 현재 게임 공개 상태
    game: room.game ? getGamePublicState(room, userId) : null,
    messages: room.messages.slice(-100),
  };
}

// ===============================================================
// 게임 관리
// ===============================================================

function startGame(room) {
  const activePlayers = room.players.filter(p => p.connected);

  // 검증
  if (activePlayers.length < room.minPlayers) {
    throw new Error(`최소 ${room.minPlayers}명이 필요합니다.`);
  }
  if (room.liarCount >= activePlayers.length) {
    throw new Error('라이어 수가 너무 많습니다. 시민이 최소 1명 이상이어야 합니다.');
  }
  if (room.liarCount < 1) {
    throw new Error('라이어는 최소 1명이어야 합니다.');
  }

  // 제시어 선택
  let citizenWord, liarWord;
  if (room.topic === '랜덤') {
    const cat = getRandomCategory();
    citizenWord = getRandomWord(cat);
  } else if (room.topic === '커스텀') {
    if (!room.customWords || room.customWords.length === 0) {
      throw new Error('커스텀 제시어가 없습니다.');
    }
    citizenWord = room.customWords[Math.floor(Math.random() * room.customWords.length)];
  } else {
    citizenWord = getRandomWord(room.topic);
  }

  if (!citizenWord) {
    throw new Error('제시어를 가져올 수 없습니다.');
  }

  // 바보 모드: 라이어 단어 선택
  if (room.gameMode === GameMode.FOOL) {
    liarWord = getFoolModeWordPair(citizenWord);
    if (!liarWord) {
      throw new Error('바보 모드에 적합한 연관 단어 쌍이 없습니다. 다른 주제를 선택해주세요.');
    }
  }

  // 라이어 무작위 선정
  const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
  const liars = new Set(shuffled.slice(0, room.liarCount).map(p => p.userId));

  // 발언 순서 결정
  const speakingOrder = [...activePlayers]
    .sort(() => Math.random() - 0.5)
    .map(p => p.userId);

  room.game = {
    citizenWord,
    liarWord: liarWord || null,
    liars,                      // Set<userId> - 서버에서만 관리
    speakingOrder,
    currentSpeakerIndex: 0,
    speeches: [],               // { userId, nickname, text, timestamp }
    votes: new Map(),           // voterId -> targetId
    voteEndTime: null,
    speakEndTime: null,
    revoteCount: 0,
    accusedLiars: [],           // 지목된 라이어들 (복수)
    guess: null,                // 라이어의 마지막 추측
    result: null,               // { winner, accusedUserId, guessWord }
    startedAt: Date.now(),
  };

  room.state = GameState.ROLE_ASSIGNMENT;
  return room.game;
}

function getGamePublicState(room, userId) {
  const game = room.game;
  if (!game) return null;

  const isLiar = game.liars && game.liars.has(userId);

  return {
    state: room.state,
    speakingOrder: game.speakingOrder,
    currentSpeakerIndex: game.currentSpeakerIndex,
    speeches: game.speeches,
    voteEndTime: game.voteEndTime,
    speakEndTime: game.speakEndTime,
    revoteCount: game.revoteCount,
    hasVoted: game.votes.has(userId),
    myVote: game.votes.get(userId),
    voteCount: game.votes.size,
    accusedLiars: game.accusedLiars,
    guess: game.guess,
    result: game.result,
    // 게임 결과에서만 공개
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
      hint: isLiar ? '당신은 라이어입니다! 시민의 발언을 보고 제시어를 추측하세요.' : null,
    };
  } else {
    // 바보 모드
    return {
      isLiar,
      word: isLiar ? game.liarWord : game.citizenWord,
      hint: null,
    };
  }
}

// ===============================================================
// 투표
// ===============================================================

function castVote(room, voterId, targetId) {
  if (room.state !== GameState.VOTING) {
    throw new Error('투표 단계가 아닙니다.');
  }
  const game = room.game;
  if (game.votes.has(voterId)) {
    throw new Error('이미 투표했습니다.');
  }
  if (voterId === targetId) {
    throw new Error('자신에게 투표할 수 없습니다.');
  }
  const activePlayers = room.players.filter(p => p.connected);
  const targetExists = activePlayers.some(p => p.userId === targetId);
  if (!targetExists) {
    throw new Error('유효하지 않은 투표 대상입니다.');
  }

  game.votes.set(voterId, targetId);

  // 과반수 조기 종료 체크
  const votersCount = activePlayers.length;
  const majority = Math.floor(votersCount / 2) + 1;
  if (game.votes.size >= majority) {
    return { voted: true, earlyEnd: true };
  }
  return { voted: true, earlyEnd: false };
}

function tallyVotes(room) {
  const game = room.game;
  const activePlayers = room.players.filter(p => p.connected);
  const tally = new Map(); // targetId -> count

  for (const [, targetId] of game.votes) {
    tally.set(targetId, (tally.get(targetId) || 0) + 1);
  }

  if (tally.size === 0) {
    return { result: 'no_votes', tally: {} };
  }

  const maxCount = Math.max(...tally.values());
  const topTargets = [...tally.entries()].filter(([, c]) => c === maxCount).map(([id]) => id);

  if (topTargets.length > 1) {
    return { result: 'tie', tally: Object.fromEntries(tally), topTargets };
  }

  const accusedId = topTargets[0];
  const isLiar = game.liars.has(accusedId);

  return {
    result: 'decided',
    accusedId,
    isLiar,
    tally: Object.fromEntries(tally),
  };
}

function processLiarGuess(room, guess) {
  const game = room.game;
  const isCorrect = guess.trim() === game.citizenWord.trim() ||
    game.citizenWord.includes(guess.trim()) ||
    guess.trim().includes(game.citizenWord.trim());

  game.guess = { word: guess, correct: isCorrect };

  // 승패 결정
  if (isCorrect) {
    game.result = { winner: 'liar', reason: 'correct_guess' };
  } else {
    game.result = { winner: 'citizen', reason: 'wrong_guess' };
  }

  return game.result;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function deleteRoom(roomId) {
  rooms.delete(roomId);
}

function joinRoom(room, user, password) {
  if (room.isPrivate && room.password !== password) {
    throw new Error('비밀번호가 틀렸습니다.');
  }
  if (room.state !== GameState.LOBBY) {
    throw new Error('게임이 진행 중인 방에는 입장할 수 없습니다.');
  }
  const activePlayers = room.players.filter(p => p.connected);
  if (activePlayers.length >= room.maxPlayers) {
    throw new Error('방이 가득 찼습니다.');
  }

  // 이미 방에 있는지 확인 (재접속)
  const existing = room.players.find(p => p.userId === user.userId);
  if (existing) {
    existing.socketId = user.socketId;
    existing.connected = true;
    user.roomId = room.roomId;
    return { rejoined: true };
  }

  room.players.push({
    userId: user.userId,
    nickname: user.nickname,
    avatar: user.avatar,
    color: user.color,
    isHost: false,
    socketId: user.socketId,
    connected: true,
  });
  user.roomId = room.roomId;
  return { rejoined: false };
}

function leaveRoom(room, userId) {
  const playerIndex = room.players.findIndex(p => p.userId === userId);
  if (playerIndex === -1) return;

  const wasHost = room.players[playerIndex].userId === room.hostId;
  room.players[playerIndex].connected = false;

  // 호스트 퇴장 시 권한 이전
  if (wasHost) {
    const nextHost = room.players.find(p => p.connected && p.userId !== userId);
    if (nextHost) {
      room.hostId = nextHost.userId;
      nextHost.isHost = true;
      return { newHostId: nextHost.userId, newHostNickname: nextHost.nickname };
    } else {
      // 모든 플레이어 퇴장 -> 방 삭제
      return { deleteRoom: true };
    }
  }
  return {};
}

function rejoinRoom(room, user) {
  const existing = room.players.find(p => p.userId === user.userId);
  if (!existing) return false;

  existing.socketId = user.socketId;
  existing.connected = true;
  user.roomId = room.roomId;
  return true;
}

function updateRoomSettings(room, userId, settings) {
  if (room.hostId !== userId) {
    throw new Error('방장만 설정을 변경할 수 있습니다.');
  }
  if (room.state !== GameState.LOBBY) {
    throw new Error('게임 중에는 설정을 변경할 수 없습니다.');
  }

  const allowedFields = ['name', 'password', 'gameMode', 'speakingMode', 'topic',
    'liarCount', 'voteTimeLimit', 'speakTimeLimit', 'tieRule', 'maxRevotes', 'minPlayers', 'customWords'];

  for (const field of allowedFields) {
    if (settings[field] !== undefined) {
      room[field] = settings[field];
    }
  }
  room.isPrivate = !!room.password;
}

function resetGame(room) {
  room.state = GameState.LOBBY;
  room.game = null;
  room.messages = [];
  // 연결 끊긴 플레이어 제거
  room.players = room.players.filter(p => p.connected);
  // 방장 재설정
  if (room.players.length > 0 && !room.players.find(p => p.userId === room.hostId && p.connected)) {
    room.hostId = room.players[0].userId;
  }
}

function addMessage(room, message) {
  const msg = {
    id: uuidv4(),
    ...message,
    timestamp: Date.now(),
  };
  room.messages.push(msg);
  // 최대 200개 메시지 유지
  if (room.messages.length > 200) {
    room.messages = room.messages.slice(-200);
  }
  return msg;
}

module.exports = {
  rooms, users, userSessions,
  createUser, getUserBySocket, getUserBySession, removeUser,
  createRoom, getRoomList, getRoomPublicInfo, getRoomForPlayer,
  startGame, getGamePublicState, getSecretInfo,
  castVote, tallyVotes, processLiarGuess,
  getRoom, deleteRoom, joinRoom, leaveRoom, rejoinRoom,
  updateRoomSettings, resetGame, addMessage,
};
