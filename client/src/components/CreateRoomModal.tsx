import React, { useState } from 'react';
import { getSocket } from '../utils/socket';
import { useGameStore } from '../store/gameStore';
import { TOPICS, TOPIC_LABELS } from '../types';
import { getSavedCustomWords, saveCustomWords, addCustomWord, deleteCustomWord } from '../utils/customWordsStorage';
import toast from 'react-hot-toast';
import './CreateRoomModal.css';

interface Props {
  onClose: () => void;
}

export default function CreateRoomModal({ onClose }: Props) {
  const { user, setRoom, setPage } = useGameStore();
  const [name, setName] = useState(`${user?.nickname}의 방`);
  const [password, setPassword] = useState('');
  const [gameMode, setGameMode] = useState<'NORMAL' | 'FOOL'>('FOOL');
  const [speakingMode, setSpeakingMode] = useState<'SEQUENTIAL' | 'FREE'>('SEQUENTIAL');
  const [topic, setTopic] = useState('랜덤');
  const [savedWords, setSavedWords] = useState<string[]>(() => getSavedCustomWords());
  const [newWordInput, setNewWordInput] = useState('');
  const [customWords, setCustomWords] = useState(() => getSavedCustomWords().join('\n'));
  const [liarCount, setLiarCount] = useState(1);
  const [voteTimeLimit, setVoteTimeLimit] = useState(60);
  const [speakTimeLimit, setSpeakTimeLimit] = useState(30);
  const [tieRule, setTieRule] = useState<'LIAR_WINS' | 'REVOTE'>('LIAR_WINS');
  const [loading, setLoading] = useState(false);

  // textarea 변경 시 동기화 및 저장
  const handleCustomWordsTextChange = (text: string) => {
    setCustomWords(text);
    const parsed = text.split('\n').map(w => w.trim()).filter(w => w.length > 0);
    const unique = [...new Set(parsed)];
    setSavedWords(unique);
    saveCustomWords(unique);
  };

  const handleAddSingleWord = () => {
    const trimmed = newWordInput.trim();
    if (!trimmed) return;
    if (savedWords.includes(trimmed)) {
      toast.error('이미 존재하는 단어입니다.');
      return;
    }
    const updated = addCustomWord(trimmed);
    setSavedWords(updated);
    setCustomWords(updated.join('\n'));
    setNewWordInput('');
  };

  const handleDeleteWord = (word: string) => {
    const updated = deleteCustomWord(word);
    setSavedWords(updated);
    setCustomWords(updated.join('\n'));
  };

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
      toast.error('바보 모드에서는 시민/라이어가 서로 다른 단어를 받으므로 최소 2개가 필요합니다.');
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
                className={`toggle-btn ${gameMode === 'FOOL' ? 'active' : ''}`}
                onClick={() => setGameMode('FOOL')}
              >
                🤪 바보 모드 (기본)
              </button>
              <button
                className={`toggle-btn ${gameMode === 'NORMAL' ? 'active' : ''}`}
                onClick={() => setGameMode('NORMAL')}
              >
                🕵️ 일반 모드
              </button>
            </div>
            <div className="mode-desc">
              {gameMode === 'FOOL'
                ? '모든 사람에게 키워드가 주어지며, 내가 시민인지 라이어인지 모른 채 진행됩니다!'
                : '라이어에게는 제시어가 없습니다. (라이어가 자신의 역할을 알고 시작)'}
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
            <div className="input-group custom-words-group">
              <label className="input-label">
                📂 보관된 커스텀 제시어 (자동 저장됨)
                {gameMode === 'FOOL' && <span className="mode-warn"> · 바보 모드: 시민/라이어가 각자 다른 단어를 받으므로 최소 2개 필요</span>}
              </label>

              {/* 개별 단어 빠른 추가 */}
              <div className="custom-word-add-bar">
                <input
                  className="input"
                  type="text"
                  placeholder="새 단어 입력 후 추가"
                  value={newWordInput}
                  onChange={e => setNewWordInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSingleWord();
                    }
                  }}
                  maxLength={20}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddSingleWord}>
                  + 단어 추가
                </button>
              </div>

              {/* 저장된 단어 태그 및 삭제/수정 */}
              {savedWords.length > 0 && (
                <div className="custom-words-preview">
                  {savedWords.map(w => (
                    <span key={w} className="tag custom-tag">
                      <span className="tag-text">{w}</span>
                      <button
                        type="button"
                        className="tag-delete-btn"
                        onClick={() => handleDeleteWord(w)}
                        title="단어 삭제"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <details className="custom-words-details">
                <summary className="custom-words-summary">📝 텍스트로 일괄 편집 / 줄바꿈 입력</summary>
                <textarea
                  className="input custom-textarea"
                  rows={4}
                  value={customWords}
                  onChange={e => handleCustomWordsTextChange(e.target.value)}
                  placeholder={'사과\n파인애플\n수박\n...'}
                />
              </details>
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
