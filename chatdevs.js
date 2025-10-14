/*
Simple terminal/CLI-style group chat (single-file Node.js + embedded client)

Features:
- Create room with a generated code and options (maxUsers, timeLimit minutes)
- Leader creates room, can start the chat; chat ends when time limit hits
- Friends join by entering room code and a unique username
- Simple terminal/CLI visual style in the browser
- User-Specific Colors: Each user gets a unique, persistent chat color.
- "Copy Code" Button: Easily copy the room code to the clipboard.
*/

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// In-memory storage for rooms. For a real application, use a database.
const rooms = new Map();
/*
Room structure:
code: {
  code: String,
  leaderSocketId: String,
  leaderName: String,
  maxUsers: Number,
  timeLimitMin: Number,
  users: { socketId: { username: String, color: String } }, // Maps socket IDs to user objects
  started: Boolean,
  timer: TimeoutID | null,
  endTimestamp: Number | null,
}
*/

/** Generates a random, easy-to-read 6-character room code. */
function makeCode(len = 6) {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars
    let s = '';
    for (let i = 0; i < len; i++) {
        s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
}

/** A predefined list of high-contrast colors for user distinction. */
const HIGH_CONTRAST_COLORS = [
    'hsl(200, 100%, 65%)', // Vivid Sky Blue
    'hsl(15, 100%, 60%)',  // Deep Orange
    'hsl(280, 90%, 70%)',  // Vibrant Purple
    'hsl(50, 100%, 65%)',  // Bright Yellow
    'hsl(340, 90%, 65%)',  // Hot Pink
    'hsl(0, 100%, 65%)',   // Bright Red
    'hsl(210, 100%, 75%)', // Electric Blue
    'hsl(35, 100%, 70%)'   // Amber
];


/**
 * Assigns a unique, high-contrast color to a new user from a predefined palette.
 * @param {object} currentUsers - The users object from the room state.
 * @returns {string} An HSL color string.
 */
function assignColor(currentUsers) {
    const usedColors = new Set(Object.values(currentUsers).map(u => u.color));

    // Find the first palette color that is not currently in use.
    for (const color of HIGH_CONTRAST_COLORS) {
        if (!usedColors.has(color)) {
            return color;
        }
    }

    // If all palette colors are used, cycle through them based on the number of users.
    const userCount = Object.keys(currentUsers).length;
    return HIGH_CONTRAST_COLORS[userCount % HIGH_CONTRAST_COLORS.length];
}


// Serve the client-side HTML file from the constant below
app.get('/', (req, res) => {
    res.type('html').send(indexHtml);
});

// Main connection logic for Socket.IO
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // --- Room Creation ---
    socket.on('createRoom', ({ username, maxUsers, timeLimitMin }, cb) => {
        username = String(username || '').trim();
        if (!username) return cb({ ok: false, error: 'Username is required.' });

        // Sanitize and validate options
        maxUsers = Math.max(2, parseInt(maxUsers) || 4);
        timeLimitMin = Math.max(1, parseInt(timeLimitMin) || 5);

        // Generate a unique room code
        let code;
        do {
            code = makeCode();
        } while (rooms.has(code));

        const room = {
            code,
            leaderSocketId: socket.id,
            leaderName: username,
            maxUsers,
            timeLimitMin,
            users: {},
            started: false,
            timer: null,
            endTimestamp: null,
        };

        // Add the leader as the first user with a high-contrast color
        const color = assignColor(room.users);
        room.users[socket.id] = { username, color };
        rooms.set(code, room);
        socket.join(code);

        cb({ ok: true, code }); // Acknowledge creation with the new code
        broadcastRoomState(code); // Broadcast the initial state
    });

    // --- Room Joining ---
    socket.on('joinRoom', ({ username, code }, cb) => {
        username = String(username || '').trim();
        code = String(code || '').trim().toUpperCase();

        if (!username) return cb({ ok: false, error: 'Username is required.' });
        if (!rooms.has(code)) return cb({ ok: false, error: 'Room not found.' });

        const room = rooms.get(code);
        if (room.started) return cb({ ok: false, error: 'Chat has already started.' });
        if (Object.keys(room.users).length >= room.maxUsers) return cb({ ok: false, error: 'Room is full.' });
        if (Object.values(room.users).some(u => u.username === username)) return cb({ ok: false, error: 'Username is already taken.' });

        const color = assignColor(room.users);
        room.users[socket.id] = { username, color };
        socket.join(code);

        io.to(code).emit('systemMessage', `${username} joined the room.`);
        broadcastRoomState(code);
        cb({ ok: true });
    });

    // --- Room Starting ---
    socket.on('startRoom', ({ code }, cb) => {
        if (!rooms.has(code)) return cb?.({ ok: false, error: 'Room not found.' });
        const room = rooms.get(code);

        if (socket.id !== room.leaderSocketId) return cb?.({ ok: false, error: 'Only the leader can start the chat.' });
        if (room.started) return cb?.({ ok: false, error: 'Chat already started.' });

        room.started = true;
        room.endTimestamp = Date.now() + room.timeLimitMin * 60 * 1000;

        // Start the countdown timer on the server
        const tick = () => {
            const remainingMs = room.endTimestamp - Date.now();
            if (remainingMs <= 0) {
                io.to(code).emit('timeUp');
                endRoom(code);
            } else {
                io.to(code).emit('timeUpdate', Math.ceil(remainingMs / 1000));
                if (rooms.has(code)) {
                    rooms.get(code).timer = setTimeout(tick, 1000);
                }
            }
        };
        tick();

        io.to(code).emit('systemMessage', `Chat started by leader ${room.leaderName}. Time limit: ${room.timeLimitMin} minute(s).`);
        broadcastRoomState(code);
        cb?.({ ok: true });
    });

    // --- Message Handling ---
    socket.on('sendMessage', ({ code, message }, cb) => {
        if (!rooms.has(code)) return cb?.({ ok: false, error: 'Room not found.' });
        const room = rooms.get(code);
        const user = room.users[socket.id];

        if (!user) return cb?.({ ok: false, error: 'You are not in this room.' });
        if (!room.started) return cb?.({ ok: false, error: 'Chat has not started yet.' });

        message = String(message || '').trim();
        if (message === '') return cb?.({ ok: false, error: 'Message cannot be empty.' });

        io.to(code).emit('message', { username: user.username, color: user.color, message, ts: Date.now() });
        cb?.({ ok: true });
    });

    // --- Leaving and Disconnecting ---
    socket.on('leaveRoom', ({ code }) => {
        handleUserLeaving(socket, code);
    });

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        // Find which room the socket was in and handle their departure
        for (const [code, room] of rooms.entries()) {
            if (room.users[socket.id]) {
                handleUserLeaving(socket, code);
                break; // A user can only be in one room at a time
            }
        }
    });
});

/** Centralized logic for when a user leaves or disconnects. */
function handleUserLeaving(socket, code) {
    if (!rooms.has(code)) return;
    const room = rooms.get(code);
    const user = room.users[socket.id];

    if (!user) return;

    const username = user.username;
    delete room.users[socket.id];
    socket.leave(code);

    io.to(code).emit('systemMessage', `${username} left the room.`);

    // If the room is now empty, close it
    if (Object.keys(room.users).length === 0) {
        endRoom(code);
        return;
    }

    // If the leader left, assign a new one
    if (socket.id === room.leaderSocketId) {
        const newLeaderSocketId = Object.keys(room.users)[0];
        room.leaderSocketId = newLeaderSocketId;
        room.leaderName = room.users[newLeaderSocketId].username;
        io.to(code).emit('systemMessage', `${room.leaderName} is the new leader.`);
    }

    broadcastRoomState(code);
}

/** Broadcasts the current state of a room to all its members. */
function broadcastRoomState(code) {
    const room = rooms.get(code);
    if (!room) return;

    io.to(code).emit('roomState', {
        code: room.code,
        leaderName: room.leaderName,
        maxUsers: room.maxUsers,
        timeLimitMin: room.timeLimitMin,
        users: Object.values(room.users).map(u => ({ username: u.username, color: u.color })),
        started: room.started,
        endTimestamp: room.endTimestamp,
    });
}

/** Cleans up a room after the chat ends. */
function endRoom(code) {
    const room = rooms.get(code);
    if (!room) return;

    if (room.timer) clearTimeout(room.timer);

    io.to(code).emit('systemMessage', 'Chat ended. The room is now closed.');
    io.to(code).emit('roomClosed');

    io.sockets.in(code).socketsLeave(code);
    rooms.delete(code);
    console.log(`Room ${code} closed and deleted.`);
}

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

// ----------------- CLIENT-SIDE HTML, CSS, AND JAVASCRIPT -----------------
const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cardamom Group Chat 🌿</title>
  <link 
    rel="stylesheet" 
    href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css"
  >
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      height: 100%;
      background: #000;
      color: #0f0;
      font-family: "Courier New", "Courier", monospace;
      font-size: 14px;
      line-height: 1.5;
    }

    body {
      padding: 20px;
    }

    .container {
      max-width: 1200px;
      height: 100%;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .header {
      border: 1px solid #0f0;
      padding: 12px 16px;
    }

    .header-title {
      font-weight: bold;
    }

    .header-subtitle {
      color: #0a0;
      margin-top: 4px;
    }

    .main {
      flex: 1;
      display: flex;
      gap: 20px;
      min-height: 0;
    }

    .sidebar {
      width: 360px;
      border: 1px solid #0f0;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .chat-area {
      flex: 1;
      border: 1px solid #0f0;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .section-title {
      color: #0f0;
      font-weight: bold;
      margin-bottom: 4px;
    }

    input, select {
      background: #000;
      border: 1px solid #0a0;
      color: #0f0;
      padding: 8px 12px;
      font-family: inherit;
      font-size: inherit;
      outline: none;
    }

    input:focus, select:focus {
      border-color: #0f0;
    }

    input::placeholder {
      color: #050;
    }

    input:disabled {
      border-color: #030;
      color: #050;
    }

    button {
      background: #000;
      border: 1px solid #0f0;
      color: #0f0;
      padding: 8px 16px;
      font-family: inherit;
      font-size: inherit;
      cursor: pointer;
      transition: all 0.1s;
    }

    button:hover:not(:disabled) {
      background: #0f0;
      color: #000;
    }

    button:disabled {
      border-color: #030;
      color: #050;
      cursor: not-allowed;
    }

    button:active:not(:disabled) {
      transform: translateY(1px);
    }

    .button-group {
      display: flex;
      gap: 8px;
    }

    .divider {
      border: 0;
      border-top: 1px solid #0a0;
      margin: 8px 0;
    }

    .info-box {
      border: 1px solid #0a0;
      padding: 8px 12px;
      color: #0a0;
      min-height: 40px;
      word-wrap: break-word;
    }

    .room-code {
      color: #0f0;
      font-weight: bold;
    }

    .users-list {
      border: 1px solid #0a0;
      padding: 8px 12px;
      min-height: 60px;
      color: #0a0;
      white-space: pre-wrap;
    }

    .chat-log {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      font-size: 13px;
      background: #000;
      border-bottom: 1px solid #0a0;
    }

    .chat-log::-webkit-scrollbar {
      width: 8px;
    }

    .chat-log::-webkit-scrollbar-track {
      background: #000;
    }

    .chat-log::-webkit-scrollbar-thumb {
      background: #0a0;
      border: 1px solid #000;
    }

    .chat-input-area {
      display: flex;
      gap: 0;
      border-top: 1px solid #0f0;
    }

    .chat-input-area input {
      flex: 1;
      border: none;
      border-right: 1px solid #0f0;
      border-radius: 0;
    }

    .chat-input-area button {
      border: none;
      border-radius: 0;
      min-width: 100px;
    }

    .log-entry {
      margin-bottom: 8px;
      word-wrap: break-word;
    }

    .log-system {
      color: #0a0;
    }

    .log-message .username {
      font-weight: bold;
    }

    .log-time {
      color: #0a0;
      margin-right: 8px;
    }

    .hidden {
      display: none;
    }

    @media (max-width: 900px) {
      .main {
        flex-direction: column;
      }
      .sidebar {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-title">&gt; CLI GROUP CHAT SYSTEM v1.0</div>
      <div class="header-subtitle">&gt; Create room. Share code. Chat with friends.</div>
    </div>

    <div class="main">
      <div class="sidebar">
        <div class="section">
          <div class="section-title">&gt; USER SETUP</div>
          <input id="username" placeholder="username" />
        </div>

        <div class="section">
          <div class="section-title">&gt; ROOM CONFIG</div>
          <input id="maxUsers" type="number" min="2" value="4" placeholder="max users" />
          <input id="timeLimit" type="number" min="1" value="5" placeholder="time limit (min)" />
        </div>

        <div class="button-group">
          <button id="btnCreate">CREATE</button>
          <button id="btnJoin">JOIN</button>
        </div>

        <div class="section">
          <input id="joinCode" placeholder="room code" />
        </div>

        <hr class="divider">

        <div class="section">
          <div class="section-title">&gt; ROOM STATUS</div>
          <div class="info-box" id="roomInfo">Not connected</div>
          <button id="btnCopyCode" class="hidden" style="width: 100%; margin-top: 8px;">COPY CODE</button>
        </div>

        <div class="section">
          <div class="section-title">&gt; USERS</div>
          <div class="users-list" id="usersList">No users</div>
        </div>

        <div style="margin-top: auto;">
          <button id="btnStart" class="hidden">START CHAT</button>
          <button id="btnLeave" class="hidden">LEAVE ROOM</button>
        </div>
      </div>

      <div class="chat-area">
        <div class="chat-log" id="log">&gt; CLI Group Chat initialized.
&gt; Waiting for connection...
&gt; Use sidebar to create or join a room.
&gt; Room leader will start the chat session.</div>

        <div class="chat-input-area">
          <input 
            id="message" 
            placeholder="type message..." 
            disabled 
          />
          <button id="btnSend" disabled>SEND</button>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
  <script>
    const socket = io();
    let currentRoom = null;
    let myName = null;
    const $ = id => document.getElementById(id);

    // --- Logging ---
    function log(msg, type = 'system') {
      const el = $('log');
      const entry = document.createElement('div');
      entry.className = \`log-entry log-\${type}\`;
      entry.textContent = msg;
      el.appendChild(entry);
      el.scrollTop = el.scrollHeight;
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // --- Room Entry ---
    function handleRoomEntry(code, isLeader = false) {
      currentRoom = code;
      $('joinCode').value = code;
      $('btnLeave').classList.remove('hidden');
      $('btnCopyCode').classList.remove('hidden');
      
      ['username', 'maxUsers', 'timeLimit', 'joinCode', 'btnCreate', 'btnJoin']
        .forEach(id => $(id).disabled = true);

      if (isLeader) {
        $('roomInfo').innerHTML = \`Room <span class="room-code">\${code}</span> - YOU ARE LEADER\`;
        $('btnStart').classList.remove('hidden');
      } else {
        $('roomInfo').innerHTML = \`Room <span class="room-code">\${code}</span> - CONNECTED\`;
      }
    }

    // --- Button Actions ---
    $('btnCreate').addEventListener('click', () => {
      const username = $('username').value.trim();
      if (!username) return alert('Error: Username required');

      const maxUsers = parseInt($('maxUsers').value) || 4;
      const timeLimit = parseInt($('timeLimit').value) || 5;

      socket.emit('createRoom', { username, maxUsers, timeLimitMin: timeLimit }, (res) => {
        if (!res.ok) return alert('Error: ' + (res.error || 'Failed to create room'));
        
        myName = username;
        handleRoomEntry(res.code, true);
        log(\`> Room created: \${res.code}\`);
        log('> Waiting for users to join...');
      });
    });

    $('btnJoin').addEventListener('click', () => {
      const username = $('username').value.trim();
      const code = $('joinCode').value.trim().toUpperCase();
      if (!username) return alert('Error: Username required');
      if (!code) return alert('Error: Room code required');
      
      socket.emit('joinRoom', { username, code }, (res) => {
        if (!res.ok) return alert('Error: ' + (res.error || 'Failed to join room'));

        myName = username;
        handleRoomEntry(code, false);
        log(\`> Joined room: \${code}\`);
      });
    });

    $('btnStart').addEventListener('click', () => {
      if (!currentRoom) return;
      socket.emit('startRoom', { code: currentRoom }, (res) => {
        if (res && !res.ok) alert('Error: ' + (res.error || 'Failed to start'));
      });
    });

    $('btnLeave').addEventListener('click', () => {
      if (!currentRoom) return;
      socket.emit('leaveRoom', { code: currentRoom });
      resetToLobby('You left the room');
    });

    $('btnCopyCode').addEventListener('click', () => {
        if (!currentRoom) return;
        navigator.clipboard.writeText(currentRoom).then(() => {
            const btn = $('btnCopyCode');
            const originalText = btn.textContent;
            btn.textContent = 'COPIED!';
            btn.disabled = true;
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy code: ', err);
            log('> ERROR: Could not copy code to clipboard.');
        });
    });

    function sendMessage() {
      const text = $('message').value;
      if (!text.trim() || !currentRoom) return;
      
      socket.emit('sendMessage', { code: currentRoom, message: text }, (res) => {
        if (res && !res.ok) {
          log(\`> ERROR: \${res.error || 'Failed to send'}\`, 'system');
        } else {
          $('message').value = '';
          $('message').focus();
        }
      });
    }

    $('btnSend').addEventListener('click', sendMessage);
    $('message').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // --- Socket Events ---
    socket.on('roomState', (state) => {
      if (!currentRoom || currentRoom !== state.code) return;

      $('usersList').innerHTML = 
        \`\${state.users.length}/\${state.maxUsers} connected\\n\` + 
        state.users.map(u => \`<span style="color: \${u.color};">- \${escapeHtml(u.username)}\</span>\`).join('\\n');
      
      const amILeader = state.leaderName === myName;

      if (state.started) {
        $('message').disabled = false;
        $('btnSend').disabled = false;
        $('btnStart').classList.add('hidden');
      } else {
        $('message').disabled = true;
        $('btnSend').disabled = true;
        $('btnStart').classList.toggle('hidden', !amILeader);
      }
    });

    socket.on('systemMessage', (text) => log(\`> SYSTEM: \${text}\`, 'system'));

    socket.on('message', ({ username, color, message, ts }) => {
        const el = $('log');
        const entry = document.createElement('div');
        entry.className = 'log-entry log-message';

        const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        entry.innerHTML = 
            \`<span class="log-time">[\${time}]</span> \` +
            \`<span class="username" style="color: \${color};">\${escapeHtml(username)}:</span> \` +
            \`<span>\${escapeHtml(message)}</span>\`;
        
        el.appendChild(entry);
        el.scrollTop = el.scrollHeight;
    });

    socket.on('timeUpdate', (remainingSeconds) => {
      const m = Math.floor(remainingSeconds / 60);
      const s = remainingSeconds % 60;
      $('roomInfo').innerHTML = 
        \`Room <span class="room-code">\${currentRoom}</span> - Time: \${m}:\${String(s).padStart(2, '0')}\`;
    });

    socket.on('timeUp', () => {
      log('> SYSTEM: Time expired. Chat ended.', 'system');
      $('message').disabled = true;
      $('btnSend').disabled = true;
    });

    socket.on('roomClosed', () => resetToLobby('Room closed by server'));
    socket.on('disconnect', () => resetToLobby('Disconnected from server'));

    // --- Reset Lobby ---
    function resetToLobby(info) {
      if (info) log(\`> INFO: \${info}\`, 'system');
      currentRoom = null;
      myName = null;
      
      ['username', 'maxUsers', 'timeLimit', 'joinCode', 'btnCreate', 'btnJoin']
        .forEach(id => $(id).disabled = false);

      $('message').disabled = true;
      $('btnSend').disabled = true;
      $('btnStart').classList.add('hidden');
      $('btnLeave').classList.add('hidden');
      $('btnCopyCode').classList.add('hidden');
      $('roomInfo').textContent = 'Not connected';
      $('usersList').textContent = 'No users';
    }
  </script>
</body>
</html>
`;

