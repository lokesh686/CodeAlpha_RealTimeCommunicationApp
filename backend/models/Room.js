const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  name: { type: String, required: true, maxlength: 100 },
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  password: { type: String, default: '' },
  isLocked: { type: Boolean, default: false },
  maxParticipants: { type: Number, default: 10 },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) }
});

module.exports = mongoose.model('Room', roomSchema);
