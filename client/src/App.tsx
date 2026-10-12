import React from 'react';
import { Toaster } from 'react-hot-toast';
import { useSocketEvents } from './hooks/useSocketEvents';
import { useGameStore } from './store/gameStore';
import ProfilePage from './pages/ProfilePage';
import LobbyPage from './pages/LobbyPage';
import RoomPage from './pages/RoomPage';
import GamePage from './pages/GamePage';
import './styles/global.css';

export default function App() {
  useSocketEvents();

  const { page, connected } = useGameStore();

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: '#1a1a2e',
            color: '#f1f5f9',
            border: '1px solid #2d2d4e',
            borderRadius: '10px',
            fontSize: '14px',
          },
          duration: 3000,
        }}
      />

      {!connected && page !== 'profile' && (
        <div className="connection-bar">
          ⚠️ 서버에 연결 중... 잠시 후 재시도합니다.
        </div>
      )}

      {page === 'profile' && <ProfilePage />}
      {page === 'lobby' && <LobbyPage />}
      {page === 'room' && <RoomPage />}
      {page === 'game' && <GamePage />}
    </>
  );
}
