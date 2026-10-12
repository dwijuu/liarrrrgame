import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getSocket } from '../utils/socket';
import { useGameStore } from '../store/gameStore';
import { useCountdown } from '../hooks/useCountdown';
import type { Player, GameResult } from '../types';
import toast from 'react-hot-toast';
import './GamePage.css';

type TabType = 'game' | 'speeches' | 'chat';

export default function GamePage() {
  const { user, room, secretInfo, gameResult, setRoom, setPage, setSecretInfo, setGameResult } = useGameStore();
  const [activeTab, setActiveTab] = useState<TabType>('game');
  const [chatInput, setChatInput] = useState('');
  const [speakInput, setSpeakInput] = useState('');
  const [selectedVote, setSelectedVote] = useState<string | null>(null);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [quickVoted, setQuickVoted] = useState(false);
  const [defenseInput, setDefenseInput] = useState('');
  const [defenseSubmitted, setDefenseSubmitted] = useState(false);
  const [elimChoice, setElimChoice] = useState<'eliminate' | 'spare' | null>(null);
  const [elimSubmitted, setElimSubmitted] = useState(false);
  const [guessInput, setGuessInput] = useState('');
  const [guessSubmitted, setGuessSubmitted] = useState(false);
  const [showSpeeches, setShowSpeeches] = useState(false);
  const [elimResult, setElimResult] = useState<any>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const game = room?.game;
  const state = room?.state || 'LOBBY';
  const isHost = room?.hostId === user?.userId;
  const activePlayers = room?.players.filter(p => p.connected) || [];
  const isMyTurn = state === 'SPEAKING' && game?.speakingOrder?.[game?.currentSpeakerIndex ?? -1] === user?.userId;
  const isLiar = secretInfo?.isLiar ?? false;
  const currentAccusedId = game?.accusedLiars?.[game.accusedLiars.length - 1];
  const isCurrentAccused = currentAccusedId === user?.userId;

  const voteCountdown = useCountdown(game?.voteEndTime);
  const speakCountdown = useCountdown(game?.speakEndTime);
  const discussCountdown = useCountdown(game?.discussionEndTime);
  const defenseCountdown = useCountdown(game?.defenseEndTime);
  const elimCountdown = useCountdown(game?.eliminationEndTime);

  // 상태 전환 시 로컬 상태 초기화
  useEffect(() => {
    setVoteSubmitted(false); setQuickVoted(false);
    setDefenseSubmitted(false); setElimChoice(null); setElimSubmitted(false);
    setGuessSubmitted(false); setSelectedVote(null);
    if (state === 'SPEAKING' || state === 'ROLE_ASSIGNMENT') setActiveTab('game');
  }, [state]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room?.messages?.length]);

  // elimination_result 이벤트
  useEffect(() => {
    const socket = getSocket();
    socket.on('game:elimination_result', (data: any) => {
      setElimResult(data);
      setTimeout(() => setElimResult(null), 5000);
    });
    return () => { socket.off('game:elimination_result'); };
  }, []);

  const getPlayer = (id: string) => room?.players.find(p => p.userId === id);

  const handleChat = useCallback(() => {
    if (!chatInput.trim()) return;
    getSocket().emit('game:chat', { text: chatInput }, (res: any) => {
      if (res.error) toast.error(res.error);
    });
    setChatInput('');
    chatInputRef.current?.focus();
  }, [chatInput]);

  const handleSpeak = () => {
    if (!speakInput.trim()) return;
    getSocket().emit('game:speak', { text: speakInput }, (res: any) => {
      if (res.error) toast.error(res.error);
      else setSpeakInput('');
    });
  };

  const handleVote = () => {
    if (!selectedVote) { toast.error('투표할 사람을 선택하세요.'); return; }
    getSocket().emit('game:vote', { targetId: selectedVote }, (res: any) => {
      if (res.error) toast.error(res.error);
      else setVoteSubmitted(true);
    });
  };

  const handleQuickVote = () => {
    getSocket().emit('game:quick_vote', {}, (res: any) => {
      if (res.error) toast.error(res.error);
      else setQuickVoted(true);
    });
  };

  const handleDefense = () => {
    if (!defenseInput.trim()) { toast.error('반론 내용을 입력하세요.'); return; }
    getSocket().emit('game:defense', { text: defenseInput }, (res: any) => {
      if (res.error) toast.error(res.error);
      else setDefenseSubmitted(true);
    });
  };

  const handleElimVote = (choice: 'eliminate' | 'spare') => {
    getSocket().emit('game:elimination_vote', { choice }, (res: any) => {
      if (res.error) toast.error(res.error);
      else { setElimChoice(choice); setElimSubmitted(true); }
    });
  };

  const handleGuess = () => {
    if (!guessInput.trim()) { toast.error('단어를 입력하세요.'); return; }
    getSocket().emit('game:guess', { word: guessInput }, (res: any) => {
      if (res.error) toast.error(res.error);
      else setGuessSubmitted(true);
    });
  };

  const handleLeave = () => {
    const socket = getSocket();
    socket.emit('room:leave', {}, () => {
      setRoom(null); setSecretInfo(null); setGameResult(null);
      setPage('lobby'); socket.emit('lobby:subscribe');
    });
  };

  const handleRestart = () => {
    getSocket().emit('game:restart', {}, (res: any) => { if (res.error) toast.error(res.error); });
  };

  const canChat = !['VOTING', 'ROLE_ASSIGNMENT'].includes(state);
  const chatMessages = room?.messages.filter(m => m.type === 'chat' || m.type === 'system') || [];

  // 제시어 표시 컴포넌트
  const WordBadge = () => {
    if (!secretInfo) return <div className="word-badge loading">🔍 제시어 로딩 중...</div>;
    if (secretInfo.isLiar) {
      return (
        <div className="word-badge liar">
          🎭 <strong>라이어</strong>
          {room?.gameMode === 'FOOL' && secretInfo.word && <> · 내 단어: <strong>{secretInfo.word}</strong></>}
          {room?.gameMode === 'NORMAL' && <> · 제시어를 모릅니다!</>}
        </div>
      );
    }
    return (
      <div className="word-badge citizen">
        ✅ 시민 · 제시어: <strong>{secretInfo.word}</strong>
      </div>
    );
  };

  // 발언 목록 컴포넌트
  const SpeechesList = () => (
    <div className="speeches-list">
      {(!game?.speeches || game.speeches.length === 0) ? (
        <div className="empty-hint">아직 발언이 없습니다.</div>
      ) : (
        game.speeches.map((sp, i) => {
          const p = getPlayer(sp.userId);
          return (
            <div key={i} className={`speech-item ${sp.userId === user?.userId ? 'mine' : ''}`}>
              <div className="speech-avatar" style={{ background: p?.color || sp.color }}>
                {sp.avatar}
              </div>
              <div className="speech-bubble">
                <div className="speech-name">{sp.nickname}</div>
                <div className={`speech-text ${sp.timedOut ? 'timed-out' : ''}`}>{sp.text}</div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  // 채팅 메시지 컴포넌트
  const ChatMessages = () => (
    <div className="chat-messages scroll-area" ref={chatEndRef}>
      {chatMessages.length === 0 && <div className="empty-hint">채팅을 시작해보세요!</div>}
      {chatMessages.map(msg => (
        <div key={msg.id} className={`chat-msg ${msg.type === 'system' ? 'system' : msg.userId === user?.userId ? 'mine' : ''}`}>
          {msg.type === 'system' ? (
            <span className="sys-text">{msg.text}</span>
          ) : (
            <>
              <div className="msg-ava" style={{ background: msg.color }}>{msg.avatar}</div>
              <div className="msg-body">
                <div className="msg-name">{msg.nickname}</div>
                <div className="msg-text">{msg.text}</div>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );

  if (!room) return null;

  return (
    <div className="gp">
      {/* ── 지목/처형 결과 모달 ── */}
      {elimResult && (
        <div className="elim-overlay" onClick={() => setElimResult(null)}>
          <div className="elim-modal">
            <div className="elim-avatar" style={{ background: elimResult.accusedColor || '#666' }}>
              {elimResult.accusedAvatar || '❓'}
            </div>
            <div className="elim-name">{elimResult.accusedNickname}</div>
            <div className={`elim-verdict ${elimResult.eliminate ? 'eliminate' : 'spare'}`}>
              {elimResult.eliminate ? '☠️ 처형!' : '🕊️ 살려줌!'}
            </div>
            {elimResult.eliminate && (
              <div className={`elim-reveal ${elimResult.isLiar ? 'liar' : 'citizen'}`}>
                {elimResult.isLiar ? '🎭 라이어였다!' : '😮 시민이었다!'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 헤더 ── */}
      <div className="gp-header">
        <div className="gp-header-left">
          <span className={`state-badge s-${state.toLowerCase()}`}>{stateLabel(state)}</span>
          {(game?.roundCount ?? 1) > 1 && <span className="round-badge">R{game!.roundCount}</span>}
        </div>
        <div className="gp-header-center">
          {state === 'VOTING' && <span className={`timer-badge ${voteCountdown <= 10 ? 'urgent' : ''}`}>⏱ {voteCountdown}s</span>}
          {state === 'SPEAKING' && <span className={`timer-badge ${speakCountdown <= 5 ? 'urgent' : ''}`}>⏱ {speakCountdown}s</span>}
          {state === 'DISCUSSION' && <span className={`timer-badge ${discussCountdown <= 30 ? 'urgent' : ''}`}>💬 {discussCountdown}s</span>}
          {state === 'DEFENSE' && <span className={`timer-badge ${defenseCountdown <= 10 ? 'urgent' : ''}`}>🗣️ {defenseCountdown}s</span>}
          {state === 'ELIMINATION_VOTE' && <span className={`timer-badge ${elimCountdown <= 10 ? 'urgent' : ''}`}>⚖️ {elimCountdown}s</span>}
        </div>
        <div className="gp-header-right">
          <button className="btn btn-ghost btn-sm" onClick={handleLeave}>나가기</button>
        </div>
      </div>

      {/* ── 모바일 제시어 배너 ── */}
      <div className="mobile-word-banner">
        <WordBadge />
      </div>

      {/* ── 본문 ── */}
      <div className="gp-layout">
        {/* 데스크탑 좌측 패널 */}
        <div className="gp-left">
          <div className="panel-label">👥 참가자</div>
          {activePlayers.map(p => {
            const isSpeaker = state === 'SPEAKING' && game?.speakingOrder?.[game.currentSpeakerIndex] === p.userId;
            const isAccused = game?.accusedLiars?.includes(p.userId);
            return (
              <div key={p.userId} className={`player-row ${p.userId === user?.userId ? 'me' : ''} ${isSpeaker ? 'speaking' : ''} ${isAccused ? 'accused' : ''}`}>
                <div className="player-ava" style={{ background: p.color }}>{p.avatar}
                  {isSpeaker && <span className="speak-dot" />}
                </div>
                <div className="player-info">
                  <span className="player-name">{p.nickname}{p.userId === user?.userId ? ' (나)' : ''}</span>
                  <div className="player-badges">
                    {p.userId === room.hostId && <span className="badge badge-purple">👑</span>}
                    {isSpeaker && <span className="badge badge-green">🎤</span>}
                    {isAccused && <span className="badge badge-red">🎯</span>}
                    {(game?.myVote === p.userId) && <span className="badge badge-yellow">✓투표</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {/* 데스크탑 제시어 */}
          <div className="desktop-word-panel">
            <WordBadge />
          </div>
        </div>

        {/* 중앙 메인 */}
        <div className={`gp-main tab-${activeTab}`}>
          {/* 모바일 탭 바 */}
          <div className="mob-tabs">
            {(['game', 'speeches', 'chat'] as TabType[]).map(t => (
              <button
                key={t}
                className={`mob-tab ${activeTab === t ? 'active' : ''}`}
                onClick={() => setActiveTab(t)}
              >
                {t === 'game' ? '🎮 게임' : t === 'speeches' ? '📋 발언' : '💬 채팅'}
              </button>
            ))}
          </div>

          {/* ── 게임 탭 ── */}
          <div className="tab-panel tab-game">
            {state === 'ROLE_ASSIGNMENT' && (
              <div className="phase-center fade-in">
                <div className="phase-icon">🎭</div>
                <h2>역할 배정 완료!</h2>
                {secretInfo && (
                  <div className={`role-card ${secretInfo.isLiar ? 'liar' : 'citizen'}`}>
                    <div className="role-icon">{secretInfo.isLiar ? '🎭' : '✅'}</div>
                    <div className="role-title">{secretInfo.isLiar ? '당신은 라이어!' : '당신은 시민!'}</div>
                    {!secretInfo.isLiar && <div className="role-word">제시어: <strong>{secretInfo.word}</strong></div>}
                    {secretInfo.isLiar && room?.gameMode === 'FOOL' && secretInfo.word && <div className="role-word">내 단어: <strong>{secretInfo.word}</strong></div>}
                    <div className="role-desc">{secretInfo.isLiar ? '시민 발언을 보고 제시어를 추측하세요.' : '제시어를 직접 말하지 말고 힌트를 주세요!'}</div>
                  </div>
                )}
                <p className="muted">잠시 후 발언 단계가 시작됩니다...</p>
              </div>
            )}

            {state === 'SPEAKING' && (
              <div className="phase-col">
                {/* 발언 목록 (발언 단계에서도 표시) */}
                <div className="speak-speeches scroll-area">
                  {game?.speeches.map((sp, i) => {
                    const p = getPlayer(sp.userId);
                    return (
                      <div key={i} className={`speech-item ${sp.userId === user?.userId ? 'mine' : ''}`}>
                        <div className="speech-avatar" style={{ background: p?.color || sp.color }}>{sp.avatar}</div>
                        <div className="speech-bubble">
                          <div className="speech-name">{sp.nickname}</div>
                          <div className={`speech-text ${sp.timedOut ? 'timed-out' : ''}`}>{sp.text}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 발언자 안내 */}
                <div className="speaker-bar">
                  {isMyTurn ? (
                    <div className="my-turn">
                      🎤 내 차례!
                      <span className={`turn-timer ${speakCountdown <= 5 ? 'urgent' : ''}`}>{speakCountdown}s</span>
                    </div>
                  ) : (
                    <div className="other-turn">
                      {game && game.currentSpeakerIndex < (game.speakingOrder?.length ?? 0)
                        ? `🎤 ${getPlayer(game.speakingOrder[game.currentSpeakerIndex])?.nickname || '?'} 발언 중...`
                        : '발언 완료'}
                    </div>
                  )}
                </div>

                {isMyTurn && (
                  <div className="input-row">
                    <input className="input" type="text" placeholder="발언 내용 입력 (제시어 직접 말하지 마세요!)"
                      value={speakInput} onChange={e => setSpeakInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSpeak()} maxLength={200} autoFocus />
                    <button className="btn btn-primary" onClick={handleSpeak}>발언</button>
                  </div>
                )}
              </div>
            )}

            {state === 'DISCUSSION' && (
              <div className="phase-col">
                <div className="discussion-header">
                  <h3>💬 자유 토론</h3>
                  <p>자유롭게 대화하세요. 제시어를 직접 말하지 마세요!</p>
                  {game?.discussionEndTime && (
                    <div className={`disc-timer ${discussCountdown <= 30 ? 'urgent' : ''}`}>
                      토론 종료까지 {discussCountdown}초
                    </div>
                  )}
                </div>

                {/* 발언 내역 토글 (데스크탑) */}
                <button className="speeches-toggle" onClick={() => setShowSpeeches(v => !v)}>
                  📋 발언 내역 {showSpeeches ? '숨기기 ▲' : '보기 ▼'} ({game?.speeches.length || 0}개)
                </button>
                {showSpeeches && <div className="speeches-inline"><SpeechesList /></div>}

                {/* 빠른 투표 */}
                <div className="quick-vote-box">
                  <p>발언을 다 확인했다면 바로 투표할 수 있습니다.</p>
                  <div className="quick-vote-row">
                    <button
                      className={`btn ${quickVoted ? 'btn-secondary' : 'btn-warning'}`}
                      onClick={handleQuickVote} disabled={quickVoted}
                    >
                      {quickVoted ? '✓ 빠른 투표 요청 완료' : '⚡ 빠른 투표'}
                    </button>
                    {(game?.quickVoteCount ?? 0) > 0 && (
                      <span className="quick-count">{game?.quickVoteCount}/{activePlayers.length}명 요청</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {state === 'VOTING' && (
              <div className="phase-col">
                <div className="vote-header">
                  <h3>🗳️ 투표</h3>
                  <p>라이어라고 생각하는 사람에게 투표하세요. (자신 포함)</p>
                  {game?.voteEndTime && <div className={`vote-timer ${voteCountdown <= 10 ? 'urgent' : ''}`}>⏱ {voteCountdown}초</div>}
                  <div className="vote-progress">{game?.voteCount || 0} / {activePlayers.length}명 투표</div>
                </div>

                {!voteSubmitted && !game?.hasVoted ? (
                  <>
                    <div className="candidates">
                      {activePlayers.map(p => (
                        <button
                          key={p.userId}
                          className={`candidate ${selectedVote === p.userId ? 'selected' : ''} ${p.userId === user?.userId ? 'self' : ''}`}
                          onClick={() => setSelectedVote(p.userId)}
                        >
                          <div className="cand-ava" style={{ background: p.color }}>{p.avatar}</div>
                          <div className="cand-name">{p.nickname}{p.userId === user?.userId ? ' (나)' : ''}</div>
                          {selectedVote === p.userId && <div className="cand-check">✓</div>}
                        </button>
                      ))}
                    </div>
                    <button className="btn btn-danger btn-full" onClick={handleVote} disabled={!selectedVote}>
                      투표 확정
                    </button>
                  </>
                ) : (
                  <div className="done-msg"><div className="done-icon">✅</div><div>투표 완료! 다른 참가자를 기다리는 중...</div></div>
                )}
              </div>
            )}

            {state === 'VOTE_RESULT' && (
              <div className="phase-center fade-in">
                <h3>📊 투표 결과</h3>
                {currentAccusedId && (() => {
                  const p = getPlayer(currentAccusedId);
                  return p ? (
                    <div className="big-accused">
                      <div className="big-ava" style={{ background: p.color, borderColor: 'var(--danger)' }}>{p.avatar}</div>
                      <div className="big-name">{p.nickname}</div>
                      <div className="big-label">이(가) 지목되었습니다!</div>
                      <p className="muted">반론 기회를 드립니다...</p>
                    </div>
                  ) : null;
                })()}
                {!currentAccusedId && <div className="muted">동률 또는 유효한 투표가 없어 라운드를 재시작합니다.</div>}
              </div>
            )}

            {state === 'DEFENSE' && (() => {
              const accused = getPlayer(currentAccusedId || '');
              return (
                <div className="phase-col fade-in">
                  <div className="defense-header">
                    <h3>🗣️ 반론 기회</h3>
                    {accused && (
                      <div className="defense-accused">
                        <div className="def-ava" style={{ background: accused.color }}>{accused.avatar}</div>
                        <span>{accused.nickname}의 반론 시간</span>
                      </div>
                    )}
                    <div className={`disc-timer ${defenseCountdown <= 10 ? 'urgent' : ''}`}>{defenseCountdown}초 남음</div>
                  </div>

                  {isCurrentAccused ? (
                    !defenseSubmitted ? (
                      <div className="input-row">
                        <input className="input" type="text" placeholder="한마디 해명을 입력하세요..."
                          value={defenseInput} onChange={e => setDefenseInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleDefense()} maxLength={300} autoFocus />
                        <button className="btn btn-primary" onClick={handleDefense}>제출</button>
                      </div>
                    ) : (
                      <div className="done-msg">✅ 반론 제출 완료</div>
                    )
                  ) : (
                    <div className="done-msg">
                      {game?.defenseText
                        ? <div className="defense-text-box">"{game.defenseText}"</div>
                        : <span className="muted">반론 입력 대기 중...</span>}
                    </div>
                  )}
                </div>
              );
            })()}

            {state === 'ELIMINATION_VOTE' && (() => {
              const accused = getPlayer(currentAccusedId || '');
              const myVoted = game?.myEliminationVote;
              return (
                <div className="phase-col fade-in">
                  <h3>⚖️ 처형 투표</h3>
                  {accused && (
                    <div className="elim-accused">
                      <div className="elim-big-ava" style={{ background: accused.color }}>{accused.avatar}</div>
                      <div className="elim-accused-name">{accused.nickname}</div>
                    </div>
                  )}
                  {game?.defenseText && (
                    <div className="defense-text-box">💬 "{game.defenseText}"</div>
                  )}
                  <div className={`disc-timer ${elimCountdown <= 10 ? 'urgent' : ''}`}>{elimCountdown}초 남음</div>

                  {!elimSubmitted && !myVoted ? (
                    <div className="elim-btns">
                      <button className="btn btn-danger btn-full" onClick={() => handleElimVote('eliminate')}>
                        ☠️ 처형 (라이어인 것 같다)
                      </button>
                      <button className="btn btn-success btn-full" onClick={() => handleElimVote('spare')}>
                        🕊️ 살리기 (라이어가 아닌 것 같다)
                      </button>
                    </div>
                  ) : (
                    <div className="done-msg">
                      <div className="done-icon">{elimChoice === 'eliminate' ? '☠️' : '🕊️'}</div>
                      <div>{elimChoice === 'eliminate' ? '처형' : '살리기'} 투표 완료!</div>
                      <div className="muted">{(game?.eliminateCount ?? 0)}처형 / {(game?.spareCount ?? 0)}살리기</div>
                    </div>
                  )}
                </div>
              );
            })()}

            {state === 'GUESSING' && (
              <div className="phase-center fade-in">
                <h3>🤔 라이어의 마지막 추측</h3>
                {isCurrentAccused && isLiar ? (
                  !guessSubmitted ? (
                    <div className="guess-area">
                      <p>시민의 제시어를 맞추면 라이어 승리!</p>
                      <div className="input-row">
                        <input className="input" type="text" placeholder="제시어를 입력하세요..."
                          value={guessInput} onChange={e => setGuessInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleGuess()} autoFocus />
                        <button className="btn btn-primary" onClick={handleGuess}>제출</button>
                      </div>
                    </div>
                  ) : (
                    <div className="done-msg">✅ 추측 제출 완료: <strong>{guessInput}</strong></div>
                  )
                ) : (
                  <div className="done-msg muted">
                    <p>🎭 {getPlayer(currentAccusedId || '')?.nickname}이 추측 중...</p>
                  </div>
                )}
              </div>
            )}

            {(state === 'GAME_RESULT' || gameResult) && gameResult && (
              <GameResultPanel result={gameResult} room={room} user={user} isHost={isHost} onRestart={handleRestart} onLeave={handleLeave} getPlayer={getPlayer} />
            )}
          </div>

          {/* ── 발언 탭 ── */}
          <div className="tab-panel tab-speeches">
            <div className="tab-panel-title">📋 발언 내역 ({game?.speeches?.length || 0}개)</div>
            <SpeechesList />
          </div>

          {/* ── 채팅 탭 ── */}
          <div className="tab-panel tab-chat">
            <ChatMessages />
          </div>

          {/* 채팅 입력 (항상 하단) */}
          {canChat && (
            <div className="chat-input-area">
              <input
                ref={chatInputRef}
                className="input chat-inp"
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder="메시지 입력..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleChat()}
                maxLength={300}
              />
              <button className="btn btn-primary btn-send" onClick={handleChat} type="button">전송</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function stateLabel(s: string) {
  const m: Record<string, string> = {
    ROLE_ASSIGNMENT: '역할 배정', SPEAKING: '발언', DISCUSSION: '토론',
    VOTING: '투표', VOTE_RESULT: '투표결과', DEFENSE: '반론',
    ELIMINATION_VOTE: '처형투표', GUESSING: '추측', GAME_RESULT: '게임 종료',
  };
  return m[s] || s;
}

function GameResultPanel({ result, room, user, isHost, onRestart, onLeave, getPlayer }: any) {
  const isLiarWin = result.winner === 'liar';
  const allP = room?.players || [];
  const totalConn = allP.filter((p: Player) => p.connected).length;
  const gp = (id: string) => {
    if (result.players) { const p = result.players.find((p: Player) => p.userId === id); if (p) return p; }
    return getPlayer(id);
  };

  return (
    <div className={`result-panel fade-in ${isLiarWin ? 'liar-wins' : 'citizen-wins'}`}>
      <div className="result-winner">{isLiarWin ? '🎭 라이어 승리!' : '✅ 시민 승리!'}</div>
      <div className="result-reason">{reasonText(result.reason)}</div>

      <div className="result-words">
        <div className="result-word-box cit">
          <div className="rw-label">시민 제시어</div>
          <div className="rw-val">{result.citizenWord}</div>
        </div>
        {room?.gameMode === 'FOOL' && result.liarWord && (
          <div className="result-word-box liar-w">
            <div className="rw-label">라이어 단어</div>
            <div className="rw-val">{result.liarWord}</div>
          </div>
        )}
      </div>

      {result.guess && (
        <div className="result-guess">
          라이어 추측: <strong className={result.guess.correct ? 'correct' : 'wrong'}>
            {result.guess.word} {result.guess.correct ? '✅ 정답!' : '❌ 오답'}
          </strong>
        </div>
      )}

      <div className="result-section">
        <div className="rs-title">🎭 라이어 명단</div>
        {result.liars.map((id: string) => {
          const p = gp(id);
          return p ? (
            <div key={id} className="result-liar-row">
              <div className="rl-ava" style={{ background: p.color }}>{p.avatar}</div>
              <span className="rl-name">{p.nickname}</span>
            </div>
          ) : null;
        })}
      </div>

      {result.tally && Object.keys(result.tally).length > 0 && (
        <div className="result-section">
          <div className="rs-title">📊 투표 현황</div>
          {Object.entries(result.tally as Record<string, number>).sort(([, a], [, b]) => b - a).map(([id, cnt]) => {
            const p = gp(id);
            return p ? (
              <div key={id} className="vote-bar-row">
                <span className="vbr-name">{p.nickname}</span>
                <div className="vbr-bar"><div className="vbr-fill" style={{ width: `${(cnt / totalConn) * 100}%` }} /></div>
                <span className="vbr-cnt">{cnt}표</span>
              </div>
            ) : null;
          })}
        </div>
      )}

      <div className="result-actions">
        {isHost ? (
          <>
            <button className="btn btn-success btn-full" onClick={onRestart}>🔄 다시 하기</button>
            <button className="btn btn-ghost btn-full" onClick={onLeave}>🚪 로비로</button>
          </>
        ) : (
          <div className="muted" style={{ textAlign: 'center' }}>
            방장이 다음 라운드를 시작합니다...
            <br /><button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onLeave}>로비로</button>
          </div>
        )}
      </div>
    </div>
  );
}

function reasonText(r: string) {
  const m: Record<string, string> = {
    correct_guess: '라이어가 제시어를 맞췄습니다!', wrong_guess: '라이어가 제시어를 틀렸습니다.',
    wrong_accusation: '시민이 지목되었습니다! 라이어 승리.',
    tie: '투표 동률로 라운드를 재시작합니다.', no_votes: '유효한 투표가 없었습니다.',
    no_guess: '라이어가 추측을 포기했습니다.',
  };
  return m[r] || r;
}
