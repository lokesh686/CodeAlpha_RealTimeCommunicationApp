const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { protect } = require('../middleware/auth');

// POST /api/rooms
router.post('/', protect, (req, res) => {
  try {
    const { name, password, maxParticipants } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Room name required' });
    const roomId = uuidv4().slice(0, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare('INSERT INTO rooms (roomId, name, hostId, password, isLocked, maxParticipants, expiresAt) VALUES (?,?,?,?,?,?,?)')
      .run(roomId, name, req.user.id, password || '', password ? 1 : 0, maxParticipants || 10, expiresAt);
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, room: { ...room, _id: room.id } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /api/rooms/:roomId/join
router.post('/:roomId/join', protect, (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE roomId=?').get(req.params.roomId);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
  if (room.isLocked && room.password !== req.body.password)
    return res.status(403).json({ success: false, message: 'Wrong room password' });
  const host = db.prepare('SELECT id, name FROM users WHERE id=?').get(room.hostId);
  res.json({ success: true, room: { ...room, _id: room.id, host } });
});

// GET /api/rooms
router.get('/', protect, (req, res) => {
  const now = new Date().toISOString();
  const rooms = db.prepare('SELECT * FROM rooms WHERE isLocked=0 AND expiresAt > ? ORDER BY createdAt DESC LIMIT 20').all(now)
    .map(r => {
      const host = db.prepare('SELECT id, name FROM users WHERE id=?').get(r.hostId);
      return { ...r, _id: r.id, host };
    });
  res.json({ success: true, rooms });
});

module.exports = router;
