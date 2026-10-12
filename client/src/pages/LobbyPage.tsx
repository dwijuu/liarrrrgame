import React, { useEffect, useState } from 'react';
import { getSocket } from '../utils/socket';
import { useGameStore } from '../store/gameStore';
import type { RoomListItem } from '../types';
import CreateRoomModal from '../components/CreateRoomModal';
import toast from 'react-hot-toast';
import './LobbyPage.css';

export default function LobbyPage() {
  const { user, roomList, setRoomList, setRoom, setPage, setSecretInfo, setGameResult } = useGameStore();
  const [showCreate, setShowCreate] = useState(false);
  const [joinLoading, setJoinLoading] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordRoomId, setPasswordRoomId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('lobby:subscribe');
    loadRooms();
    return () => { socket.emit('lobby:unsubscribe'); };
  }, []);

  const loadRooms = () => {
    setRefreshing(true);
    const socket = getSocket();
    socket.emit('lobby:get_rooms', {}, (res: { rooms: RoomListItem[] }) => {
      setRoomList(res.rooms || []);
      setRefreshing(false);
    });
  };

  const handleJoinRoom = (room: RoomListItem, password?: string) => {
    if (room.state !== 'LOBBY') {
      toast.error('게임이 진행 중인 방에는 입장할 수 없습니다.');
      return;
    }
    if (room.isPrivate && !password) {
      setPasswordRoomId(room.roomId);
      return;
    }

    setJoinLoading(room.roomId);
    const socket = getSocket();
    socket.emit('room:join', { roomId: room.roomId, password: password || '' }, (res: any) => {
      setJoinLoading(null);
      if (res.error) {
        toast.error(res.error);
        if (password !== undefined) setPasswordRoomId(null);
        return;
      }
      setRoom(res.room);
      setSecretInfo(null);
      setGameResult(null);
      setPage('room');
      setPasswordRoomId(null);
    });
  };

  const getStateLabel = (state: string) => {
    const labels: Record<string, { text: string; cls: string }> = {
      LOBBY: { text: '대기 중', cls: 'badge-green' },
      ROLE_ASSIGNMENT: { text: '게임 중', cls: 'badge-yellow' },
      SPEAKING: { text: '게임 중', cls: 'badge-yellow' },
      DISCUSSION: { text: '토론 중', cls: 'badge-yellow' },
      VOTING: { text: '투표 중', cls: 'badge-red' },
      VOTE_RESULT: { text: '게임 중', cls: 'badge-yellow' },
      GUESSING: { text: '게임 중', cls: 'badge-yellow' },
      GAME_RESULT: { text: '결과 확인', cls: 'badge-purple' },
      FINISHED: { text: '종료', cls: 'badge-gray' },
    };
    return labels[state] || { text: state, cls: 'badge-gray' };
  };

  const getModeLabel = (mode: string) => mode === 'FOOL' ? '🤪 바보' : '🕵️ 일반';

  return (
    <div className="lobby-page">
      {/* 헤더 */}
      <div className="lobby-header">
        <div className="lobby-title">🎭 라이어 게임</div>
        <div className="lobby-user">
          <div className="user-avatar-sm" style={{ background: user?.color }}>
            {user?.avatar}
          </div>
          <span className="user-name">{user?.nickname}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              localStorage.removeItem('liar_session_id');
              useGameStore.getState().setUser(null);
              useGameStore.getState().setPage('profile');
            }}
          >
            로그아웃
          </button>
        </div>
      </div>

      <div className="lobby-content">
        {/* 액션 바 */}
        <div className="lobby-actions">
          <div className="lobby-actions-left">
            <h2 className="section-title">방 목록</h2>
            <span className="room-count">{roomList.length}개의 방</span>
          </div>
          <div className="lobby-actions-right">
            <button
              className={`btn btn-ghost btn-sm ${refreshing ? 'loading' : ''}`}
              onClick={loadRooms}
              disabled={refreshing}
            >
              {!refreshing && '🔄'} 새로고침
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + 방 만들기
            </button>
          </div>
        </div>

        {/* 방 목록 */}
        <div className="room-list">
          {roomList.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🏠</div>
              <div className="empty-text">아직 열린 방이 없습니다</div>
              <div className="empty-sub">방을 만들어 게임을 시작해보세요!</div>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                방 만들기
              </button>
            </div>
          ) : (
            roomList.map(room => {
              const stateInfo = getStateLabel(room.state);
              const canJoin = room.state === 'LOBBY';
              return (
                <div key={room.roomId} className="room-card">
                  <div className="room-card-main">
                    <div className="room-card-header">
                      <div className="room-name">
                        {room.isPrivate && <span>🔒</span>}
                        {room.name}
                      </div>
                      <span className={`badge ${stateInfo.cls}`}>{stateInfo.text}</span>
                    </div>
                    <div className="room-card-meta">
                      <span className="room-host">👑 {room.hostName}</span>
                      <span className="room-mode">{getModeLabel(room.gameMode)}</span>
                      <span className="room-topic">📌 {room.topic}</span>
                      <span className="room-players">
                        👥 {room.playerCount}/{room.maxPlayers}명
                      </span>
                    </div>
                  </div>
                  <button
                    className={`btn ${canJoin ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                    disabled={!canJoin || joinLoading === room.roomId}
                    onClick={() => handleJoinRoom(room)}
                  >
                    {joinLoading === room.roomId ? '입장 중...' : canJoin ? '입장' : '불가'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 방 만들기 모달 */}
      {showCreate && <CreateRoomModal onClose={() => setShowCreate(false)} />}

      {/* 비밀번호 모달 */}
      {passwordRoomId && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 340 }}>
            <div className="modal-title">🔒 비밀번호 입력</div>
            <div className="input-group">
              <label className="input-label">방 비밀번호</label>
              <input
                className="input"
                type="password"
                placeholder="비밀번호를 입력하세요"
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const room = roomList.find(r => r.roomId === passwordRoomId);
                    if (room) handleJoinRoom(room, passwordInput);
                  }
                }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => { setPasswordRoomId(null); setPasswordInput(''); }}
              >
                취소
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => {
                  const room = roomList.find(r => r.roomId === passwordRoomId);
                  if (room) handleJoinRoom(room, passwordInput);
                }}
              >
                입장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
