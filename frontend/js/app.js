'use strict';
const API = '/api';

// ─── STATE ────────────────────────────────────────────────────────────────
let socket = null;
let localStream = null;
let screenStream = null;
let currentUser = null;
let currentRoom = null;
let peers = {};          // socketId -> RTCPeerConnection
let peerNames = {};      // socketId -> name
let micOn = true, camOn = true, screenSharing = false;
let meetingStart = null;
let timerInterval = null;
let activePanelId = 'participants';

// ─── WebRTC CONFIG ────────────────────────────────────────────────────────
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ─── UTILS ───────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('rt_token');
const setToken = t  => localStorage.setItem('rt_token', t);
const getUser  = () => JSON.parse(localStorage.getItem('rt_user') || 'null');
const saveUser = u  => localStorage.setItem('rt_user', JSON.stringify(u));
const clearAuth = () => { localStorage.removeItem('rt_token'); localStorage.removeItem('rt_user'); };

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderLeftColor = type === 'error' ? 'var(--red)' : type === 'success' ? 'var(--green)' : 'var(--blue)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

async function apiFetch(url, opts = {}) {
  opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (getToken()) opts.headers['Authorization'] = 'Bearer ' + getToken();
  const res = await fetch(url, opts);
  return res.json();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function fileEmoji(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return '🖼';
  if (['pdf'].includes(ext)) return '📄';
  if (['mp4','webm'].includes(ext)) return '🎬';
  if (['zip','rar'].includes(ext)) return '📦';
  if (['doc','docx'].includes(ext)) return '📝';
  return '📁';
}

// ─── AUTH SCREEN ─────────────────────────────────────────────────────────
function switchAuthTab(tab) {
  document.querySelectorAll('.atab').forEach((b, i) => b.classList.toggle('active', (i === 0) === (tab === 'login')));
  document.getElementById('atab-login').classList.toggle('active', tab === 'login');
  document.getElementById('atab-register').classList.toggle('active', tab === 'register');
}

async function authLogin() {
  const email = document.getElementById('a-email').value.trim();
  const password = document.getElementById('a-password').value;
  const msg = document.getElementById('a-msg');
  msg.textContent = '';
  if (!email || !password) { msg.textContent = 'Fill all fields'; return; }
  const data = await apiFetch(`${API}/auth/login`, { method: 'POST', body: JSON.stringify({ email, password }) });
  if (data.success) { setToken(data.token); saveUser(data.user); currentUser = data.user; showLobby(); }
  else msg.textContent = data.message;
}

async function authRegister() {
  const name = document.getElementById('r-name').value.trim();
  const email = document.getElementById('r-email').value.trim();
  const password = document.getElementById('r-password').value;
  const msg = document.getElementById('r-msg');
  msg.textContent = '';
  if (!name || !email || !password) { msg.textContent = 'Fill all fields'; return; }
  const data = await apiFetch(`${API}/auth/register`, { method: 'POST', body: JSON.stringify({ name, email, password }) });
  if (data.success) { setToken(data.token); saveUser(data.user); currentUser = data.user; showLobby(); }
  else msg.textContent = data.message;
}

function authLogout() {
  leaveRoom();
  clearAuth(); currentUser = null;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

// ─── LOBBY ───────────────────────────────────────────────────────────────
function showLobby() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('meeting-room').style.display = 'none';
  document.getElementById('lobby').style.display = 'flex';
  document.getElementById('lobby-user').textContent = '👤 ' + currentUser.name;
  loadPublicRooms();
}

async function loadPublicRooms() {
  const el = document.getElementById('public-rooms');
  const data = await apiFetch(`${API}/rooms`);
  if (!data.rooms || data.rooms.length === 0) { el.innerHTML = '<div class="loading">No open rooms right now.</div>'; return; }
  el.innerHTML = data.rooms.map(r => `
    <div class="public-room-item">
      <div class="public-room-info">
        <strong>${r.name}</strong>
        <span>Host: ${r.host?.name || 'Unknown'} &nbsp;•&nbsp; Up to ${r.maxParticipants} people</span>
      </div>
      <span class="room-code">${r.roomId}</span>
      <button class="btn-secondary btn-sm" onclick="quickJoin('${r.roomId}')">Join</button>
    </div>`).join('');
}

function quickJoin(roomId) {
  document.getElementById('join-code').value = roomId;
  joinRoomByCode();
}

async function createRoom() {
  const name = document.getElementById('room-name').value.trim();
  const password = document.getElementById('room-password').value;
  if (!name) { showToast('Enter a room name', 'error'); return; }
  const data = await apiFetch(`${API}/rooms`, { method: 'POST', body: JSON.stringify({ name, password }) });
  if (data.success) { currentRoom = data.room; enterMeeting(); }
  else showToast(data.message, 'error');
}

async function joinRoomByCode() {
  const roomId = document.getElementById('join-code').value.trim().toUpperCase();
  const password = document.getElementById('join-password').value;
  if (!roomId) { showToast('Enter a room code', 'error'); return; }
  const data = await apiFetch(`${API}/rooms/${roomId}/join`, { method: 'POST', body: JSON.stringify({ password }) });
  if (data.success) { currentRoom = data.room; enterMeeting(); }
  else showToast(data.message, 'error');
}

// ─── MEETING ROOM ─────────────────────────────────────────────────────────
async function enterMeeting() {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('meeting-room').style.display = 'flex';
  document.getElementById('room-badge').textContent = `${currentRoom.name} · ${currentRoom.roomId}`;

  // Get local media
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('local-video').srcObject = localStream;
    document.getElementById('local-label').textContent = currentUser.name + ' (You)';
  } catch (e) {
    showToast('Camera/mic not available — joining audio-only', 'error');
    try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
    catch { localStream = new MediaStream(); }
  }

  // Start timer
  meetingStart = Date.now();
  timerInterval = setInterval(updateTimer, 1000);

  // Init whiteboard
  initWhiteboard();

  // Connect socket
  connectSocket();

  // Default panel
  showPanel('participants');

  // Add self to participant list
  addParticipantToList('local', currentUser.name, true);
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - meetingStart) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('meeting-timer').textContent = `${m}:${s}`;
}

function leaveRoom() {
  if (socket) { socket.disconnect(); socket = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  Object.values(peers).forEach(pc => pc.close());
  peers = {}; peerNames = {};
  clearInterval(timerInterval);
  document.getElementById('video-grid').innerHTML = '';
  if (currentUser) showLobby();
}

// ─── SOCKET.IO ───────────────────────────────────────────────────────────
function connectSocket() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('join-room', {
      roomId: currentRoom.roomId,
      userId: currentUser._id,
      userName: currentUser.name
    });
  });

  // Existing peers when we join
  socket.on('room-peers', async ({ peers: peerIds, messages, whiteboardEvents }) => {
    // Replay chat
    messages.forEach(m => appendChatMessage(m, m.socketId === socket.id));
    // Replay whiteboard
    whiteboardEvents.forEach(e => replayWbEvent(e));
    // Connect to each existing peer
    for (const peerId of peerIds) {
      await createPeerConnection(peerId, true);
    }
  });

  // New peer joined
  socket.on('user-connected', async ({ socketId, userId, userName }) => {
    peerNames[socketId] = userName;
    showToast(`${userName} joined the room`, 'success');
    addParticipantToList(socketId, userName);
    await createPeerConnection(socketId, false);
  });

  // WebRTC signaling
  socket.on('webrtc-offer', async ({ fromId, offer, userName }) => {
    peerNames[fromId] = userName;
    const pc = peers[fromId] || await createPeerConnection(fromId, false);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { targetId: fromId, answer });
  });

  socket.on('webrtc-answer', async ({ fromId, answer }) => {
    const pc = peers[fromId];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('webrtc-ice-candidate', ({ fromId, candidate }) => {
    const pc = peers[fromId];
    if (pc && candidate) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  });

  // Chat
  socket.on('chat-message', msg => {
    appendChatMessage(msg, msg.socketId === socket.id);
  });

  // Whiteboard
  socket.on('whiteboard-draw', e => replayWbEvent(e));
  socket.on('whiteboard-clear', () => { wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height); });

  // Screen share
  socket.on('screen-share-started', ({ socketId, userName }) => showToast(`${userName} started screen sharing`));
  socket.on('screen-share-stopped', () => showToast('Screen sharing ended'));

  // File shared
  socket.on('file-shared', fileInfo => {
    appendFileToList(fileInfo);
    showToast(`📁 ${fileInfo.sharedBy} shared: ${fileInfo.originalName}`);
  });

  // Media toggle
  socket.on('media-toggle', ({ socketId, type, enabled }) => {
    updateParticipantStatus(socketId, type, enabled);
  });

  // Disconnect
  socket.on('user-disconnected', ({ socketId, userName }) => {
    if (peers[socketId]) { peers[socketId].close(); delete peers[socketId]; }
    delete peerNames[socketId];
    const tile = document.getElementById('tile-' + socketId);
    if (tile) tile.remove();
    removeParticipant(socketId);
    showToast(`${userName || 'Someone'} left the room`);
    updateParticipantCount();
  });
}

// ─── WebRTC PEER CONNECTION ───────────────────────────────────────────────
async function createPeerConnection(remoteSocketId, isInitiator) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers[remoteSocketId] = pc;

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit('webrtc-ice-candidate', { targetId: remoteSocketId, candidate });
    }
  };

  // Remote stream
  pc.ontrack = ({ streams }) => {
    const [remoteStream] = streams;
    addRemoteVideo(remoteSocketId, peerNames[remoteSocketId] || 'Peer', remoteStream);
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected'].includes(pc.connectionState)) {
      const tile = document.getElementById('tile-' + remoteSocketId);
      if (tile) tile.style.opacity = '0.5';
    }
  };

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', {
      targetId: remoteSocketId,
      offer,
      userName: currentUser.name
    });
  }

  return pc;
}

function addRemoteVideo(socketId, name, stream) {
  let tile = document.getElementById('tile-' + socketId);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = 'tile-' + socketId;
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="video-label">${name}</div>
      <div class="video-status" id="status-${socketId}"></div>`;
    document.getElementById('video-grid').appendChild(tile);
  }
  tile.querySelector('video').srcObject = stream;
  addParticipantToList(socketId, name);
  updateParticipantCount();
}

// ─── MEDIA CONTROLS ──────────────────────────────────────────────────────
function toggleMic() {
  if (!localStream) return;
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  const btn = document.getElementById('btn-mic');
  btn.textContent = micOn ? '🎙 Mic' : '🔇 Mic Off';
  btn.classList.toggle('off', !micOn);
  if (socket && currentRoom) socket.emit('media-toggle', { roomId: currentRoom.roomId, type: 'mic', enabled: micOn });
}

function toggleCam() {
  if (!localStream) return;
  camOn = !camOn;
  localStream.getVideoTracks().forEach(t => t.enabled = camOn);
  const btn = document.getElementById('btn-cam');
  btn.textContent = camOn ? '📷 Cam' : '📷 Cam Off';
  btn.classList.toggle('off', !camOn);
  const localVideo = document.getElementById('local-video');
  localVideo.style.display = camOn ? 'block' : 'none';
  if (socket && currentRoom) socket.emit('media-toggle', { roomId: currentRoom.roomId, type: 'cam', enabled: camOn });
}

async function toggleScreenShare() {
  const btn = document.getElementById('btn-screen');
  if (!screenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      // Replace video track in all peer connections
      Object.values(peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });
      document.getElementById('local-video').srcObject = screenStream;
      screenTrack.onended = () => stopScreenShare();
      screenSharing = true;
      btn.textContent = '🖥 Stop Share';
      btn.classList.add('active');
      if (socket) socket.emit('screen-share-started', { roomId: currentRoom.roomId });
    } catch { showToast('Screen share cancelled or denied', 'error'); }
  } else {
    stopScreenShare();
  }
}

function stopScreenShare() {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  if (localStream) {
    const camTrack = localStream.getVideoTracks()[0];
    if (camTrack) {
      Object.values(peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(camTrack);
      });
      document.getElementById('local-video').srcObject = localStream;
    }
  }
  screenSharing = false;
  const btn = document.getElementById('btn-screen');
  btn.textContent = '🖥 Share';
  btn.classList.remove('active');
  if (socket) socket.emit('screen-share-stopped', { roomId: currentRoom.roomId });
}

// ─── PANEL / TABS ─────────────────────────────────────────────────────────
function togglePanel(name) {
  const panel = document.getElementById('side-panel');
  if (activePanelId === name && panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'flex';
  showPanel(name);
}

function showPanel(name) {
  activePanelId = name;
  document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
}

function switchMediaTab(name) {
  document.querySelectorAll('.mtab').forEach(b => b.classList.remove('active'));
  document.getElementById('mtab-' + name).classList.add('active');
  document.getElementById('media-videos').style.display = name === 'videos' ? 'flex' : 'none';
  document.getElementById('media-whiteboard').style.display = name === 'whiteboard' ? 'flex' : 'none';
  if (name === 'whiteboard') resizeWhiteboard();
}

// ─── PARTICIPANTS ─────────────────────────────────────────────────────────
function addParticipantToList(id, name, isSelf = false) {
  const list = document.getElementById('participant-list');
  if (document.getElementById('p-' + id)) return;
  const div = document.createElement('div');
  div.className = 'participant-item';
  div.id = 'p-' + id;
  div.innerHTML = `
    <div class="p-avatar">${(name || '?')[0].toUpperCase()}</div>
    <div class="p-info"><strong>${name}${isSelf ? ' (You)' : ''}</strong><span id="pstatus-${id}">🎙 📷</span></div>`;
  list.appendChild(div);
  updateParticipantCount();
}

function removeParticipant(id) {
  document.getElementById('p-' + id)?.remove();
  updateParticipantCount();
}

function updateParticipantCount() {
  const count = document.querySelectorAll('.participant-item').length;
  document.getElementById('participant-count').textContent = count;
}

function updateParticipantStatus(socketId, type, enabled) {
  const el = document.getElementById('pstatus-' + socketId);
  if (!el) return;
  const current = el.textContent;
  if (type === 'mic') el.textContent = (enabled ? '🎙' : '🔇') + ' ' + (current.includes('📷') ? '📷' : '🚫');
  else el.textContent = (current.includes('🎙') ? '🎙' : '🔇') + ' ' + (enabled ? '📷' : '🚫');
}

// ─── CHAT ─────────────────────────────────────────────────────────────────
function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg || !socket) return;
  socket.emit('chat-message', { roomId: currentRoom.roomId, message: msg });
  input.value = '';
}

function appendChatMessage({ userName, message, timestamp }, isOwn) {
  const container = document.getElementById('chat-messages');
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isOwn ? ' own' : '');
  div.innerHTML = `
    <div class="chat-msg-header">${isOwn ? '' : userName + ' · '}${time}</div>
    <div class="chat-bubble">${escapeHtml(message)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── FILE SHARING ─────────────────────────────────────────────────────────
async function uploadFile() {
  const input = document.getElementById('file-input');
  const file = input.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  showToast('Uploading ' + file.name + '...');
  try {
    const res = await fetch(`${API}/files/upload`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      appendFileToList(data.file);
      socket.emit('file-shared', { roomId: currentRoom.roomId, fileInfo: data.file });
      showToast('File shared!', 'success');
    } else showToast(data.message, 'error');
  } catch { showToast('Upload failed', 'error'); }
  input.value = '';
}

function appendFileToList(f) {
  const list = document.getElementById('files-list');
  const div = document.createElement('div');
  div.className = 'file-item';
  div.innerHTML = `
    <div class="file-icon">${fileEmoji(f.originalName || f.filename)}</div>
    <div class="file-info">
      <strong>${f.originalName || f.filename}</strong>
      <span>${f.sharedBy || f.uploadedBy || ''} · ${formatSize(f.size)}</span>
    </div>
    <a class="file-dl" href="${f.url}" download target="_blank">⬇</a>`;
  list.appendChild(div);
}

// ─── WHITEBOARD ───────────────────────────────────────────────────────────
let wbCanvas, wbCtx;
let wbTool = 'pen', wbColor = '#ffffff', wbSize = 3;
let wbDrawing = false, wbStart = { x: 0, y: 0 };
let wbSnapshot = null;

function initWhiteboard() {
  wbCanvas = document.getElementById('whiteboard-canvas');
  wbCtx = wbCanvas.getContext('2d');
  resizeWhiteboard();
  window.addEventListener('resize', resizeWhiteboard);

  wbCanvas.addEventListener('mousedown', wbPointerDown);
  wbCanvas.addEventListener('mousemove', wbPointerMove);
  wbCanvas.addEventListener('mouseup', wbPointerUp);
  wbCanvas.addEventListener('mouseleave', wbPointerUp);
  // Touch support
  wbCanvas.addEventListener('touchstart', e => { e.preventDefault(); wbPointerDown(e.touches[0]); }, { passive: false });
  wbCanvas.addEventListener('touchmove', e => { e.preventDefault(); wbPointerMove(e.touches[0]); }, { passive: false });
  wbCanvas.addEventListener('touchend', wbPointerUp);

  wbCtx.fillStyle = '#1a1a2e';
  wbCtx.fillRect(0, 0, wbCanvas.width, wbCanvas.height);
}

function resizeWhiteboard() {
  if (!wbCanvas) return;
  const saved = wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height);
  wbCanvas.width = wbCanvas.offsetWidth;
  wbCanvas.height = wbCanvas.offsetHeight;
  wbCtx.fillStyle = '#1a1a2e';
  wbCtx.fillRect(0, 0, wbCanvas.width, wbCanvas.height);
  wbCtx.putImageData(saved, 0, 0);
}

function getWbPos(e) {
  const rect = wbCanvas.getBoundingClientRect();
  return { x: (e.clientX || e.pageX) - rect.left, y: (e.clientY || e.pageY) - rect.top };
}

function wbPointerDown(e) {
  wbDrawing = true;
  const pos = getWbPos(e);
  wbStart = pos;
  wbSnapshot = wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height);
  if (wbTool === 'pen' || wbTool === 'eraser') {
    wbCtx.beginPath();
    wbCtx.moveTo(pos.x, pos.y);
  }
  if (wbTool === 'text') {
    const text = prompt('Enter text:');
    if (text) {
      wbCtx.font = `${wbSize * 5 + 12}px Space Grotesk, sans-serif`;
      wbCtx.fillStyle = wbColor;
      wbCtx.fillText(text, pos.x, pos.y);
      emitWbEvent({ tool: 'text', x: pos.x, y: pos.y, text, color: wbColor, size: wbSize });
    }
    wbDrawing = false;
  }
}

function wbPointerMove(e) {
  if (!wbDrawing) return;
  const pos = getWbPos(e);
  wbCtx.putImageData(wbSnapshot, 0, 0);
  wbCtx.strokeStyle = wbTool === 'eraser' ? '#1a1a2e' : wbColor;
  wbCtx.lineWidth = wbTool === 'eraser' ? wbSize * 5 : wbSize;
  wbCtx.lineCap = 'round';
  wbCtx.lineJoin = 'round';

  if (wbTool === 'pen' || wbTool === 'eraser') {
    wbCtx.lineTo(pos.x, pos.y);
    wbCtx.stroke();
  } else if (wbTool === 'line') {
    wbCtx.beginPath();
    wbCtx.moveTo(wbStart.x, wbStart.y);
    wbCtx.lineTo(pos.x, pos.y);
    wbCtx.stroke();
  } else if (wbTool === 'rect') {
    wbCtx.strokeRect(wbStart.x, wbStart.y, pos.x - wbStart.x, pos.y - wbStart.y);
  } else if (wbTool === 'circle') {
    const r = Math.hypot(pos.x - wbStart.x, pos.y - wbStart.y);
    wbCtx.beginPath();
    wbCtx.arc(wbStart.x, wbStart.y, r, 0, Math.PI * 2);
    wbCtx.stroke();
  }
}

function wbPointerUp(e) {
  if (!wbDrawing) return;
  wbDrawing = false;
  const pos = e.touches ? { x: wbStart.x, y: wbStart.y } : getWbPos(e);
  const event = { tool: wbTool, x: wbStart.x, y: wbStart.y, ex: pos.x, ey: pos.y, color: wbColor, size: wbSize };
  emitWbEvent(event);
}

function emitWbEvent(event) {
  if (socket && currentRoom) socket.emit('whiteboard-draw', { roomId: currentRoom.roomId, event });
}

function replayWbEvent(e) {
  wbCtx.strokeStyle = e.tool === 'eraser' ? '#1a1a2e' : e.color;
  wbCtx.fillStyle = e.color;
  wbCtx.lineWidth = e.tool === 'eraser' ? e.size * 5 : e.size;
  wbCtx.lineCap = 'round';
  wbCtx.lineJoin = 'round';
  if (e.tool === 'pen' || e.tool === 'eraser') {
    wbCtx.beginPath(); wbCtx.moveTo(e.x, e.y); wbCtx.lineTo(e.ex, e.ey); wbCtx.stroke();
  } else if (e.tool === 'line') {
    wbCtx.beginPath(); wbCtx.moveTo(e.x, e.y); wbCtx.lineTo(e.ex, e.ey); wbCtx.stroke();
  } else if (e.tool === 'rect') {
    wbCtx.strokeRect(e.x, e.y, e.ex - e.x, e.ey - e.y);
  } else if (e.tool === 'circle') {
    const r = Math.hypot(e.ex - e.x, e.ey - e.y);
    wbCtx.beginPath(); wbCtx.arc(e.x, e.y, r, 0, Math.PI * 2); wbCtx.stroke();
  } else if (e.tool === 'text') {
    wbCtx.font = `${e.size * 5 + 12}px Space Grotesk, sans-serif`;
    wbCtx.fillText(e.text, e.x, e.y);
  }
}

function setWbTool(tool) {
  wbTool = tool;
  document.querySelectorAll('.wb-btn[id^="tool-"]').forEach(b => b.classList.remove('active'));
  document.getElementById('tool-' + tool)?.classList.add('active');
}

function clearWhiteboard() {
  if (!confirm('Clear whiteboard for everyone?')) return;
  wbCtx.fillStyle = '#1a1a2e';
  wbCtx.fillRect(0, 0, wbCanvas.width, wbCanvas.height);
  if (socket) socket.emit('whiteboard-clear', { roomId: currentRoom.roomId });
}

// ─── BOOT ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const token = getToken();
  const user = getUser();
  if (token && user) { currentUser = user; showLobby(); }
  else { document.getElementById('auth-screen').style.display = 'flex'; }
});
