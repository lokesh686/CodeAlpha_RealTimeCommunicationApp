# 🎥 Task 4 — MeetAlpha Real-Time Communication App

> CodeAlpha Full Stack Internship — Task 4

A full-featured video conferencing app with screen sharing, collaborative whiteboard, file sharing, real-time chat, and end-to-end encryption via WebRTC.

## Tech Stack
- **Frontend:** HTML, CSS (Space Grotesk design), Vanilla JavaScript
- **Backend:** Node.js, Express.js, Socket.io
- **Real-time:** WebRTC (peer-to-peer video), Socket.io (signaling + chat)
- **Database:** MongoDB + Mongoose
- **Auth:** JWT + bcrypt
- **File Upload:** Multer

## Features
- ✅ User authentication (register / login)
- ✅ Create & join meeting rooms (with optional password)
- ✅ **Multi-user video calling** via WebRTC
- ✅ **Screen sharing** (replaces video track in real-time)
- ✅ **Collaborative whiteboard** — pen, line, rect, circle, text, eraser; synced live
- ✅ **Real-time chat** with message history replay for late joiners
- ✅ **File sharing** — upload and download files in-meeting
- ✅ Mic & camera toggle (notifies other participants)
- ✅ Meeting timer
- ✅ Public room browser in lobby
- ✅ **Data encryption** via WebRTC DTLS (built-in) + HTTPS in production

## Architecture
```
Browser A ←──── WebRTC (P2P encrypted) ────→ Browser B
     ↓                                             ↓
     └──────── Socket.io (signaling) ─────────────┘
                       ↕
               Express.js Server
                       ↕
                   MongoDB
```

## Project Structure
```
Task4_RealTimeComm/
├── backend/
│   ├── models/       # User, Room
│   ├── routes/       # auth, rooms, files
│   ├── middleware/   # JWT auth
│   ├── uploads/      # Uploaded files (gitignored)
│   ├── server.js     # Express + Socket.io
│   └── package.json
└── frontend/
    ├── index.html
    ├── css/style.css
    └── js/app.js     # WebRTC + Socket.io + Whiteboard
```

## Setup & Run

```bash
cd backend
npm install
cp .env.example .env
# Set MONGO_URI and JWT_SECRET in .env
npm run dev
```
Open: `http://localhost:5002`

## Socket.io Events
| Event | Direction | Description |
|-------|-----------|-------------|
| join-room | Client→Server | Join a meeting room |
| room-peers | Server→Client | Existing peers + history |
| user-connected | Server→Clients | New participant joined |
| webrtc-offer | Client→Server | WebRTC offer (signaling) |
| webrtc-answer | Client→Server | WebRTC answer |
| webrtc-ice-candidate | Client→Server | ICE candidate |
| chat-message | Client↔Server | Real-time chat |
| whiteboard-draw | Client↔Server | Whiteboard drawing event |
| whiteboard-clear | Client↔Server | Clear whiteboard |
| screen-share-started | Client→Server | Screen sharing started |
| file-shared | Client↔Server | File uploaded notification |
| media-toggle | Client↔Server | Mic/cam status update |
| user-disconnected | Server→Clients | Participant left |

## Security
- JWT authentication for all API routes
- Room password protection (optional)
- WebRTC uses DTLS encryption (peer-to-peer, end-to-end)
- File upload validation (type + size limits)

## GitHub Repo
`CodeAlpha_RealTimeCommunicationApp`
