import React, { useState, useRef, useEffect } from 'react';
import { getSocket } from '../utils/socket';
import { useGameStore } from '../store/gameStore';
import type { Room } from '../types';
import { TOPICS, TOPIC_LABELS } from '../types';
import toast from 'react-hot-toast';
import './RoomPage.css';

export default function RoomPage() {
  const { user, room, setRoom, setPage, setSecretInfo, setGameResult } = useGameStore();
  const [chatInput, setChatInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isHost = room?.hostId === user?.userId;
  const activePlayers = room?.players.filter(p => p.connected) || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room?.messages]);

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

  const handleStartGame = () => {
    const socket = getSocket();
    socket.emit('game:start', {}, (res: any) => {
      if (res.error) toast.error(res.error);
    });
  };

  const handleSendChat = () => {
    if (!chatInput.trim()) return;
    const socket = getSocket();
    socket.emit('game:chat', { text: chatInput }, (res: any) => {
      if (res.error) toast.error(res.error);
    });
    setChatInput('');
  };

  if (!room) return null;

  return (
    <div className="room-page">
      {/* 좌측: 참가자 + 설정 */}
      <div className="room-sidebar">
        <div className="room-info">
          <div className="room-info-name">
            {room.isPrivate && '🔒'} {room.name}
          </div>
          <div className="room-info-id">
            방 코드: <strong>{room.roomId}</strong>
          </div>
        </div>

        <div className="players-section">
          <div className="section-header">
            <span className="section-label">참가자</span>
            <span className="player-count">{activePlayers.length}명</span>
          </div>
          <div className="players-list">
            {room.players.map(player => (
              <div
                key={player.userId}
                className={`player-item ${!player.connected ? 'disconnected' : ''} ${player.userId === user?.userId ? 'me' : ''}`}
              >
                <div className="player-avatar" style={{ background: player.color }}>
                  {player.avatar}
                </div>
                <div className="player-info">
                  <span className="player-name">{player.nickname}</span>
                  <div className="player-badges">
                    {player.userId === room.hostId && <span className="badge badge-purple">👑 방장</span>}
                    {player.userId === user?.userId && <span className="badge badge-gray">나</span>}
                    {!player.connected && <span className="badge badge-red">오프라인</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 게임 설정 표시 */}
        <div className="game-settings-display">
          <div className="settings-row">
            <span>모드</span>
            <span>{room.gameMode === 'FOOL' ? '🤪 바보' : '🕵️ 일반'}</span>
          </div>
          <div className="settings-row">
            <span>주제</span>
            <span>{TOPIC_LABELS[room.topic] || room.topic}</span>
          </div>
          <div className="settings-row">
            <span>라이어</span>
            <span>{room.liarCount}명</span>
          </div>
          <div className="settings-row">
            <span>발언</span>
            <span>{room.speakingMode === 'SEQUENTIAL' ? '🔄 순서대로' : '💬 자유'}</span>
          </div>
          <div className="settings-row">
            <span>투표 시간</span>
            <span>{room.voteTimeLimit}초</span>
          </div>
        </div>

        {/* 방장 설정 버튼 */}
        {isHost && (
          <button
            className="btn btn-ghost btn-sm btn-full"
            onClick={() => setShowSettings(true)}
          >
            ⚙️ 설정 변경
          </button>
        )}

        {/* 시작 / 나가기 */}
        <div className="room-actions">
          {isHost ? (
            <button
              className="btn btn-success btn-full btn-lg"
              onClick={handleStartGame}
              disabled={activePlayers.length < room.minPlayers}
              title={activePlayers.length < room.minPlayers ? `최소 ${room.minPlayers}명 필요` : ''}
            >
              🎮 게임 시작 ({activePlayers.length}/{room.minPlayers}명 이상)
            </button>
          ) : (
            <div className="waiting-info">
              <span>⏳ 방장이 게임을 시작할 때까지 대기 중...</span>
            </div>
          )}
          <button className="btn btn-danger btn-full" onClick={handleLeave}>
            🚪 방 나가기
          </button>
        </div>
      </div>

      {/* 우측: 채팅 */}
      <div className="room-chat">
        <div className="chat-header">💬 대기실 채팅</div>
        <div className="chat-messages scroll-area">
          {room.messages.length === 0 ? (
            <div className="chat-empty">채팅이 시작되면 여기에 표시됩니다.</div>
          ) : (
            room.messages.map(msg => (
              <div
                key={msg.id}
                className={`chat-msg ${msg.type === 'system' ? 'system' : msg.userId === user?.userId ? 'mine' : ''}`}
              >
                {msg.type === 'system' ? (
                  <span className="system-msg">{msg.text}</span>
                ) : (
                  <>
                    <div className="msg-avatar" style={{ background: msg.color }}>
                      {msg.avatar}
                    </div>
                    <div className="msg-content">
                      <div className="msg-name">{msg.nickname}</div>
                      <div className="msg-text">{msg.text}</div>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="chat-input-row">
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
      </div>

      {/* 설정 모달 */}
      {showSettings && isHost && (
        <SettingsModal room={room} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function SettingsModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const [name, setName] = useState(room.name);
  const [gameMode, setGameMode] = useState(room.gameMode);
  const [speakingMode, setSpeakingMode] = useState(room.speakingMode);
  const [topic, setTopic] = useState(room.topic);
  const [liarCount, setLiarCount] = useState(room.liarCount);
  const [voteTimeLimit, setVoteTimeLimit] = useState(room.voteTimeLimit);
  const [speakTimeLimit, setSpeakTimeLimit] = useState(room.speakTimeLimit);
  const [tieRule, setTieRule] = useState(room.tieRule);
  const [customWords, setCustomWords] = useState((room.customWords || []).join('\n'));
  const [loading, setLoading] = useState(false);

  const handleSave = () => {
    setLoading(true);
    const socket = getSocket();
    const parsedCustom = customWords.split('\n').map(w => w.trim()).filter(w => w);
    socket.emit('room:update_settings', {
      name: name.trim(),
      gameMode,
      speakingMode,
      topic,
      liarCount,
      voteTimeLimit,
      speakTimeLimit,
      tieRule,
      customWords: [...new Set(parsedCustom)],
    }, (res: any) => {
      setLoading(false);
      if (res.error) { toast.error(res.error); return; }
      onClose();
      toast.success('설정이 저장되었습니다.');
    });
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-title">⚙️ 방 설정 변경</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '65vh', overflowY: 'auto' }}>
          <div className="input-group">
            <label className="input-label">방 이름</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={30} />
          </div>
          <div className="input-group">
            <label className="input-label">게임 모드</label>
            <select className="input" value={gameMode} onChange={e => setGameMode(e.target.value as any)}>
              <option value="NORMAL">🕵️ 일반 모드</option>
              <option value="FOOL">🤪 바보 모드</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">발언 방식</label>
            <select className="input" value={speakingMode} onChange={e => setSpeakingMode(e.target.value as any)}>
              <option value="SEQUENTIAL">🔄 순서대로</option>
              <option value="FREE">💬 자유 토론</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">주제</label>
            <select className="input" value={topic} onChange={e => setTopic(e.target.value)}>
              {TOPICS.map(t => <option key={t} value={t}>{TOPIC_LABELS[t] || t}</option>)}
            </select>
          </div>
          {topic === '커스텀' && (
            <div className="input-group">
              <label className="input-label">커스텀 제시어 (한 줄에 하나)</label>
              <textarea className="input" rows={4} value={customWords} onChange={e => setCustomWords(e.target.value)} />
            </div>
          )}
          <div className="input-group">
            <label className="input-label">라이어 수: {liarCount}명</label>
            <input className="input" type="range" min={1} max={5} value={liarCount} onChange={e => setLiarCount(Number(e.target.value))} />
          </div>
          <div className="input-group">
            <label className="input-label">투표 제한 시간: {voteTimeLimit}초</label>
            <input className="input" type="range" min={30} max={180} step={10} value={voteTimeLimit} onChange={e => setVoteTimeLimit(Number(e.target.value))} />
          </div>
          {speakingMode === 'SEQUENTIAL' && (
            <div className="input-group">
              <label className="input-label">발언 제한 시간: {speakTimeLimit}초</label>
              <input className="input" type="range" min={10} max={120} step={5} value={speakTimeLimit} onChange={e => setSpeakTimeLimit(Number(e.target.value))} />
            </div>
          )}
          <div className="input-group">
            <label className="input-label">동률 처리</label>
            <select className="input" value={tieRule} onChange={e => setTieRule(e.target.value as any)}>
              <option value="LIAR_WINS">라이어 승리</option>
              <option value="REVOTE">재투표</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>취소</button>
          <button className={`btn btn-primary ${loading ? 'loading' : ''}`} style={{ flex: 1 }} onClick={handleSave} disabled={loading}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
