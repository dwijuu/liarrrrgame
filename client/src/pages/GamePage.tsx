import React, { useState, useRef, useEffect } from 'react';
import { getSocket } from '../utils/socket';
import { useGameStore } from '../store/gameStore';
import { useCountdown } from '../hooks/useCountdown';
import type { Player, GameResult } from '../types';
import toast from 'react-hot-toast';
import './GamePage.css';

export default function GamePage() {
  const { user, room, secretInfo, gameResult, setRoom, setPage, setSecretInfo, setGameResult } = useGameStore();
  const [activeTab, setActiveTab] = useState<'game' | 'chat' | 'word'>('game');
  const [chatInput, setChatInput] = useState('');
  const [speakInput, setSpeakInput] = useState('');
  const [selectedVote, setSelectedVote] = useState<string | null>(null);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [guessInput, setGuessInput] = useState('');
  const [guessSubmitted, setGuessSubmitted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const speechesEndRef = useRef<HTMLDivElement>(null);

  const game = room?.game;
  const serverHasVoted = game?.hasVoted ?? false;
  const state = room?.state || 'LOBBY';
  const isHost = room?.hostId === user?.userId;
  const activePlayers = room?.players.filter(p => p.connected) || [];
  const isMyTurn = state === 'SPEAKING' &&
    game?.speakingOrder[game?.currentSpeakerIndex ?? -1] === user?.userId;
  const isLiar = secretInfo?.isLiar ?? false;
  const accusedMe = game?.accusedLiars?.includes(user?.userId || '') ?? false;

  const voteEndTime = game?.voteEndTime;
  const speakEndTime = game?.speakEndTime;
  const voteCountdown = useCountdown(voteEndTime);
  const speakCountdown = useCountdown(speakEndTime);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room?.messages]);

  useEffect(() => {
    speechesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [game?.speeches]);

  const handleSendChat = () => {
    if (!chatInput.trim()) return;
    const socket = getSocket();
    socket.emit('game:chat', { text: chatInput }, (res: any) => {
      if (res.error) toast.error(res.error);
    });
    setChatInput('');
  };

  const handleSpeak = () => {
    if (!speakInput.trim()) return;
    const socket = getSocket();
    socket.emit('game:speak', { text: speakInput }, (res: any) => {
      if (res.error) toast.error(res.error);
      else setSpeakInput('');
    });
  };

  const handleVote = () => {
    if (!selectedVote) { toast.error('투표할 플레이어를 선택해주세요.'); return; }
    const socket = getSocket();
    socket.emit('game:vote', { targetId: selectedVote }, (res: any) => {
      if (res.error) toast.error(res.error);
      else {
        setVoteSubmitted(true);
        toast.success('투표 완료!');
      }
    });
  };

  const handleStartVoting = () => {
    const socket = getSocket();
    socket.emit('game:start_voting', {}, (res: any) => {
      if (res.error) toast.error(res.error);
    });
  };

  const handleGuess = () => {
    if (!guessInput.trim()) { toast.error('단어를 입력해주세요.'); return; }
    const socket = getSocket();
    socket.emit('game:guess', { word: guessInput }, (res: any) => {
      if (res.error) toast.error(res.error);
      else setGuessSubmitted(true);
    });
  };

  const handleRestart = () => {
    const socket = getSocket();
    socket.emit('game:restart', {}, (res: any) => {
      if (res.error) toast.error(res.error);
    });
  };

  const handleLeave = () => {
    const socket = getSocket();
    socket.emit('room:leave', {}, () => {
      setRoom(null);
      setSecretInfo(null);
      setGameResult(null);
      setPage('lobby');
      socket.emit('lobby:subscribe');
    });
  };

  const getPlayerById = (id: string) =>
    room?.players.find(p => p.userId === id);

  const getStateLabel = () => {
    const labels: Record<string, string> = {
      ROLE_ASSIGNMENT: '역할 배정 중',
      SPEAKING: '발언 단계',
      DISCUSSION: '자유 토론',
      VOTING: '투표 진행 중',
      VOTE_RESULT: '투표 결과',
      GUESSING: '라이어 추측 중',
      GAME_RESULT: '게임 종료',
      FINISHED: '라운드 종료',
    };
    return labels[state] || state;
  };

  if (!room) return null;

  return (
    <div className="game-page">
      {/* 상단 헤더 */}
      <div className="game-header">
        <div className="game-header-left">
          <span className="game-room-name">{room.name}</span>
          <span className={`game-state-badge state-${state.toLowerCase()}`}>
            {getStateLabel()}
          </span>
        </div>
        <div className="game-header-center">
          {(state === 'VOTING') && voteEndTime && (
            <div className={`timer ${voteCountdown <= 10 ? 'urgent' : ''}`}>
              ⏱ 투표 {voteCountdown}초
            </div>
          )}
          {(state === 'SPEAKING') && speakEndTime && (
            <div className={`timer ${speakCountdown <= 5 ? 'urgent' : ''}`}>
              ⏱ 발언 {speakCountdown}초
            </div>
          )}
        </div>
        <div className="game-header-right">
          <button className="btn btn-ghost btn-sm" onClick={handleLeave}>
            🚪 나가기
          </button>
        </div>
      </div>

      {/* 메인 레이아웃 */}
      <div className="game-layout">
        {/* 좌측: 참가자 목록 */}
        <div className="game-players-panel">
          <div className="panel-title">👥 참가자</div>
          {activePlayers.map(player => {
            const isSpeaker = state === 'SPEAKING' &&
              game?.speakingOrder[game?.currentSpeakerIndex ?? -1] === player.userId;
            const hasSpokeN = game?.speeches.some(s => s.userId === player.userId);
            const voteTarget = game?.myVote === player.userId;
            const isAccused = game?.accusedLiars?.includes(player.userId);

            return (
              <div
                key={player.userId}
                className={`game-player-item
                  ${player.userId === user?.userId ? 'me' : ''}
                  ${isSpeaker ? 'speaking' : ''}
                  ${isAccused ? 'accused' : ''}
                `}
              >
                <div className="game-player-avatar" style={{ background: player.color }}>
                  {player.avatar}
                  {isSpeaker && <div className="speaking-indicator" />}
                </div>
                <div className="game-player-info">
                  <span className="game-player-name">
                    {player.nickname}
                    {player.userId === user?.userId && ' (나)'}
                  </span>
                  <div className="game-player-meta">
                    {player.userId === room.hostId && <span className="badge badge-purple" style={{fontSize:10}}>👑</span>}
                    {isSpeaker && <span className="badge badge-green" style={{fontSize:10}}>🎤 발언 중</span>}
                    {hasSpokeN && !isSpeaker && state === 'SPEAKING' && (
                      <span className="badge badge-gray" style={{fontSize:10}}>✓ 완료</span>
                    )}
                    {voteTarget && <span className="badge badge-yellow" style={{fontSize:10}}>투표</span>}
                    {isAccused && <span className="badge badge-red" style={{fontSize:10}}>🎯 지목</span>}
                  </div>
                </div>
              </div>
            );
          })}

          {/* 제시어 확인 패널 */}
          <div className="word-panel">
            <div className="word-panel-title">🔍 내 제시어</div>
            {secretInfo ? (
              <div className={`word-reveal ${secretInfo.isLiar ? 'liar' : 'citizen'}`}>
                {secretInfo.isLiar ? (
                  <>
                    <div className="word-role">🎭 라이어</div>
                    <div className="word-text">
                      {room.gameMode === 'FOOL' ? secretInfo.word : '제시어 없음'}
                    </div>
                    {secretInfo.hint && <div className="word-hint">{secretInfo.hint}</div>}
                  </>
                ) : (
                  <>
                    <div className="word-role">✅ 시민</div>
                    <div className="word-text">{secretInfo.word}</div>
                  </>
                )}
              </div>
            ) : (
              <div className="word-loading">로딩 중...</div>
            )}
          </div>
        </div>

        {/* 중앙: 게임 메인 */}
        <div className="game-main">
          {/* 모바일 탭 */}
          <div className="mobile-tabs">
            <button className={`tab-btn ${activeTab === 'game' ? 'active' : ''}`} onClick={() => setActiveTab('game')}>게임</button>
            <button className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>채팅</button>
            <button className={`tab-btn ${activeTab === 'word' ? 'active' : ''}`} onClick={() => setActiveTab('word')}>제시어</button>
          </div>

          {/* 역할 배정 단계 */}
          {state === 'ROLE_ASSIGNMENT' && (
            <div className="game-phase-content fade-in">
              <div className="phase-icon">🎭</div>
              <h2>역할이 배정되었습니다!</h2>
              <p>잠시 후 게임이 시작됩니다...</p>
              {secretInfo && (
                <div className={`role-reveal ${secretInfo.isLiar ? 'liar' : 'citizen'}`}>
                  {secretInfo.isLiar ? (
                    <>
                      <div className="role-icon">🎭</div>
                      <div className="role-title">당신은 라이어!</div>
                      {room.gameMode === 'FOOL' && secretInfo.word && (
                        <div className="role-word">내 단어: <strong>{secretInfo.word}</strong></div>
                      )}
                      <div className="role-desc">시민들의 발언을 보고 제시어를 추측하세요.</div>
                    </>
                  ) : (
                    <>
                      <div className="role-icon">✅</div>
                      <div className="role-title">당신은 시민!</div>
                      <div className="role-word">제시어: <strong>{secretInfo.word}</strong></div>
                      <div className="role-desc">제시어를 직접 말하지 말고 설명하세요.</div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 발언 단계 (순서대로) */}
          {state === 'SPEAKING' && (
            <div className="game-phase-content">
              <div className="speeches-area scroll-area">
                {game?.speeches.map((speech, i) => {
                  const player = getPlayerById(speech.userId);
                  return (
                    <div key={i} className={`speech-item ${speech.userId === user?.userId ? 'mine' : ''}`}>
                      <div className="speech-avatar" style={{ background: player?.color || '#6366f1' }}>
                        {player?.avatar || '❓'}
                      </div>
                      <div className="speech-content">
                        <div className="speech-name">{speech.nickname}</div>
                        <div className={`speech-text ${speech.timedOut ? 'timed-out' : ''}`}>
                          {speech.text}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={speechesEndRef} />
              </div>

              {/* 현재 발언자 표시 */}
              <div className="speaker-indicator">
                {isMyTurn ? (
                  <div className="my-turn-banner">
                    <span>🎤 내 발언 차례입니다!</span>
                    {speakEndTime && <span className={`turn-timer ${speakCountdown <= 5 ? 'urgent' : ''}`}>{speakCountdown}초</span>}
                  </div>
                ) : (
                  <div className="waiting-turn">
                    {game && game.currentSpeakerIndex < (game.speakingOrder?.length ?? 0) ? (
                      <span>
                        🎤 {getPlayerById(game.speakingOrder[game.currentSpeakerIndex])?.nickname || '?'}님이 발언 중...
                      </span>
                    ) : (
                      <span>모든 발언 완료</span>
                    )}
                  </div>
                )}
              </div>

              {/* 발언 입력 */}
              {isMyTurn && (
                <div className="speak-input-area">
                  <input
                    className="input"
                    type="text"
                    placeholder="발언을 입력하세요 (제시어를 직접 말하지 마세요!)"
                    value={speakInput}
                    onChange={e => setSpeakInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSpeak()}
                    maxLength={200}
                    autoFocus
                  />
                  <button className="btn btn-primary" onClick={handleSpeak}>발언</button>
                </div>
              )}

              {/* 방장 토론 종료 버튼 */}
              {isHost && (
                <button
                  className="btn btn-warning btn-sm"
                  style={{ marginTop: 8, background: 'var(--warning)', color: '#0f0f1a' }}
                  onClick={handleStartVoting}
                >
                  🗳️ 투표 시작하기
                </button>
              )}
            </div>
          )}

          {/* 자유 토론 */}
          {state === 'DISCUSSION' && (
            <div className="game-phase-content">
              <div className="discussion-header">
                <h3>💬 자유 토론 중</h3>
                <p>제시어에 대해 자유롭게 대화하세요. 제시어를 직접 말하지 마세요!</p>
              </div>
              {/* 채팅 메시지 */}
              <div className="chat-messages-game scroll-area">
                {room.messages.filter(m => m.type === 'chat' || m.type === 'system').map(msg => (
                  <div key={msg.id} className={`chat-msg ${msg.type === 'system' ? 'system' : msg.userId === user?.userId ? 'mine' : ''}`}>
                    {msg.type === 'system' ? (
                      <span className="system-msg">{msg.text}</span>
                    ) : (
                      <>
                        <div className="msg-avatar" style={{ background: msg.color }}>{msg.avatar}</div>
                        <div className="msg-content">
                          <div className="msg-name">{msg.nickname}</div>
                          <div className="msg-text">{msg.text}</div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* 채팅 입력 */}
              <div className="chat-input-row" style={{padding: 0}}>
                <input
                  className="input"
                  type="text"
                  placeholder="메시지를 입력하세요..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                  maxLength={300}
                />
                <button className="btn btn-primary" onClick={handleSendChat}>전송</button>
              </div>

              {/* 방장 투표 시작 */}
              {isHost && (
                <button
                  className="btn btn-primary btn-full"
                  style={{ marginTop: 12 }}
                  onClick={handleStartVoting}
                >
                  🗳️ 투표 시작하기
                </button>
              )}
            </div>
          )}

          {/* 투표 단계 */}
          {state === 'VOTING' && (
            <div className="game-phase-content">
              <div className="vote-header">
                <h3>🗳️ 투표</h3>
                <p>라이어라고 생각하는 사람에게 투표하세요.</p>
                {voteEndTime && (
                  <div className={`vote-timer ${voteCountdown <= 10 ? 'urgent' : ''}`}>
                    ⏱ 남은 시간: {voteCountdown}초
                  </div>
                )}
                <div className="vote-progress">
                  투표 현황: {game?.voteCount || 0} / {activePlayers.length}명
                </div>
              </div>

              {!voteSubmitted && !serverHasVoted ? (
                <div className="vote-candidates">
                  {activePlayers
                    .filter(p => p.userId !== user?.userId)
                    .map(player => (
                      <button
                        key={player.userId}
                        className={`vote-candidate ${selectedVote === player.userId ? 'selected' : ''}`}
                        onClick={() => setSelectedVote(player.userId)}
                      >
                        <div className="candidate-avatar" style={{ background: player.color }}>
                          {player.avatar}
                        </div>
                        <div className="candidate-name">{player.nickname}</div>
                        {selectedVote === player.userId && (
                          <div className="vote-check">✓</div>
                        )}
                      </button>
                    ))}
                  <button
                    className="btn btn-danger btn-full"
                    onClick={handleVote}
                    disabled={!selectedVote}
                    style={{ marginTop: 12 }}
                  >
                    투표 확정
                  </button>
                </div>
              ) : (
                <div className="vote-done">
                  <div className="done-icon">✅</div>
                  <div>투표가 완료되었습니다!</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    다른 참가자들의 투표를 기다리고 있습니다...
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 투표 결과 */}
          {state === 'VOTE_RESULT' && game?.accusedLiars && (
            <div className="game-phase-content fade-in">
              <div className="vote-result">
                <h3>🎯 투표 결과</h3>
                {game.accusedLiars.length > 0 ? (
                  <>
                    <div className="accused-player">
                      {(() => {
                        const accused = getPlayerById(game.accusedLiars[game.accusedLiars.length - 1]);
                        return accused ? (
                          <>
                            <div className="accused-avatar" style={{ background: accused.color }}>{accused.avatar}</div>
                            <div className="accused-name">{accused.nickname}</div>
                            <div>이 지목되었습니다!</div>
                          </>
                        ) : null;
                      })()}
                    </div>
                    <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>라이어인지 확인 중...</p>
                  </>
                ) : (
                  <div style={{ color: 'var(--warning)' }}>동률이거나 유효한 투표가 없습니다.</div>
                )}
              </div>
            </div>
          )}

          {/* 라이어 추측 */}
          {state === 'GUESSING' && (
            <div className="game-phase-content fade-in">
              <div className="guessing-phase">
                <h3>🤔 라이어의 마지막 추측</h3>
                {accusedMe && isLiar ? (
                  <div className="guess-input-area">
                    <p>시민의 제시어를 맞추세요! 정답을 맞히면 라이어 승리!</p>
                    {!guessSubmitted ? (
                      <>
                        <input
                          className="input"
                          type="text"
                          placeholder="제시어를 입력하세요..."
                          value={guessInput}
                          onChange={e => setGuessInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleGuess()}
                          autoFocus
                        />
                        <button className="btn btn-primary btn-full" onClick={handleGuess}>
                          추측 제출
                        </button>
                      </>
                    ) : (
                      <div className="guess-submitted">
                        <div>✅ 추측을 제출했습니다: <strong>{guessInput}</strong></div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <p>
                      지목된 라이어 <strong>{getPlayerById(game?.accusedLiars?.[game?.accusedLiars?.length - 1] || '')?.nickname || '?'}</strong>이
                      제시어를 추측하고 있습니다...
                    </p>
                    <div className="loading-dots">⏳</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 게임 결과 */}
          {(state === 'GAME_RESULT' || gameResult) && gameResult && (
            <GameResult
              result={gameResult}
              room={room}
              user={user}
              isHost={isHost}
              onRestart={handleRestart}
              onLeave={handleLeave}
              getPlayerById={getPlayerById}
            />
          )}
        </div>

        {/* 우측: 채팅 (데스크톱) */}
        <div className="game-chat-panel">
          <div className="panel-title">💬 채팅</div>
          <div className="chat-messages-side scroll-area">
            {room.messages.map(msg => (
              <div key={msg.id} className={`chat-msg-side ${msg.type === 'system' ? 'system' : msg.userId === user?.userId ? 'mine' : ''}`}>
                {msg.type === 'system' ? (
                  <span className="system-msg">{msg.text}</span>
                ) : (
                  <>
                    <div className="msg-avatar-sm" style={{ background: msg.color }}>{msg.avatar}</div>
                    <div className="msg-content-sm">
                      <span className="msg-name-sm">{msg.nickname}</span>
                      <span className="msg-text-sm">{msg.text}</span>
                    </div>
                  </>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {(state === 'DISCUSSION' || state === 'SPEAKING' || state === 'LOBBY' || state === 'GAME_RESULT') && (
            <div className="side-chat-input">
              <input
                className="input"
                style={{ fontSize: 13 }}
                type="text"
                placeholder="채팅..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                maxLength={300}
              />
              <button className="btn btn-primary btn-sm" onClick={handleSendChat}>전송</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 게임 결과 컴포넌트
function GameResult({ result, room, user, isHost, onRestart, onLeave, getPlayerById }: {
  result: GameResult;
  room: any;
  user: any;
  isHost: boolean;
  onRestart: () => void;
  onLeave: () => void;
  getPlayerById: (id: string) => Player | undefined;
}) {
  const winnerText = result.winner === 'liar' ? '🎭 라이어 승리!' : '✅ 시민 승리!';
  const winnerClass = result.winner === 'liar' ? 'liar-wins' : 'citizen-wins';

  const reasonText: Record<string, string> = {
    correct_guess: '라이어가 제시어를 맞췄습니다!',
    wrong_guess: '라이어가 제시어를 틀렸습니다.',
    wrong_accusation: '시민이 지목되었습니다!',
    tie: '투표가 동률입니다!',
    no_votes: '유효한 투표가 없었습니다.',
    no_guess: '라이어가 추측을 포기했습니다.',
  };

  return (
    <div className={`game-result fade-in ${winnerClass}`}>
      <div className="result-winner">{winnerText}</div>
      <div className="result-reason">{reasonText[result.reason] || result.reason}</div>

      <div className="result-info">
        <div className="result-row">
          <span>시민 제시어</span>
          <strong>{result.citizenWord}</strong>
        </div>
        {room.gameMode === 'FOOL' && result.liarWord && (
          <div className="result-row">
            <span>라이어 단어</span>
            <strong>{result.liarWord}</strong>
          </div>
        )}
        {result.guess && (
          <div className="result-row">
            <span>라이어의 추측</span>
            <strong className={result.guess.correct ? 'correct' : 'wrong'}>
              {result.guess.word} {result.guess.correct ? '✅' : '❌'}
            </strong>
          </div>
        )}
      </div>

      {/* 라이어 공개 */}
      <div className="result-liars">
        <div className="result-section-title">🎭 라이어 명단</div>
        {result.liars.map(lierId => {
          const player = getPlayerById(lierId);
          return player ? (
            <div key={lierId} className="result-liar-item">
              <div style={{ background: player.color, width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                {player.avatar}
              </div>
              <span>{player.nickname}</span>
            </div>
          ) : null;
        })}
      </div>

      {/* 투표 결과 */}
      {result.tally && Object.keys(result.tally).length > 0 && (
        <div className="result-votes">
          <div className="result-section-title">📊 투표 결과</div>
          {Object.entries(result.tally).sort((a, b) => b[1] - a[1]).map(([targetId, count]) => {
            const player = getPlayerById(targetId);
            return player ? (
              <div key={targetId} className="vote-bar-item">
                <span>{player.nickname}</span>
                <div className="vote-bar">
                  <div
                    className="vote-bar-fill"
                    style={{ width: `${(count / (room.players.filter((p: Player) => p.connected).length)) * 100}%` }}
                  />
                </div>
                <span>{count}표</span>
              </div>
            ) : null;
          })}
        </div>
      )}

      <div className="result-actions">
        {isHost ? (
          <>
            <button className="btn btn-success btn-full" onClick={onRestart}>
              🔄 다시 하기
            </button>
            <button className="btn btn-ghost btn-full" onClick={onLeave}>
              🚪 로비로 돌아가기
            </button>
          </>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            방장이 다음 라운드를 시작할 때까지 대기 중...
            <br />
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onLeave}>
              로비로 나가기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
