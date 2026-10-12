const {
  getUserBySocket, createUser, removeUser,
  createRoom, getRoomList, getRoomPublicInfo, getRoomForPlayer,
  startGame, restartRound, getSecretInfo,
  castVote, tallyVotes, castQuickVote, castEliminationVote, tallyEliminationVotes, processLiarGuess,
  getRoom, deleteRoom, joinRoom, leaveRoom, rejoinRoom,
  updateRoomSettings, resetGame, addMessage,
  users, userSessions,
} = require('./gameManager');
const { GameState, GameMode, SpeakingMode } = require('./gameConstants');

const activeTimers = new Map();
let _ioInstance = null;

function setupSocketHandlers(io) {
  _ioInstance = io;

  io.on('connection', (socket) => {
    console.log(`[연결] ${socket.id}`);

    // ── 접속 / 세션 복구 ──────────────────────────────────────
    socket.on('user:join', ({ sessionId, nickname, avatar, color }, cb) => {
      try {
        if (!nickname || !nickname.trim()) return cb({ error: '닉네임을 입력해주세요.' });
        if (nickname.trim().length > 12) return cb({ error: '닉네임은 12자 이내로.' });

        let user = null;
        if (sessionId) {
          for (const [sid, u] of users) {
            if (u.sessionId === sessionId) {
              users.delete(sid);
              u.socketId = socket.id; u.connected = true;
              users.set(socket.id, u); user = u; break;
            }
          }
          if (!user && userSessions.has(sessionId)) {
            const sess = userSessions.get(sessionId);
            const { v4: uuidv4 } = require('uuid');
            user = { userId: sess.userId, socketId: socket.id, sessionId, nickname: sess.nickname, avatar: sess.avatar, color: sess.color, roomId: null, connected: true };
            users.set(socket.id, user);
          }
        }
        if (!user) {
          const { v4: uuidv4 } = require('uuid');
          user = createUser(socket.id, sessionId || uuidv4(), nickname.trim(), avatar || '🎭', color || '#6366f1');
        }
        user.nickname = nickname.trim();
        if (avatar) user.avatar = avatar;
        if (color) user.color = color;
        userSessions.set(user.sessionId, { userId: user.userId, nickname: user.nickname, avatar: user.avatar, color: user.color });
        socket.userId = user.userId;
        socket.sessionId = user.sessionId;

        if (user.roomId) {
          const room = getRoom(user.roomId);
          if (room) {
            const rejoined = rejoinRoom(room, user);
            if (rejoined) {
              socket.join(user.roomId);
              io.to(user.roomId).emit('room:player_update', { players: room.players.map(p => ({ userId: p.userId, nickname: p.nickname, avatar: p.avatar, color: p.color, isHost: p.userId === room.hostId, connected: p.connected })) });
              io.to(user.roomId).emit('room:system_message', { text: `${user.nickname}님이 재접속했습니다.`, type: 'rejoin' });
            }
          } else { user.roomId = null; }
        }

        cb({ userId: user.userId, sessionId: user.sessionId, nickname: user.nickname, avatar: user.avatar, color: user.color, roomId: user.roomId });

        if (user.roomId) {
          const room = getRoom(user.roomId);
          if (room) {
            socket.emit('room:state', getRoomForPlayer(room, user.userId));
            if (room.state !== GameState.LOBBY && room.game) socket.emit('game:secret', getSecretInfo(room, user.userId));
          }
        }
      } catch (e) { console.error('user:join error', e); cb({ error: e.message }); }
    });

    // ── 로비 ──────────────────────────────────────────────────
    socket.on('lobby:get_rooms', (_, cb) => cb({ rooms: getRoomList() }));
    socket.on('lobby:subscribe', () => socket.join('lobby'));
    socket.on('lobby:unsubscribe', () => socket.leave('lobby'));

    // ── 방 생성 ────────────────────────────────────────────────
    socket.on('room:create', (settings, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user) return cb({ error: '먼저 프로필을 설정해주세요.' });
        if (user.roomId) return cb({ error: '이미 방에 있습니다.' });
        const room = createRoom(user, settings);
        socket.join(room.roomId);
        io.to('lobby').emit('lobby:room_added', getRoomPublicInfo(room));
        cb({ room: getRoomForPlayer(room, user.userId) });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 방 입장 ────────────────────────────────────────────────
    socket.on('room:join', ({ roomId, password }, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user) return cb({ error: '먼저 프로필을 설정해주세요.' });
        if (user.roomId && user.roomId !== roomId) return cb({ error: '이미 다른 방에 있습니다.' });
        const room = getRoom(roomId);
        if (!room) return cb({ error: '방을 찾을 수 없습니다.' });
        const { rejoined } = joinRoom(room, user, password);
        socket.join(roomId);
        if (!rejoined) {
          io.to(roomId).emit('room:player_joined', { player: { userId: user.userId, nickname: user.nickname, avatar: user.avatar, color: user.color, isHost: false, connected: true } });
          addSystemMsg(io, room, `${user.nickname}님이 입장했습니다.`, 'join');
        }
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
        cb({ room: getRoomForPlayer(room, user.userId) });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 방 나가기 ──────────────────────────────────────────────
    socket.on('room:leave', (_, cb) => { handleLeave(socket, io); if (cb) cb({ ok: true }); });

    // ── 설정 변경 ──────────────────────────────────────────────
    socket.on('room:update_settings', (settings, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room) return cb({ error: '방을 찾을 수 없습니다.' });
        updateRoomSettings(room, user.userId, settings);
        io.to(user.roomId).emit('room:settings_updated', { gameMode: room.gameMode, speakingMode: room.speakingMode, topic: room.topic, liarCount: room.liarCount, voteTimeLimit: room.voteTimeLimit, speakTimeLimit: room.speakTimeLimit, discussionTimeLimit: room.discussionTimeLimit, tieRule: room.tieRule, maxRevotes: room.maxRevotes, minPlayers: room.minPlayers, customWords: room.customWords, name: room.name, isPrivate: room.isPrivate });
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 게임 시작 ──────────────────────────────────────────────
    socket.on('game:start', (_, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room) return cb({ error: '방을 찾을 수 없습니다.' });
        if (room.hostId !== user.userId) return cb({ error: '방장만 시작할 수 있습니다.' });
        if (room.state !== GameState.LOBBY) return cb({ error: '이미 진행 중입니다.' });
        const connected = room.players.filter(p => p.connected);
        if (connected.length < room.minPlayers) return cb({ error: `최소 ${room.minPlayers}명 필요 (현재 ${connected.length}명)` });
        startGame(room);
        broadcastSecretInfo(io, room);
        io.to(user.roomId).emit('game:started', { state: room.state, players: room.players.map(p => ({ userId: p.userId, nickname: p.nickname, avatar: p.avatar, color: p.color })), speakingOrder: room.game.speakingOrder, roundCount: room.game.roundCount });
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
        setTimeout(() => { if (room.state === GameState.ROLE_ASSIGNMENT) transitionToSpeaking(io, room); }, 3000);
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 발언 ──────────────────────────────────────────────────
    socket.on('game:speak', ({ text }, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room || !room.game) return cb({ error: '게임이 없습니다.' });
        if (room.state !== GameState.SPEAKING) return cb({ error: '발언 단계가 아닙니다.' });
        const currentId = room.game.speakingOrder[room.game.currentSpeakerIndex];
        if (user.userId !== currentId) return cb({ error: '발언 차례가 아닙니다.' });
        if (!text || !text.trim()) return cb({ error: '발언 내용을 입력해주세요.' });
        if (text.trim().length > 200) return cb({ error: '200자 이내로 입력해주세요.' });
        clearTimer(user.roomId + '_speak');
        const speech = { userId: user.userId, nickname: user.nickname, avatar: user.avatar, color: user.color, text: text.trim(), timestamp: Date.now() };
        room.game.speeches.push(speech);
        io.to(user.roomId).emit('game:speech_added', speech);
        room.game.currentSpeakerIndex++;
        if (room.game.currentSpeakerIndex >= room.game.speakingOrder.length) {
          setTimeout(() => transitionToDiscussion(io, room), 1000);
        } else {
          advanceSpeaker(io, room);
        }
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 채팅 ──────────────────────────────────────────────────
    const rl = new Map();
    socket.on('game:chat', ({ text }, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room) return cb({ error: '방을 찾을 수 없습니다.' });
        if (room.state === GameState.VOTING || room.state === GameState.ROLE_ASSIGNMENT) return cb({ error: '이 단계에서는 채팅이 불가합니다.' });
        if (!text || !text.trim()) return cb({ error: '메시지를 입력해주세요.' });
        if (text.trim().length > 300) return cb({ error: '300자 이내로.' });
        const now = Date.now();
        const r = rl.get(socket.id) || { count: 0, resetAt: now + 5000 };
        if (now > r.resetAt) { r.count = 0; r.resetAt = now + 5000; }
        r.count++; rl.set(socket.id, r);
        if (r.count > 10) return cb({ error: '너무 빠릅니다.' });
        const msg = addMessage(room, { type: 'chat', userId: user.userId, nickname: user.nickname, avatar: user.avatar, color: user.color, text: text.trim() });
        io.to(user.roomId).emit('room:message', msg);
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 빠른 투표 (토론 스킵) ────────────────────────────────
    socket.on('game:quick_vote', (_, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room || !room.game) return cb({ error: '게임이 없습니다.' });
        if (room.state !== GameState.DISCUSSION) return cb({ error: '토론 단계가 아닙니다.' });
        if (room.game.quickVotes.has(user.userId)) return cb({ error: '이미 요청했습니다.' });
        const { count, total, majority } = castQuickVote(room, user.userId);
        io.to(user.roomId).emit('game:quick_vote_cast', { userId: user.userId, quickVoteCount: count, totalPlayers: total });
        if (majority) {
          clearTimer(user.roomId + '_discussion');
          setTimeout(() => { if (room.state === GameState.DISCUSSION) transitionToVoting(io, room); }, 500);
        }
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 투표 ──────────────────────────────────────────────────
    socket.on('game:vote', ({ targetId }, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room || !room.game) return cb({ error: '게임이 없습니다.' });
        const { earlyEnd } = castVote(room, user.userId, targetId);
        io.to(user.roomId).emit('game:vote_cast', { voterId: user.userId, voteCount: room.game.votes.size, totalPlayers: room.players.filter(p => p.connected).length });
        if (earlyEnd) {
          clearTimer(user.roomId + '_vote');
          setTimeout(() => { if (room.state === GameState.VOTING) endVoting(io, room); }, 500);
        }
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 반론 ──────────────────────────────────────────────────
    socket.on('game:defense', ({ text }, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room || !room.game) return cb({ error: '게임이 없습니다.' });
        if (room.state !== GameState.DEFENSE) return cb({ error: '반론 단계가 아닙니다.' });
        const currentAccused = room.game.accusedLiars[room.game.accusedLiars.length - 1];
        if (user.userId !== currentAccused) return cb({ error: '지목된 사람만 반론할 수 있습니다.' });
        if (!text || !text.trim()) return cb({ error: '반론 내용을 입력해주세요.' });
        if (text.trim().length > 300) return cb({ error: '300자 이내로.' });
        clearTimer(user.roomId + '_defense');
        room.game.defenseText = text.trim();
        io.to(user.roomId).emit('game:defense_submitted', { accusedId: currentAccused, text: text.trim() });
        setTimeout(() => transitionToEliminationVote(io, room), 2000);
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 처형 투표 ──────────────────────────────────────────────
    socket.on('game:elimination_vote', ({ choice }, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room || !room.game) return cb({ error: '게임이 없습니다.' });
        if (room.state !== GameState.ELIMINATION_VOTE) return cb({ error: '처형 투표 단계가 아닙니다.' });
        if (!['eliminate', 'spare'].includes(choice)) return cb({ error: '잘못된 선택입니다.' });
        const { eliminateCount, spareCount, allVoted } = castEliminationVote(room, user.userId, choice);
        io.to(user.roomId).emit('game:elimination_vote_cast', { userId: user.userId, choice, eliminateCount, spareCount, totalPlayers: room.players.filter(p => p.connected).length });
        if (allVoted) { clearTimer(user.roomId + '_elimination'); endEliminationVote(io, room); }
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 라이어 추측 ────────────────────────────────────────────
    socket.on('game:guess', ({ word }, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room || !room.game) return cb({ error: '게임이 없습니다.' });
        if (room.state !== GameState.GUESSING) return cb({ error: '추측 단계가 아닙니다.' });
        if (!room.game.liars.has(user.userId)) return cb({ error: '라이어만 추측할 수 있습니다.' });
        const accusedId = room.game.accusedLiars[room.game.accusedLiars.length - 1];
        if (user.userId !== accusedId) return cb({ error: '지목된 라이어만 추측할 수 있습니다.' });
        if (!word || !word.trim()) return cb({ error: '단어를 입력해주세요.' });
        clearTimer(user.roomId + '_guess');
        const result = processLiarGuess(room, word.trim());
        room.state = GameState.GAME_RESULT;
        io.to(user.roomId).emit('game:result', { ...result, guess: room.game.guess, liars: [...room.game.liars], citizenWord: room.game.citizenWord, liarWord: room.game.liarWord, accusedLiars: room.game.accusedLiars, votes: Object.fromEntries(room.game.votes), players: room.players.map(p => ({ userId: p.userId, nickname: p.nickname, avatar: p.avatar, color: p.color })) });
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 다시 하기 ──────────────────────────────────────────────
    socket.on('game:restart', (_, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room) return cb({ error: '방을 찾을 수 없습니다.' });
        if (room.hostId !== user.userId) return cb({ error: '방장만 재시작할 수 있습니다.' });
        clearAllTimers(user.roomId);
        resetGame(room);
        io.to(user.roomId).emit('game:reset', { room: getRoomForPlayer(room, user.userId) });
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 연결 끊김 ──────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[끊김] ${socket.id}`);
      handleLeave(socket, io, true);
      removeUser(socket.id);
    });
  });
}

// ── 헬퍼 함수 ─────────────────────────────────────────────────

function broadcastSecretInfo(io, room) {
  for (const p of room.players) {
    if (!p.connected) continue;
    io.to(p.socketId).emit('game:secret', getSecretInfo(room, p.userId));
  }
}

function transitionToSpeaking(io, room) {
  if (room.speakingMode === SpeakingMode.SEQUENTIAL) {
    room.state = GameState.SPEAKING;
    room.game.currentSpeakerIndex = 0;
    const speakEndTime = Date.now() + room.speakTimeLimit * 1000;
    room.game.speakEndTime = speakEndTime;
    io.to(room.roomId).emit('game:phase_change', {
      state: GameState.SPEAKING,
      currentSpeakerIndex: 0,
      currentSpeakerId: room.game.speakingOrder[0],
      speakingOrder: room.game.speakingOrder,
      speakEndTime, speeches: [],
      roundCount: room.game.roundCount,
    });
    startSpeakTimer(io, room);
  } else {
    transitionToDiscussion(io, room);
  }
}

function transitionToDiscussion(io, room) {
  room.state = GameState.DISCUSSION;
  room.game.quickVotes = new Set();
  const limit = room.discussionTimeLimit || 120;
  const discussionEndTime = Date.now() + limit * 1000;
  room.game.discussionEndTime = discussionEndTime;
  io.to(room.roomId).emit('game:phase_change', {
    state: GameState.DISCUSSION,
    speakingOrder: room.game.speakingOrder,
    speeches: room.game.speeches,
    discussionEndTime,
    quickVoteCount: 0,
    roundCount: room.game.roundCount,
  });
  const tid = setTimeout(() => {
    if (room.state === GameState.DISCUSSION) transitionToVoting(io, room);
  }, limit * 1000);
  setTimer(room.roomId + '_discussion', tid);
}

function transitionToVoting(io, room) {
  if (room.state === GameState.VOTING) return;
  clearTimer(room.roomId + '_discussion');
  room.state = GameState.VOTING;
  room.game.votes = new Map();
  const voteEndTime = Date.now() + room.voteTimeLimit * 1000;
  room.game.voteEndTime = voteEndTime;
  io.to(room.roomId).emit('game:phase_change', {
    state: GameState.VOTING, voteEndTime,
    players: room.players.filter(p => p.connected).map(p => ({ userId: p.userId, nickname: p.nickname, avatar: p.avatar, color: p.color })),
    speakingOrder: room.game.speakingOrder,
    speeches: room.game.speeches,
    roundCount: room.game.roundCount,
  });
  const tid = setTimeout(() => { if (room.state === GameState.VOTING) endVoting(io, room); }, room.voteTimeLimit * 1000);
  setTimer(room.roomId + '_vote', tid);
}

function endVoting(io, room) {
  if (room.state !== GameState.VOTING) return;
  clearTimer(room.roomId + '_vote');
  const result = tallyVotes(room);
  room.state = GameState.VOTE_RESULT;

  if (result.result === 'no_votes' || result.result === 'tie') {
    io.to(room.roomId).emit('game:vote_result', {
      result: result.result, tally: result.tally || {}, topTargets: result.topTargets || [],
      message: '동률! 라운드를 다시 시작합니다.',
    });
    setTimeout(() => doRestartRound(io, room), 4000);
    return;
  }

  const { accusedId, isLiar, tally } = result;
  room.game.accusedLiars.push(accusedId);
  const accused = room.players.find(p => p.userId === accusedId);
  io.to(room.roomId).emit('game:vote_result', {
    result: 'decided', accusedId,
    accusedNickname: accused?.nickname || '?',
    accusedAvatar: accused?.avatar || '❓',
    accusedColor: accused?.color || '#666',
    isLiar, tally,
  });
  setTimeout(() => transitionToDefense(io, room, accusedId, tally), 4000);
}

function transitionToDefense(io, room, accusedId, tally) {
  room.state = GameState.DEFENSE;
  room.game.defenseText = null;
  const defenseEndTime = Date.now() + 35000;
  room.game.defenseEndTime = defenseEndTime;
  const accused = room.players.find(p => p.userId === accusedId);
  io.to(room.roomId).emit('game:phase_change', {
    state: GameState.DEFENSE, accusedId,
    accusedNickname: accused?.nickname || '?',
    accusedAvatar: accused?.avatar || '❓',
    accusedColor: accused?.color || '#666',
    tally, defenseEndTime,
    speakingOrder: room.game.speakingOrder,
    speeches: room.game.speeches,
    accusedLiars: room.game.accusedLiars,
  });
  const tid = setTimeout(() => {
    if (room.state !== GameState.DEFENSE) return;
    room.game.defenseText = '(반론 없음)';
    transitionToEliminationVote(io, room);
  }, 35000);
  setTimer(room.roomId + '_defense', tid);
}

function transitionToEliminationVote(io, room) {
  room.state = GameState.ELIMINATION_VOTE;
  room.game.eliminationVotes = new Map();
  const eliminationEndTime = Date.now() + 30000;
  room.game.eliminationEndTime = eliminationEndTime;
  const currentAccusedId = room.game.accusedLiars[room.game.accusedLiars.length - 1];
  const accused = room.players.find(p => p.userId === currentAccusedId);
  io.to(room.roomId).emit('game:phase_change', {
    state: GameState.ELIMINATION_VOTE,
    accusedId: currentAccusedId,
    accusedNickname: accused?.nickname || '?',
    accusedAvatar: accused?.avatar || '❓',
    accusedColor: accused?.color || '#666',
    defenseText: room.game.defenseText,
    eliminationEndTime,
    accusedLiars: room.game.accusedLiars,
    speeches: room.game.speeches,
  });
  const tid = setTimeout(() => { if (room.state === GameState.ELIMINATION_VOTE) endEliminationVote(io, room); }, 30000);
  setTimer(room.roomId + '_elimination', tid);
}

function endEliminationVote(io, room) {
  if (room.state !== GameState.ELIMINATION_VOTE) return;
  clearTimer(room.roomId + '_elimination');
  const { eliminateCount, spareCount, eliminate } = tallyEliminationVotes(room);
  const currentAccusedId = room.game.accusedLiars[room.game.accusedLiars.length - 1];
  const isLiar = room.game.liars.has(currentAccusedId);
  const accused = room.players.find(p => p.userId === currentAccusedId);

  io.to(room.roomId).emit('game:elimination_result', {
    eliminate, eliminateCount, spareCount,
    accusedId: currentAccusedId,
    accusedNickname: accused?.nickname || '?',
    accusedAvatar: accused?.avatar || '❓',
    isLiar,
  });

  if (eliminate) {
    if (isLiar) {
      setTimeout(() => {
        room.state = GameState.GUESSING;
        const guessEndTime = Date.now() + 30000;
        room.game.guessEndTime = guessEndTime;
        io.to(room.roomId).emit('game:phase_change', {
          state: GameState.GUESSING, accusedId: currentAccusedId, guessEndTime,
          speakingOrder: room.game.speakingOrder, speeches: room.game.speeches,
          accusedLiars: room.game.accusedLiars,
        });
        if (accused?.socketId) {
          io.to(accused.socketId).emit('game:secret', { isLiar: true, word: room.game.liarWord || null, hint: '시민의 제시어를 맞추세요!' });
        }
        const tid = setTimeout(() => {
          if (room.state !== GameState.GUESSING) return;
          room.game.result = { winner: 'citizen', reason: 'no_guess' };
          room.state = GameState.GAME_RESULT;
          io.to(room.roomId).emit('game:result', { winner: 'citizen', reason: 'no_guess', liars: [...room.game.liars], citizenWord: room.game.citizenWord, liarWord: room.game.liarWord, accusedLiars: room.game.accusedLiars, votes: Object.fromEntries(room.game.votes), players: room.players.map(p => ({ userId: p.userId, nickname: p.nickname, avatar: p.avatar, color: p.color })) });
          io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
        }, 30000);
        setTimer(room.roomId + '_guess', tid);
      }, 3000);
    } else {
      room.game.result = { winner: 'liar', reason: 'wrong_accusation' };
      room.state = GameState.GAME_RESULT;
      setTimeout(() => {
        io.to(room.roomId).emit('game:result', { winner: 'liar', reason: 'wrong_accusation', liars: [...room.game.liars], citizenWord: room.game.citizenWord, liarWord: room.game.liarWord, accusedLiars: room.game.accusedLiars, votes: Object.fromEntries(room.game.votes), players: room.players.map(p => ({ userId: p.userId, nickname: p.nickname, avatar: p.avatar, color: p.color })) });
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
      }, 2000);
    }
  } else {
    // 살리기 → 라운드 재시작
    setTimeout(() => doRestartRound(io, room), 3000);
  }
}

function doRestartRound(io, room) {
  clearAllTimers(room.roomId);
  restartRound(room);
  broadcastSecretInfo(io, room);
  io.to(room.roomId).emit('game:round_restart', { roundCount: room.game.roundCount, speakingOrder: room.game.speakingOrder });
  setTimeout(() => { if (room.state === GameState.ROLE_ASSIGNMENT) transitionToSpeaking(io, room); }, 3000);
}

function advanceSpeaker(io, room) {
  const speakEndTime = Date.now() + room.speakTimeLimit * 1000;
  room.game.speakEndTime = speakEndTime;
  io.to(room.roomId).emit('game:speaker_changed', {
    currentSpeakerIndex: room.game.currentSpeakerIndex,
    currentSpeakerId: room.game.speakingOrder[room.game.currentSpeakerIndex],
    speakEndTime,
  });
  startSpeakTimer(io, room);
}

function startSpeakTimer(io, room) {
  const tid = setTimeout(() => {
    if (room.state !== GameState.SPEAKING) return;
    const idx = room.game.currentSpeakerIndex;
    const speakerId = room.game.speakingOrder[idx];
    const player = room.players.find(p => p.userId === speakerId);
    const speech = { userId: speakerId, nickname: player?.nickname || '?', avatar: player?.avatar || '❓', color: player?.color || '#666', text: '(시간 초과)', timestamp: Date.now(), timedOut: true };
    room.game.speeches.push(speech);
    io.to(room.roomId).emit('game:speech_added', speech);
    room.game.currentSpeakerIndex++;
    if (room.game.currentSpeakerIndex >= room.game.speakingOrder.length) {
      setTimeout(() => transitionToDiscussion(io, room), 1000);
    } else {
      advanceSpeaker(io, room);
    }
  }, room.speakTimeLimit * 1000);
  setTimer(room.roomId + '_speak', tid);
}

function addSystemMsg(io, room, text, type) {
  const msg = addMessage(room, { type: 'system', subType: type, text });
  io.to(room.roomId).emit('room:message', msg);
}

function handleLeave(socket, io, isDisconnect = false) {
  const user = getUserBySocket(socket.id);
  if (!user || !user.roomId) return;
  const room = getRoom(user.roomId);
  if (!room) return;
  const nickname = room.players.find(p => p.userId === user.userId)?.nickname || user.nickname;
  const result = leaveRoom(room, user.userId);
  if (result.deleteRoom) {
    clearAllTimers(user.roomId);
    io.to(user.roomId).emit('room:closed', { message: '방장이 퇴장하여 방이 닫혔습니다.' });
    const rid = user.roomId; deleteRoom(rid);
    io.to('lobby').emit('lobby:room_removed', { roomId: rid });
  } else {
    if (!isDisconnect) socket.leave(user.roomId);
    addSystemMsg(io, room, `${nickname}님이 퇴장했습니다.`, 'leave');
    io.to(user.roomId).emit('room:player_update', { players: room.players.map(p => ({ userId: p.userId, nickname: p.nickname, avatar: p.avatar, color: p.color, isHost: p.userId === room.hostId, connected: p.connected })) });
    if (result.newHostId) { io.to(user.roomId).emit('room:host_changed', { hostId: result.newHostId, hostNickname: result.newHostNickname }); addSystemMsg(io, room, `${result.newHostNickname}님이 방장이 되었습니다.`, 'host_change'); }
    if (room.state === GameState.SPEAKING && room.game) {
      const curId = room.game.speakingOrder[room.game.currentSpeakerIndex];
      if (curId === user.userId) {
        clearTimer(user.roomId + '_speak');
        room.game.currentSpeakerIndex++;
        if (room.game.currentSpeakerIndex >= room.game.speakingOrder.length) { setTimeout(() => transitionToDiscussion(io, room), 1000); }
        else { advanceSpeaker(io, room); }
      }
    }
    io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
  }
  if (!isDisconnect) user.roomId = null;
}

function setTimer(key, tid) { if (activeTimers.has(key)) clearTimeout(activeTimers.get(key)); activeTimers.set(key, tid); }
function clearTimer(key) { if (activeTimers.has(key)) { clearTimeout(activeTimers.get(key)); activeTimers.delete(key); } }
function clearAllTimers(roomId) { ['_speak', '_vote', '_guess', '_discussion', '_defense', '_elimination'].forEach(s => clearTimer(roomId + s)); }

module.exports = { setupSocketHandlers };
