const {
  getUserBySocket, createUser, removeUser,
  createRoom, getRoomList, getRoomPublicInfo, getRoomForPlayer,
  startGame, getSecretInfo,
  castVote, tallyVotes, processLiarGuess,
  getRoom, deleteRoom, joinRoom, leaveRoom, rejoinRoom,
  updateRoomSettings, resetGame, addMessage,
  users, userSessions,
} = require('./gameManager');
const { GameState, GameMode, SpeakingMode } = require('./gameConstants');

const activeTimers = new Map(); // key -> timerId

// ── io 인스턴스 캐싱 (투표 시작 외부 노출용) ──────────────────────
let _ioInstance = null;
const pendingVoteStart = new Map(); // roomId -> true (중복 방지)

function setupSocketHandlers(io) {
  _ioInstance = io;

  io.on('connection', (socket) => {
    console.log(`[연결] ${socket.id}`);

    // ── 접속 / 프로필 설정 ──────────────────────────────────────────
    socket.on('user:join', ({ sessionId, nickname, avatar, color }, cb) => {
      try {
        if (!nickname || nickname.trim().length === 0) {
          return cb({ error: '닉네임을 입력해주세요.' });
        }
        if (nickname.trim().length > 12) {
          return cb({ error: '닉네임은 12자 이내로 입력해주세요.' });
        }

        // 세션으로 기존 유저 찾기
        let user = null;
        if (sessionId) {
          for (const [sid, u] of users) {
            if (u.sessionId === sessionId) {
              // 기존 소켓 엔트리를 새 소켓ID로 이동
              users.delete(sid);
              u.socketId = socket.id;
              u.connected = true;
              users.set(socket.id, u);
              user = u;
              break;
            }
          }
          // 세션 ID가 있지만 users에 없는 경우: userSessions에서 재생성
          if (!user && userSessions.has(sessionId)) {
            const sess = userSessions.get(sessionId);
            const { v4: uuidv4 } = require('uuid');
            user = {
              userId: sess.userId,
              socketId: socket.id,
              sessionId,
              nickname: sess.nickname,
              avatar: sess.avatar,
              color: sess.color,
              roomId: null,
              connected: true,
            };
            users.set(socket.id, user);
          }
        }

        if (!user) {
          const { v4: uuidv4 } = require('uuid');
          const newSessionId = sessionId || uuidv4();
          user = createUser(socket.id, newSessionId, nickname.trim(), avatar || '🎭', color || '#6366f1');
        }

        // 닉네임/아바타 업데이트
        user.nickname = nickname.trim();
        if (avatar) user.avatar = avatar;
        if (color) user.color = color;
        userSessions.set(user.sessionId, { userId: user.userId, nickname: user.nickname, avatar: user.avatar, color: user.color });

        socket.userId = user.userId;
        socket.sessionId = user.sessionId;

        // 이전 방에 재접속
        if (user.roomId) {
          const room = getRoom(user.roomId);
          if (room) {
            const rejoined = rejoinRoom(room, user);
            if (rejoined) {
              socket.join(user.roomId);
              io.to(user.roomId).emit('room:player_update', {
                players: room.players.map(p => ({
                  userId: p.userId, nickname: p.nickname, avatar: p.avatar,
                  color: p.color, isHost: p.userId === room.hostId, connected: p.connected,
                })),
              });
              io.to(user.roomId).emit('room:system_message', {
                text: `${user.nickname}님이 재접속했습니다.`, type: 'rejoin',
              });
            }
          } else {
            user.roomId = null;
          }
        }

        cb({
          userId: user.userId,
          sessionId: user.sessionId,
          nickname: user.nickname,
          avatar: user.avatar,
          color: user.color,
          roomId: user.roomId,
        });

        if (user.roomId) {
          const room = getRoom(user.roomId);
          if (room) {
            socket.emit('room:state', getRoomForPlayer(room, user.userId));
            if (room.state !== GameState.LOBBY && room.game) {
              socket.emit('game:secret', getSecretInfo(room, user.userId));
            }
          }
        }
      } catch (e) {
        console.error('user:join error', e);
        cb({ error: e.message });
      }
    });

    // ── 로비 ────────────────────────────────────────────────────────
    socket.on('lobby:get_rooms', (_, cb) => {
      cb({ rooms: getRoomList() });
    });

    socket.on('lobby:subscribe', () => { socket.join('lobby'); });
    socket.on('lobby:unsubscribe', () => { socket.leave('lobby'); });

    // ── 방 생성 ──────────────────────────────────────────────────────
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

    // ── 방 입장 ──────────────────────────────────────────────────────
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
          const playerInfo = { userId: user.userId, nickname: user.nickname, avatar: user.avatar, color: user.color, isHost: false, connected: true };
          io.to(roomId).emit('room:player_joined', { player: playerInfo });
          addSystemMsg(io, room, `${user.nickname}님이 입장했습니다.`, 'join');
        }

        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
        cb({ room: getRoomForPlayer(room, user.userId) });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 방 나가기 ─────────────────────────────────────────────────────
    socket.on('room:leave', (_, cb) => {
      handleLeave(socket, io);
      if (cb) cb({ ok: true });
    });

    // ── 방 설정 변경 ──────────────────────────────────────────────────
    socket.on('room:update_settings', (settings, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room) return cb({ error: '방을 찾을 수 없습니다.' });

        updateRoomSettings(room, user.userId, settings);
        io.to(user.roomId).emit('room:settings_updated', {
          gameMode: room.gameMode, speakingMode: room.speakingMode, topic: room.topic,
          liarCount: room.liarCount, voteTimeLimit: room.voteTimeLimit, speakTimeLimit: room.speakTimeLimit,
          tieRule: room.tieRule, maxRevotes: room.maxRevotes, minPlayers: room.minPlayers,
          customWords: room.customWords, name: room.name, isPrivate: room.isPrivate,
        });
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 게임 시작 ─────────────────────────────────────────────────────
    socket.on('game:start', (_, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room) return cb({ error: '방을 찾을 수 없습니다.' });
        if (room.hostId !== user.userId) return cb({ error: '방장만 게임을 시작할 수 있습니다.' });
        if (room.state !== GameState.LOBBY) return cb({ error: '이미 게임이 진행 중입니다.' });

        startGame(room);
        broadcastSecretInfo(io, room);

        // 3초 후 발언 단계로
        setTimeout(() => {
          if (room.state === GameState.ROLE_ASSIGNMENT) {
            transitionToSpeaking(io, room);
          }
        }, 3000);

        io.to(user.roomId).emit('game:started', {
          state: room.state,
          players: room.players.map(p => ({ userId: p.userId, nickname: p.nickname, avatar: p.avatar, color: p.color })),
          speakingOrder: room.game.speakingOrder,
        });
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 순서 발언 ─────────────────────────────────────────────────────
    socket.on('game:speak', ({ text }, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room || !room.game) return cb({ error: '게임이 없습니다.' });
        if (room.state !== GameState.SPEAKING) return cb({ error: '발언 단계가 아닙니다.' });

        const currentSpeakerId = room.game.speakingOrder[room.game.currentSpeakerIndex];
        if (user.userId !== currentSpeakerId) return cb({ error: '발언 차례가 아닙니다.' });
        if (!text || text.trim().length === 0) return cb({ error: '발언 내용을 입력해주세요.' });
        if (text.trim().length > 200) return cb({ error: '200자 이내로 입력해주세요.' });

        clearTimer(user.roomId + '_speak');

        const speech = {
          userId: user.userId, nickname: user.nickname, avatar: user.avatar,
          color: user.color, text: text.trim(), timestamp: Date.now(),
        };
        room.game.speeches.push(speech);
        io.to(user.roomId).emit('game:speech_added', speech);

        room.game.currentSpeakerIndex++;
        if (room.game.currentSpeakerIndex >= room.game.speakingOrder.length) {
          setTimeout(() => transitionToDiscussion(io, room), 1000);
        } else {
          const speakEndTime = Date.now() + room.speakTimeLimit * 1000;
          room.game.speakEndTime = speakEndTime;
          io.to(user.roomId).emit('game:speaker_changed', {
            currentSpeakerIndex: room.game.currentSpeakerIndex,
            currentSpeakerId: room.game.speakingOrder[room.game.currentSpeakerIndex],
            speakEndTime,
          });
          startSpeakTimer(io, room);
        }
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 채팅 ──────────────────────────────────────────────────────────
    const rateLimitMap = new Map();
    socket.on('game:chat', ({ text }, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room) return cb({ error: '방을 찾을 수 없습니다.' });
        if (room.state === GameState.VOTING || room.state === GameState.ROLE_ASSIGNMENT) {
          return cb({ error: '이 단계에서는 채팅이 불가합니다.' });
        }
        if (!text || text.trim().length === 0) return cb({ error: '메시지를 입력해주세요.' });
        if (text.trim().length > 300) return cb({ error: '300자 이내로 입력해주세요.' });

        // Rate limit
        const now = Date.now();
        const rl = rateLimitMap.get(socket.id) || { count: 0, resetAt: now + 5000 };
        if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + 5000; }
        rl.count++;
        rateLimitMap.set(socket.id, rl);
        if (rl.count > 10) return cb({ error: '메시지를 너무 빨리 보내고 있습니다.' });

        const msg = addMessage(room, { type: 'chat', userId: user.userId, nickname: user.nickname, avatar: user.avatar, color: user.color, text: text.trim() });
        io.to(user.roomId).emit('room:message', msg);
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 투표 시작 (방장) ───────────────────────────────────────────────
    socket.on('game:start_voting', (_, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room) return cb({ error: '방을 찾을 수 없습니다.' });
        if (room.hostId !== user.userId) return cb({ error: '방장만 투표를 시작할 수 있습니다.' });
        if (room.state !== GameState.DISCUSSION && room.state !== GameState.SPEAKING) {
          return cb({ error: '토론/발언 단계가 아닙니다.' });
        }
        clearTimer(user.roomId + '_speak');
        transitionToVoting(io, room);
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 투표 ──────────────────────────────────────────────────────────
    socket.on('game:vote', ({ targetId }, cb) => {
      try {
        const user = getUserBySocket(socket.id);
        if (!user || !user.roomId) return cb({ error: '방에 없습니다.' });
        const room = getRoom(user.roomId);
        if (!room || !room.game) return cb({ error: '게임이 없습니다.' });

        const { earlyEnd } = castVote(room, user.userId, targetId);
        io.to(user.roomId).emit('game:vote_cast', {
          voterId: user.userId,
          voteCount: room.game.votes.size,
          totalPlayers: room.players.filter(p => p.connected).length,
        });

        if (earlyEnd) {
          clearTimer(user.roomId + '_vote');
          // 중복 실행 방지
          if (!pendingVoteStart.has(user.roomId)) {
            pendingVoteStart.set(user.roomId, true);
            setTimeout(() => {
              pendingVoteStart.delete(user.roomId);
              if (room.state === GameState.VOTING) endVoting(io, room);
            }, 500);
          }
        }
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 라이어 추측 ───────────────────────────────────────────────────
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
        if (!word || word.trim().length === 0) return cb({ error: '단어를 입력해주세요.' });

        clearTimer(user.roomId + '_guess');
        const result = processLiarGuess(room, word.trim());
        room.state = GameState.GAME_RESULT;

        io.to(user.roomId).emit('game:result', {
          ...result,
          guess: room.game.guess,
          liars: [...room.game.liars],
          citizenWord: room.game.citizenWord,
          liarWord: room.game.liarWord,
          accusedLiars: room.game.accusedLiars,
          votes: Object.fromEntries(room.game.votes),
          speeches: room.game.speeches,
        });
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
        cb({ ok: true });
      } catch (e) { cb({ error: e.message }); }
    });

    // ── 다시 하기 ─────────────────────────────────────────────────────
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

    // ── 연결 끊김 ─────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[연결 끊김] ${socket.id}`);
      handleLeave(socket, io, true);
      removeUser(socket.id);
    });
  });
}

// ── 헬퍼 함수 ────────────────────────────────────────────────────────

function broadcastSecretInfo(io, room) {
  for (const player of room.players) {
    if (!player.connected) continue;
    const secret = getSecretInfo(room, player.userId);
    io.to(player.socketId).emit('game:secret', secret);
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
      speakEndTime,
      speeches: [],
      voteEndTime: null,
      voteCount: 0,
      hasVoted: false,
      revoteCount: 0,
      accusedLiars: [],
    });

    startSpeakTimer(io, room);
  } else {
    transitionToDiscussion(io, room);
  }
}

function transitionToDiscussion(io, room) {
  room.state = GameState.DISCUSSION;
  io.to(room.roomId).emit('game:phase_change', {
    state: GameState.DISCUSSION,
    speakingOrder: room.game.speakingOrder,
    speeches: room.game.speeches,
    voteCount: 0,
    hasVoted: false,
    revoteCount: room.game.revoteCount,
    accusedLiars: room.game.accusedLiars,
  });
}

function transitionToVoting(io, room) {
  if (room.state === GameState.VOTING) return; // 중복 방지
  room.state = GameState.VOTING;
  const voteEndTime = Date.now() + room.voteTimeLimit * 1000;
  room.game.voteEndTime = voteEndTime;
  room.game.votes = new Map();

  io.to(room.roomId).emit('game:phase_change', {
    state: GameState.VOTING,
    voteEndTime,
    voteCount: 0,
    hasVoted: false,
    players: room.players.filter(p => p.connected).map(p => ({
      userId: p.userId, nickname: p.nickname, avatar: p.avatar, color: p.color,
    })),
    speakingOrder: room.game.speakingOrder,
    speeches: room.game.speeches,
    revoteCount: room.game.revoteCount,
    accusedLiars: room.game.accusedLiars,
  });

  const timerId = setTimeout(() => {
    if (room.state === GameState.VOTING) endVoting(io, room);
  }, room.voteTimeLimit * 1000);
  setTimer(room.roomId + '_vote', timerId);
}

function endVoting(io, room) {
  if (room.state !== GameState.VOTING) return;
  clearTimer(room.roomId + '_vote');

  const result = tallyVotes(room);
  room.state = GameState.VOTE_RESULT;

  if (result.result === 'no_votes' || result.result === 'tie') {
    const canRevote = result.result === 'tie' && room.tieRule === 'REVOTE' && room.game.revoteCount < room.maxRevotes;

    io.to(room.roomId).emit('game:vote_result', {
      result: result.result,
      tally: result.tally,
      topTargets: result.topTargets,
      revoteCount: room.game.revoteCount,
    });

    if (canRevote) {
      room.game.revoteCount++;
      setTimeout(() => transitionToVoting(io, room), 4000);
    } else {
      room.game.result = { winner: 'liar', reason: result.result };
      room.state = GameState.GAME_RESULT;
      setTimeout(() => {
        io.to(room.roomId).emit('game:result', {
          winner: 'liar',
          reason: result.result,
          tally: result.tally || {},
          liars: [...room.game.liars],
          citizenWord: room.game.citizenWord,
          liarWord: room.game.liarWord,
          accusedLiars: room.game.accusedLiars,
          votes: Object.fromEntries(room.game.votes),
        });
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
      }, 2000);
    }
    return;
  }

  // 지목 완료
  const { accusedId, isLiar, tally } = result;
  room.game.accusedLiars.push(accusedId);
  const accusedPlayer = room.players.find(p => p.userId === accusedId);

  io.to(room.roomId).emit('game:vote_result', {
    result: 'decided',
    accusedId,
    accusedNickname: accusedPlayer?.nickname || '?',
    isLiar,
    tally,
  });

  if (isLiar) {
    setTimeout(() => {
      room.state = GameState.GUESSING;
      const guessEndTime = Date.now() + 30000;
      io.to(room.roomId).emit('game:phase_change', {
        state: GameState.GUESSING,
        accusedId,
        guessEndTime,
        speakingOrder: room.game.speakingOrder,
        speeches: room.game.speeches,
        voteCount: room.game.votes.size,
        hasVoted: false,
        revoteCount: room.game.revoteCount,
        accusedLiars: room.game.accusedLiars,
      });

      const timerId = setTimeout(() => {
        if (room.state !== GameState.GUESSING) return;
        room.game.result = { winner: 'citizen', reason: 'no_guess' };
        room.state = GameState.GAME_RESULT;
        io.to(room.roomId).emit('game:result', {
          winner: 'citizen',
          reason: 'no_guess',
          liars: [...room.game.liars],
          citizenWord: room.game.citizenWord,
          liarWord: room.game.liarWord,
          accusedLiars: room.game.accusedLiars,
          votes: Object.fromEntries(room.game.votes),
        });
        io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
      }, 30000);
      setTimer(room.roomId + '_guess', timerId);
    }, 3000);
  } else {
    // 라이어가 아닌 사람 지목 -> 라이어 승리
    room.game.result = { winner: 'liar', reason: 'wrong_accusation' };
    room.state = GameState.GAME_RESULT;
    setTimeout(() => {
      io.to(room.roomId).emit('game:result', {
        winner: 'liar',
        reason: 'wrong_accusation',
        liars: [...room.game.liars],
        citizenWord: room.game.citizenWord,
        liarWord: room.game.liarWord,
        accusedLiars: room.game.accusedLiars,
        votes: Object.fromEntries(room.game.votes),
        tally,
      });
      io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
    }, 2000);
  }
}

function addSystemMsg(io, room, text, type) {
  const msg = addMessage(room, { type: 'system', subType: type, text });
  io.to(room.roomId).emit('room:message', msg);
}

function startSpeakTimer(io, room) {
  const timerId = setTimeout(() => {
    if (room.state !== GameState.SPEAKING) return;
    const idx = room.game.currentSpeakerIndex;
    const currentSpeakerId = room.game.speakingOrder[idx];
    const player = room.players.find(p => p.userId === currentSpeakerId);

    const speech = {
      userId: currentSpeakerId,
      nickname: player?.nickname || '?',
      avatar: player?.avatar || '❓',
      color: player?.color || '#666',
      text: '(시간 초과)',
      timestamp: Date.now(),
      timedOut: true,
    };
    room.game.speeches.push(speech);
    io.to(room.roomId).emit('game:speech_added', speech);

    room.game.currentSpeakerIndex++;
    if (room.game.currentSpeakerIndex >= room.game.speakingOrder.length) {
      setTimeout(() => transitionToDiscussion(io, room), 1000);
    } else {
      const speakEndTime = Date.now() + room.speakTimeLimit * 1000;
      room.game.speakEndTime = speakEndTime;
      io.to(room.roomId).emit('game:speaker_changed', {
        currentSpeakerIndex: room.game.currentSpeakerIndex,
        currentSpeakerId: room.game.speakingOrder[room.game.currentSpeakerIndex],
        speakEndTime,
      });
      startSpeakTimer(io, room);
    }
  }, room.speakTimeLimit * 1000);
  setTimer(room.roomId + '_speak', timerId);
}

function handleLeave(socket, io, isDisconnect = false) {
  const user = getUserBySocket(socket.id);
  if (!user || !user.roomId) return;

  const room = getRoom(user.roomId);
  if (!room) return;

  const playerNickname = room.players.find(p => p.userId === user.userId)?.nickname || user.nickname;
  const result = leaveRoom(room, user.userId);

  if (result.deleteRoom) {
    clearAllTimers(user.roomId);
    io.to(user.roomId).emit('room:closed', { message: '방장이 퇴장하여 방이 닫혔습니다.' });
    const rid = user.roomId;
    deleteRoom(rid);
    io.to('lobby').emit('lobby:room_removed', { roomId: rid });
  } else {
    if (!isDisconnect) socket.leave(user.roomId);
    addSystemMsg(io, room, `${playerNickname}님이 퇴장했습니다.`, 'leave');

    io.to(user.roomId).emit('room:player_update', {
      players: room.players.map(p => ({
        userId: p.userId, nickname: p.nickname, avatar: p.avatar,
        color: p.color, isHost: p.userId === room.hostId, connected: p.connected,
      })),
    });

    if (result.newHostId) {
      io.to(user.roomId).emit('room:host_changed', { hostId: result.newHostId, hostNickname: result.newHostNickname });
      addSystemMsg(io, room, `${result.newHostNickname}님이 방장이 되었습니다.`, 'host_change');
    }

    // 발언 차례인 사람이 퇴장한 경우
    if (room.state === GameState.SPEAKING && room.game) {
      const currentId = room.game.speakingOrder[room.game.currentSpeakerIndex];
      if (currentId === user.userId) {
        clearTimer(user.roomId + '_speak');
        room.game.currentSpeakerIndex++;
        if (room.game.currentSpeakerIndex >= room.game.speakingOrder.length) {
          setTimeout(() => transitionToDiscussion(io, room), 1000);
        } else {
          const speakEndTime = Date.now() + room.speakTimeLimit * 1000;
          room.game.speakEndTime = speakEndTime;
          io.to(user.roomId).emit('game:speaker_changed', {
            currentSpeakerIndex: room.game.currentSpeakerIndex,
            currentSpeakerId: room.game.speakingOrder[room.game.currentSpeakerIndex],
            speakEndTime,
          });
          startSpeakTimer(io, room);
        }
      }
    }

    io.to('lobby').emit('lobby:room_updated', getRoomPublicInfo(room));
  }

  if (!isDisconnect) user.roomId = null;
}

function setTimer(key, timerId) {
  if (activeTimers.has(key)) clearTimeout(activeTimers.get(key));
  activeTimers.set(key, timerId);
}

function clearTimer(key) {
  if (activeTimers.has(key)) { clearTimeout(activeTimers.get(key)); activeTimers.delete(key); }
}

function clearAllTimers(roomId) {
  clearTimer(roomId + '_vote');
  clearTimer(roomId + '_speak');
  clearTimer(roomId + '_guess');
}

module.exports = { setupSocketHandlers, transitionToVoting };
