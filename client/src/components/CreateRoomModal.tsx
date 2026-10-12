import React, { useState } from 'react';
import { getSocket } from '../utils/socket';
import { useGameStore } from '../store/gameStore';
import { TOPICS, TOPIC_LABELS } from '../types';
import toast from 'react-hot-toast';
import './CreateRoomModal.css';

interface Props {
  onClose: () => void;
}

export default function CreateRoomModal({ onClose }: Props) {
  const { user, setRoom, setPage } = useGameStore();
  const [name, setName] = useState(`${user?.nickname}의 방`);
  const [password, setPassword] = useState('');
  const [gameMode, setGameMode] = useState<'NORMAL' | 'FOOL'>('NORMAL');
  const [speakingMode, setSpeakingMode] = useState<'SEQUENTIAL' | 'FREE'>('SEQUENTIAL');
  const [topic, setTopic] = useState('랜덤');
  const [customWords, setCustomWords] = useState('');
  const [liarCount, setLiarCount] = useState(1);
  const [voteTimeLimit, setVoteTimeLimit] = useState(60);
  const [speakTimeLimit, setSpeakTimeLimit] = useState(30);
  const [tieRule, setTieRule] = useState<'LIAR_WINS' | 'REVOTE'>('LIAR_WINS');
  const [loading, setLoading] = useState(false);

  const parsedCustomWords = topic === '커스텀'
    ? customWords.split('\n').map(w => w.trim()).filter(w => w.length > 0)
    : [];
  const uniqueCustomWords = [...new Set(parsedCustomWords)];

  const handleCreate = () => {
    if (!name.trim()) { toast.error('방 이름을 입력해주세요.'); return; }
    if (name.length > 30) { toast.error('방 이름은 30자 이내로 입력해주세요.'); return; }
    if (topic === '커스텀' && uniqueCustomWords.length === 0) {
      toast.error('커스텀 주제를 선택했다면 제시어를 최소 1개 입력해주세요.');
      return;
    }
    if (topic === '커스텀' && gameMode === 'FOOL' && uniqueCustomWords.length < 2) {
      toast.error('바보 모드 커스텀 주제는 최소 2개의 제시어가 필요합니다.');
      return;
    }

    setLoading(true);
    const socket = getSocket();
    socket.emit('room:create', {
      name: name.trim(),
      password: password.trim() || null,
      gameMode,
      speakingMode,
      topic,
      customWords: uniqueCustomWords,
      liarCount,
      voteTimeLimit,
      speakTimeLimit,
      tieRule,
    }, (res: any) => {
      setLoading(false);
      if (res.error) { toast.error(res.error); return; }
      setRoom(res.room);
      setPage('room');
      onClose();
    });
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal create-modal">
        <div className="modal-title">🏠 방 만들기</div>

        <div className="create-form">
          {/* 방 이름 */}
          <div className="input-group">
            <label className="input-label">방 이름</label>
            <input
              className="input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={30}
              placeholder="방 이름을 입력하세요"
            />
          </div>

          {/* 비밀번호 */}
          <div className="input-group">
            <label className="input-label">비밀번호 (없으면 공개방)</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="비밀번호 (선택사항)"
            />
          </div>

          <hr className="divider" />

          {/* 게임 모드 */}
          <div className="input-group">
            <label className="input-label">게임 모드</label>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${gameMode === 'NORMAL' ? 'active' : ''}`}
                onClick={() => setGameMode('NORMAL')}
              >
                🕵️ 일반 모드
              </button>
              <button
                className={`toggle-btn ${gameMode === 'FOOL' ? 'active' : ''}`}
                onClick={() => setGameMode('FOOL')}
              >
                🤪 바보 모드
              </button>
            </div>
            <div className="mode-desc">
              {gameMode === 'NORMAL'
                ? '라이어에게는 제시어가 없습니다. 시민의 발언을 보고 추측해야 합니다.'
                : '라이어에게도 단어가 주어지지만, 시민과 다른 연관 단어입니다.'}
            </div>
          </div>

          {/* 발언 방식 */}
          <div className="input-group">
            <label className="input-label">발언 방식</label>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${speakingMode === 'SEQUENTIAL' ? 'active' : ''}`}
                onClick={() => setSpeakingMode('SEQUENTIAL')}
              >
                🔄 순서대로
              </button>
              <button
                className={`toggle-btn ${speakingMode === 'FREE' ? 'active' : ''}`}
                onClick={() => setSpeakingMode('FREE')}
              >
                💬 자유 토론
              </button>
            </div>
          </div>

          {/* 주제 */}
          <div className="input-group">
            <label className="input-label">주제</label>
            <select
              className="input"
              value={topic}
              onChange={e => setTopic(e.target.value)}
            >
              {TOPICS.map(t => (
                <option key={t} value={t}>{TOPIC_LABELS[t] || t}</option>
              ))}
            </select>
          </div>

          {/* 커스텀 단어 입력 */}
          {topic === '커스텀' && (
            <div className="input-group">
              <label className="input-label">
                커스텀 제시어 목록 (한 줄에 하나씩)
                {gameMode === 'FOOL' && <span className="mode-warn"> · 바보 모드: 두 단어씩 쌍으로 사용됩니다</span>}
              </label>
              <textarea
                className="input"
                rows={5}
                value={customWords}
                onChange={e => setCustomWords(e.target.value)}
                placeholder={'사과\n파인애플\n수박\n...'}
              />
              {uniqueCustomWords.length > 0 && (
                <div className="custom-words-preview">
                  {uniqueCustomWords.map(w => (
                    <span key={w} className="tag">{w}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 라이어 수 */}
          <div className="input-group">
            <label className="input-label">라이어 수: {liarCount}명</label>
            <input
              className="input"
              type="range"
              min={1}
              max={5}
              value={liarCount}
              onChange={e => setLiarCount(Number(e.target.value))}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
              <span>1명</span><span>5명</span>
            </div>
          </div>

          {/* 발언 제한 시간 */}
          {speakingMode === 'SEQUENTIAL' && (
            <div className="input-group">
              <label className="input-label">발언 제한 시간: {speakTimeLimit}초</label>
              <input
                className="input"
                type="range"
                min={10}
                max={120}
                step={5}
                value={speakTimeLimit}
                onChange={e => setSpeakTimeLimit(Number(e.target.value))}
              />
            </div>
          )}

          {/* 투표 제한 시간 */}
          <div className="input-group">
            <label className="input-label">투표 제한 시간: {voteTimeLimit}초</label>
            <input
              className="input"
              type="range"
              min={30}
              max={180}
              step={10}
              value={voteTimeLimit}
              onChange={e => setVoteTimeLimit(Number(e.target.value))}
            />
          </div>

          {/* 동률 처리 */}
          <div className="input-group">
            <label className="input-label">동률 처리</label>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${tieRule === 'LIAR_WINS' ? 'active' : ''}`}
                onClick={() => setTieRule('LIAR_WINS')}
              >
                라이어 승리
              </button>
              <button
                className={`toggle-btn ${tieRule === 'REVOTE' ? 'active' : ''}`}
                onClick={() => setTieRule('REVOTE')}
              >
                재투표
              </button>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>취소</button>
          <button
            className={`btn btn-primary ${loading ? 'loading' : ''}`}
            onClick={handleCreate}
            disabled={loading}
          >
            {loading ? '생성 중...' : '방 만들기'}
          </button>
        </div>
      </div>
    </div>
  );
}
