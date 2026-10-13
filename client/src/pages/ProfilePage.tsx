import React, { useState } from 'react';
import { getSocket } from '../utils/socket';
import { useGameStore } from '../store/gameStore';
import { AVATAR_OPTIONS, COLOR_OPTIONS } from '../types';
import toast from 'react-hot-toast';
import './ProfilePage.css';

export default function ProfilePage() {
  const { setUser, setPage } = useGameStore();
  const [nickname, setNickname] = useState(localStorage.getItem('liar_nickname') || '');
  const [avatar, setAvatar] = useState(localStorage.getItem('liar_avatar') || '🎭');
  const [color, setColor] = useState(localStorage.getItem('liar_color') || '#6366f1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 16개 무작위 이모지 추출 함수 (현재 선택된 avatar가 있는 경우 포함되도록)
  const getRandom16 = (current?: string) => {
    const pool = [...AVATAR_OPTIONS];
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    let selected16 = shuffled.slice(0, 16);
    if (current && !selected16.includes(current)) {
      selected16[0] = current;
    }
    return selected16;
  };

  const [displayedAvatars, setDisplayedAvatars] = useState<string[]>(() => {
    return getRandom16(avatar);
  });

  const handleShuffleAvatars = () => {
    setDisplayedAvatars(getRandom16(avatar));
  };

  const handleJoin = () => {
    const trimmed = nickname.trim();
    if (!trimmed) { setError('닉네임을 입력해주세요.'); return; }
    if (trimmed.length > 12) { setError('닉네임은 12자 이내로 입력해주세요.'); return; }

    setError('');
    setLoading(true);

    const socket = getSocket();
    const sessionId = localStorage.getItem('liar_session_id') || undefined;

    const doJoin = () => {
      socket.emit('user:join', { sessionId, nickname: trimmed, avatar, color }, (res: any) => {
        setLoading(false);
        if (res.error) {
          setError(res.error);
          toast.error(res.error);
          return;
        }
        localStorage.setItem('liar_session_id', res.sessionId);
        localStorage.setItem('liar_nickname', trimmed);
        localStorage.setItem('liar_avatar', avatar);
        localStorage.setItem('liar_color', color);
        setUser(res);
        if (res.roomId) {
          setPage('room');
        } else {
          setPage('lobby');
          socket.emit('lobby:subscribe');
        }
        toast.success(`환영합니다, ${trimmed}님!`);
      });
    };

    if (socket.connected) {
      doJoin();
    } else {
      socket.connect();
      socket.once('connect', doJoin);
      socket.once('connect_error', () => {
        setLoading(false);
        setError('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.');
        toast.error('서버 연결 실패');
      });
    }
  };

  return (
    <div className="profile-page">
      <div className="profile-hero">
        <div className="profile-logo">🎭</div>
        <h1 className="profile-title">라이어 게임</h1>
        <p className="profile-subtitle">친구들과 함께하는 실시간 온라인 라이어 게임</p>
      </div>

      <div className="profile-card">
        <h2 className="profile-card-title">프로필 설정</h2>

        {/* 아바타 선택 */}
        <div className="avatar-section-wrapper">
          <div className="avatar-header-row">
            <span className="input-label">인물 인장 (이모지 선택)</span>
            <button
              type="button"
              className="btn-shuffle-avatar"
              onClick={handleShuffleAvatars}
              title="16개 이모지 새로고침"
            >
              🎲 무작위 16개 변경
            </button>
          </div>
          <div className="avatar-section">
            <div className="avatar-preview" style={{ background: color }}>
              {avatar}
            </div>
            <div className="avatar-grid-16">
              {displayedAvatars.map((a, idx) => (
                <button
                  key={`${a}-${idx}`}
                  type="button"
                  className={`avatar-btn ${avatar === a ? 'selected' : ''}`}
                  onClick={() => setAvatar(a)}
                  title={`이모지 선택: ${a}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 색상 선택 */}
        <div className="color-section">
          <span className="input-label">프로필 색상</span>
          <div className="color-grid">
            {COLOR_OPTIONS.map(c => (
              <button
                key={c}
                className={`color-btn ${color === c ? 'selected' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
        </div>

        {/* 닉네임 입력 */}
        <div className="input-group">
          <label className="input-label" htmlFor="nickname">닉네임</label>
          <input
            id="nickname"
            className="input"
            type="text"
            placeholder="닉네임을 입력하세요 (최대 12자)"
            value={nickname}
            onChange={e => { setNickname(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            maxLength={12}
            autoFocus
          />
          <div className="nickname-count">{nickname.length}/12</div>
          {error && <span className="input-error">{error}</span>}
        </div>

        <button
          className={`btn btn-primary btn-full btn-lg ${loading ? 'loading' : ''}`}
          onClick={handleJoin}
          disabled={loading}
        >
          {loading ? '접속 중...' : '게임 시작하기'}
        </button>

        <div className="server-info">
          <span>서버: </span>
          <code>{import.meta.env.VITE_SERVER_URL || (typeof window !== 'undefined' && window.location.hostname.includes('onrender.com') ? 'https://liarrrrgame.onrender.com' : 'http://localhost:3001')}</code>
        </div>
      </div>

      <div className="profile-features">
        <div className="feature-item">
          <span className="feature-icon">🎮</span>
          <span>실시간 멀티플레이</span>
        </div>
        <div className="feature-item">
          <span className="feature-icon">🗣️</span>
          <span>자유 토론 & 순서 발언</span>
        </div>
        <div className="feature-item">
          <span className="feature-icon">🕵️</span>
          <span>일반 & 바보 모드</span>
        </div>
      </div>
    </div>
  );
}
