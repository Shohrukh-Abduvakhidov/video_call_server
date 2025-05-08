const express = require('express');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Генерация уникальной комнаты
app.get('/create-room', (req, res) => {
  const roomId = uuidv4();
  // Получаем порт сервера (по умолчанию 3000)
  const port = server.address().port || 3000;
  // Генерируем roomId с http
  const httpRoomId = `http${roomId}`;
  // Генерируем полный url комнаты
  const url = `http://localhost:${port}/room/${roomId}`;
  res.json({ roomId: httpRoomId, url });
});

// (Маршрут для фронта, не обязательно отдаёт страницу)
app.get('/room/:roomId', (req, res) => {
  res.json({ roomId: req.params.roomId });
});

// Хранение пользователей в комнатах
const rooms = {};

// --- getSocketIdByUserId больше не нужен ---

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId }) => {
    // userId всегда равен socket.id
    console.log('[server] join-room:', { roomId, userId: socket.id });
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = new Set();
    rooms[roomId].add(socket.id);
    // Уведомить других пользователей
    socket.to(roomId).emit('user-joined', socket.id);

    // Список пользователей в комнате (для новых участников)
    socket.emit('all-users', Array.from(rooms[roomId]).filter(id => id !== socket.id));

    // Signaling события
    socket.on('offer', ({ to, offer }) => {
      if (!to || typeof to !== 'string') {
        console.warn('[server] offer: invalid to:', to, 'from:', socket.id);
        return;
      }
      console.log('[server] offer:', { from: socket.id, to });
      io.to(to).emit('offer', { from: socket.id, offer });
    });
    socket.on('answer', ({ to, answer }) => {
      if (!to || typeof to !== 'string') {
        console.warn('[server] answer: invalid to:', to, 'from:', socket.id);
        return;
      }
      console.log('[server] answer:', { from: socket.id, to });
      io.to(to).emit('answer', { from: socket.id, answer });
    });
    socket.on('ice-candidate', ({ to, candidate }) => {
      if (!to || typeof to !== 'string') {
        console.warn('[server] ice-candidate: invalid to:', to, 'from:', socket.id);
        return;
      }
      console.log('[server] ice-candidate:', { from: socket.id, to });
      io.to(to).emit('ice-candidate', { from: socket.id, candidate });
    });

    // Удаление пользователя при отключении
    socket.on('disconnect', () => {
      if (rooms[roomId]) {
        rooms[roomId].delete(socket.id);
        socket.to(roomId).emit('user-left', socket.id);
        if (rooms[roomId].size === 0) delete rooms[roomId];
      }
    });
    // Выйти из комнаты вручную
    socket.on('leave-room', () => {
      if (rooms[roomId]) {
        rooms[roomId].delete(socket.id);
        socket.leave(roomId);
        socket.to(roomId).emit('user-left', socket.id);
        if (rooms[roomId].size === 0) delete rooms[roomId];
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
