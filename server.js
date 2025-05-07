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
  const httpRoomId = `http://${roomId}`;
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

io.on('connection', (socket) => {
  socket.on('join-room', (roomId, userId) => {
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = new Set();
    rooms[roomId].add(userId);
    // Уведомить других пользователей
    socket.to(roomId).emit('user-joined', userId);

    // Список пользователей в комнате (для новых участников)
    socket.emit('all-users', Array.from(rooms[roomId]).filter(id => id !== userId));

    // Signaling события
    socket.on('offer', (data) => {
      socket.to(roomId).emit('offer', data);
    });
    socket.on('answer', (data) => {
      socket.to(roomId).emit('answer', data);
    });
    socket.on('ice-candidate', (data) => {
      socket.to(roomId).emit('ice-candidate', data);
    });

    // Удаление пользователя при отключении
    socket.on('disconnect', () => {
      if (rooms[roomId]) {
        rooms[roomId].delete(userId);
        socket.to(roomId).emit('user-left', userId);
        if (rooms[roomId].size === 0) delete rooms[roomId];
      }
    });
    // Выйти из комнаты вручную
    socket.on('leave-room', () => {
      if (rooms[roomId]) {
        rooms[roomId].delete(userId);
        socket.leave(roomId);
        socket.to(roomId).emit('user-left', userId);
        if (rooms[roomId].size === 0) delete rooms[roomId];
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
