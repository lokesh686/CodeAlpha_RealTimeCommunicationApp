const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const authRoutes  = require('./routes/auth');
const roomRoutes  = require('./routes/rooms');
const fileRoutes  = require('./routes/files');
const { protect } = require('./middleware/auth');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/auth',  authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/files', fileRoutes);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

// ─── IN-MEMORY STATE ──────────────────────────────────────────────────────
const rooms = {};   // roomId -> { peers: Set<socketId>, messages: [], whiteboardEvents: [] }

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) rooms[roomId] = { peers: new Set(), messages: [], whiteboardEvents: [] };
  return rooms[roomId];
}

// ─── SOCKET.IO ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // ── JOIN ROOM ───────────────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, userId, userName }) => {
    socket.join(roomId);
    socket.data = { roomId, userId, userName };

    const room = getOrCreateRoom(roomId);
    room.peers.add(socket.id);

    // Notify others in room
    socket.to(roomId).emit('user-connected', { socketId: socket.id, userId, userName });

    // Send existing peers to new joiner
    socket.emit('room-peers', {
      peers: [...room.peers].filter(id => id !== socket.id),
      messages: room.messages.slice(-50),
      whiteboardEvents: room.whiteboardEvents
    });

    console.log(`👤 ${userName} joined room ${roomId}`);
  });

  // ── WebRTC SIGNALING ────────────────────────────────────────────────────
  socket.on('webrtc-offer', ({ targetId, offer, userName }) => {
    io.to(targetId).emit('webrtc-offer', { fromId: socket.id, offer, userName });
  });

  socket.on('webrtc-answer', ({ targetId, answer }) => {
    io.to(targetId).emit('webrtc-answer', { fromId: socket.id, answer });
  });

  socket.on('webrtc-ice-candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc-ice-candidate', { fromId: socket.id, candidate });
  });

  // ── SCREEN SHARE ────────────────────────────────────────────────────────
  socket.on('screen-share-started', () => {
    const { roomId, userName } = socket.data;
    socket.to(roomId).emit('screen-share-started', { socketId: socket.id, userName });
  });

  socket.on('screen-share-stopped', () => {
    const { roomId } = socket.data;
    socket.to(roomId).emit('screen-share-stopped', { socketId: socket.id });
  });

  // ── CHAT ────────────────────────────────────────────────────────────────
  socket.on('chat-message', ({ roomId, message }) => {
    const { userName, userId } = socket.data;
    const msg = {
      id: uuidv4(),
      socketId: socket.id,
      userId,
      userName,
      message,
      timestamp: new Date().toISOString()
    };
    const room = getOrCreateRoom(roomId);
    room.messages.push(msg);
    if (room.messages.length > 200) room.messages.shift();
    io.to(roomId).emit('chat-message', msg);
  });

  // ── WHITEBOARD ──────────────────────────────────────────────────────────
  socket.on('whiteboard-draw', ({ roomId, event }) => {
    const room = getOrCreateRoom(roomId);
    room.whiteboardEvents.push(event);
    socket.to(roomId).emit('whiteboard-draw', event);
  });

  socket.on('whiteboard-clear', ({ roomId }) => {
    const room = getOrCreateRoom(roomId);
    room.whiteboardEvents = [];
    socket.to(roomId).emit('whiteboard-clear');
  });

  // ── FILE SHARE NOTIFICATION ─────────────────────────────────────────────
  socket.on('file-shared', ({ roomId, fileInfo }) => {
    socket.to(roomId).emit('file-shared', { ...fileInfo, sharedBy: socket.data.userName });
  });

  // ── DISCONNECT ──────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const { roomId, userName } = socket.data || {};
    if (roomId && rooms[roomId]) {
      rooms[roomId].peers.delete(socket.id);
      if (rooms[roomId].peers.size === 0) delete rooms[roomId];
    }
    if (roomId) socket.to(roomId).emit('user-disconnected', { socketId: socket.id, userName });
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });

  // ── MIC/CAM TOGGLE ──────────────────────────────────────────────────────
  socket.on('media-toggle', ({ roomId, type, enabled }) => {
    socket.to(roomId).emit('media-toggle', { socketId: socket.id, type, enabled });
  });
});

// ─── START ────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    httpServer.listen(process.env.PORT || 5002, () => {
      console.log(`🚀 Real-Time Comm Server on port ${process.env.PORT || 5002}`);
    });
  })
  .catch(err => { console.error('❌', err); process.exit(1); });

module.exports = { app, io };
