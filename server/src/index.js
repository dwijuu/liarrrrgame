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

// CORS 설정 (로컬 및 Render 배포 주소 모두 허용)
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://liarrrrgame-1.onrender.com',
  CLIENT_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // 모바일 앱이나 Postman 등 origin이 없는 경우 또는 허용된 origin
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.onrender.com')) {
      callback(null, true);
    } else {
      callback(null, true); // 배포 편의상 허용
    }
  },
  credentials: true,
  methods: ['GET', 'POST'],
};

app.use(cors(corsOptions));
app.use(express.json());

const io = new Server(server, {
  cors: corsOptions,
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
