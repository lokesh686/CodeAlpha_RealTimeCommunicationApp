const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const Room = require('../models/Room');
const { protect } = require('../middleware/auth');

// Create room
router.post('/', protect, async (req, res) => {
  try {
    const { name, password, maxParticipants } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Room name required' });
    const roomId = uuidv4().slice(0, 8).toUpperCase();
    const room = await Room.create({
      roomId, name,
      host: req.user._id,
      password: password || '',
      isLocked: !!password,
      maxParticipants: maxParticipants || 10
    });
    res.status(201).json({ success: true, room });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Join room (verify password if locked)
router.post('/:roomId/join', protect, async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId }).populate('host', 'name');
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    if (room.isLocked && room.password !== req.body.password)
      return res.status(403).json({ success: false, message: 'Wrong room password' });
    res.json({ success: true, room });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// List recent public rooms
router.get('/', protect, async (req, res) => {
  try {
    const rooms = await Room.find({ isLocked: false, expiresAt: { $gt: new Date() } })
      .populate('host', 'name')
      .sort({ createdAt: -1 })
      .limit(20);
    res.json({ success: true, rooms });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
