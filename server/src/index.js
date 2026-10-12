require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { setupSocketHandlers } = require('./socketHandlers');

const app = express();
const server = http.createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const PORT = process.env.PORT || 3001;

// CORS 설정
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 10000,
});

// Socket.IO 이벤트 핸들러 (game:start_voting 포함 모두 설정)
setupSocketHandlers(io);

// 헬스 체크
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

server.listen(PORT, () => {
  console.log(`🎮 라이어게임 서버 시작: http://localhost:${PORT}`);
  console.log(`📡 클라이언트: ${CLIENT_URL}`);
});
