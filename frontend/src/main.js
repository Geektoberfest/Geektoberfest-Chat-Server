import { io } from 'socket.io-client';
import './style.css';

const serverUrl = import.meta.env.VITE_CHAT_SERVER_URL
  || (import.meta.env.PROD ? 'https://chat-server-2-fzyd.onrender.com' : 'http://localhost:5000');
const sessionKey = 'gather-session';
let session = readSession();
function readSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey));
  } catch {
    return null;
  }
}
const socket = io(serverUrl, {
  autoConnect: false,
  transports: ['websocket'],
  auth: (callback) => callback({ token: session?.token }),
});

const messageList = document.querySelector('#message-list');
const messageForm = document.querySelector('#message-form');
const messageInput = document.querySelector('#message-input');
const roomInput = document.querySelector('#room-input');
const roomTitle = document.querySelector('#room-title');
const connectionLabel = document.querySelector('#connection-label');
const roleLabel = document.querySelector('#role-label');
const reportsPanel = document.querySelector('#reports-panel');
const reportsCount = document.querySelector('#reports-count');
const reportsList = document.querySelector('#reports-list');
const notice = document.querySelector('#notice');
const chatView = document.querySelector('#chat-view');
const identity = document.querySelector('#identity');
const authView = document.querySelector('#auth-view');
const authForm = document.querySelector('#auth-form');
const authUsername = document.querySelector('#auth-username');
const authPassword = document.querySelector('#auth-password');
const authSubmit = document.querySelector('#auth-submit');
const authSwitch = document.querySelector('#auth-switch');
const authNotice = document.querySelector('#auth-notice');
const loadOlderBtn = document.querySelector('#load-older');

const presenceLabel = document.createElement('span');
presenceLabel.className = 'presence-label';
presenceLabel.textContent = 'Online: waiting for users';
roleLabel.parentElement.append(presenceLabel);


let currentRoom = roomInput.value.trim() || 'general';
let authMode = 'login';
let isConnected = false;
let isRemoved = false;
let myUserId = '';
let roomState = { ownerId: '', moderators: [], mutedIds: [] };

// Pagination state for "Load older messages".
let hasMoreHistory = false;
let loadingOlderMessages = false;
let paginationGeneration = 0;

function updateLoadOlderButton() {
  if (!loadOlderBtn) return;
  loadOlderBtn.hidden = !hasMoreHistory;
  loadOlderBtn.disabled = loadingOlderMessages;
}

function resetPagination() {
  paginationGeneration += 1;
  hasMoreHistory = false;
  loadingOlderMessages = false;
  updateLoadOlderButton();
}

function roleOf(userId) {
  if (!userId) return 'member';
  if (roomState.ownerId === userId) return 'owner';
  if (roomState.moderators.includes(userId)) return 'moderator';
  return 'member';
}

function isStaff() {
  return roleOf(myUserId) !== 'member';
}

function isMuted(userId) {
  return Boolean(userId) && roomState.mutedIds.includes(userId);
}

// Mirrors the server's rules: owners act on anyone, moderators only on members.
function canModerate(targetId) {
  if (!myUserId || targetId === myUserId) return false;
  const myRole = roleOf(myUserId);
  return myRole === 'owner' || (myRole === 'moderator' && roleOf(targetId) === 'member');
}

function updateComposer() {
  const muted = isMuted(myUserId);
  messageInput.disabled = !isConnected || isRemoved || muted;
  messageInput.placeholder = isRemoved
    ? 'You were removed from this room'
    : muted ? 'You are muted in this room' : 'Write a message...';
}

// Messages sent but not yet acknowledged, oldest first.
const outbox = [];
// Every clientId already on screen, so a re-delivered message is not drawn twice.
const seenClientIds = new Set();
// Message IDs are server-generated and remain stable across history pages.
const seenMessageIds = new Set();
// Our own unacknowledged bubbles, so an ack can un-dim the right one.
const pendingRows = new Map();
// Keeps repeated reconnect failures from stomping every other notice.
let reportedOffline = false;
// How long to wait for an acknowledgement before queueing the message again.
const ACK_TIMEOUT_MS = 10000;

function setConnectionState(connected) {
  isConnected = connected;
  connectionLabel.textContent = connected ? 'Connected' : 'Connecting';
  document.querySelector('.online-dot').classList.toggle('is-connected', connected);
  updateComposer();
}

setConnectionState(false);

function clearMessages() {
  messageList.replaceChildren();
  seenClientIds.clear();
  seenMessageIds.clear();
  pendingRows.clear();
  resetPagination();
}

function setPendingLabel(clientId, text) {
  const label = pendingRows.get(clientId)?.querySelector('.message-status');
  if (label) label.textContent = text;
}

function requeueOutbox() {
  for (const message of outbox) {
    message.inFlight = false;
    setPendingLabel(message.clientId, 'Queued — offline');
  }
}

function markDelivered(clientId) {
  const queued = outbox.findIndex((message) => message.clientId === clientId);
  if (queued !== -1) outbox.splice(queued, 1);

  const row = pendingRows.get(clientId);
  if (row) {
    row.classList.remove('is-pending');
    row.querySelector('.message-status')?.remove();
    pendingRows.delete(clientId);
  }
}

function discardQueued(clientId) {
  const queued = outbox.findIndex((message) => message.clientId === clientId);
  if (queued !== -1) outbox.splice(queued, 1);

  const row = pendingRows.get(clientId);
  if (row) {
    row.remove();
    pendingRows.delete(clientId);
  }
  seenClientIds.delete(clientId);
}

function flushOutbox() {
  if (!socket.connected) return;

  for (const message of outbox) {
    if (message.inFlight) continue;
    message.inFlight = true;

    const { clientId, room, text } = message;
    setPendingLabel(clientId, 'Sending…');
    socket.timeout(ACK_TIMEOUT_MS).emit('send_message', { clientId, room, text }, (timedOut, response) => {
      message.inFlight = false;

      if (timedOut) {
        // No answer came back. Stay queued; the server deduplicates on
        // clientId, so resending later cannot create a second copy.
        setPendingLabel(clientId, 'Queued — retrying');
        return;
      }

      if (response?.ok) {
        markDelivered(clientId);
        return;
      }

      // A rejected message will not succeed on retry, so hand the text back.
      discardQueued(clientId);
      if (!messageInput.value.trim()) messageInput.value = text;
      showNotice(response?.error || 'Could not send your message.');
    });
  }
}

function actionButton(action, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'message-action';
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

function refreshRow(row) {
  const authorId = row.dataset.senderId;
  const isMine = Boolean(authorId) && authorId === myUserId;
  row.classList.toggle('is-mine', isMine);

  const role = roleOf(authorId);
  const badges = [];
  if (role !== 'member') badges.push(role);
  if (isMuted(authorId)) badges.push('muted');
  row.querySelector('.message-badge').textContent = badges.join(' Â· ');

  const actions = row.querySelector('.message-actions');
  actions.replaceChildren();
  if (row.dataset.deleted === 'true' || !row.dataset.messageId) return;

  if (!isMine) actions.append(actionButton('report', 'Report'));
  if (canModerate(authorId)) {
    actions.append(actionButton('delete', 'Delete'));
    if (authorId) {
      actions.append(actionButton(isMuted(authorId) ? 'unmute' : 'mute', isMuted(authorId) ? 'Unmute' : 'Mute'));
      actions.append(actionButton('remove', 'Remove user'));
    }
  }
  if (roleOf(myUserId) === 'owner' && authorId && !isMine) {
    actions.append(actionButton(role === 'moderator' ? 'demote' : 'promote', role === 'moderator' ? 'Remove mod' : 'Make mod'));
  }
}

function refreshAllRows() {
  messageList.querySelectorAll('.message-row').forEach(refreshRow);
  const roleText = { owner: 'You are the owner', moderator: 'You are a moderator' }[roleOf(myUserId)] || '';
  roleLabel.textContent = roleText;
  updateComposer();
  reportsPanel.hidden = !isStaff();
}

function markDeleted(row) {
  row.dataset.deleted = 'true';
  const bubble = row.querySelector('.message-bubble');
  bubble.textContent = 'Message removed by a moderator';
  bubble.classList.add('is-removed');
  refreshRow(row);
}

function showPlaceholder(title, detail, loading = false) {
  const note = document.createElement('div');
  note.className = `welcome-note${loading ? ' is-loading' : ''}`;
  note.dataset.placeholder = 'true';

  const spark = document.createElement('span');
  spark.className = 'welcome-spark';
  spark.setAttribute('aria-hidden', 'true');
  spark.textContent = 'âœ³';

  const heading = document.createElement('div');
  heading.className = 'welcome-title';
  heading.textContent = title;

  const body = document.createElement('p');
  body.textContent = detail;

  note.append(spark, heading, body);
  messageList.replaceChildren(note);
}

function showLoadingState(room) {
  showPlaceholder('Loading messages', `Fetching the conversation in #${room}.`, true);
}

function showEmptyState(room) {
  showPlaceholder('No messages yet', `Say hello to start the conversation in #${room}.`);
}

function removePlaceholder() {
  const placeholder = messageList.querySelector('[data-placeholder]');
  if (placeholder) placeholder.remove();
}


function renderReactions(row, reactions = []) {
  const display = row.querySelector('.message-reactions');
  if (!display) return;

  display.replaceChildren();

  reactions.forEach((reaction) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reaction-button';
    button.textContent = `${reaction.emoji} ${reaction.userIds.length}`;
    button.title = 'Click to toggle your reaction';

    if (reaction.userIds.includes(myUserId)) {
      button.classList.add('is-selected');
    }

    button.addEventListener('click', () => {
      socket.emit('toggle_reaction', {
        room: currentRoom,
        messageId: row.dataset.messageId,
        emoji: reaction.emoji,
      });
    });

    display.append(button);
  });
}


function renderMessage(message, { pending = false } = {}) {
  const clientId = typeof message.clientId === 'string' ? message.clientId : '';
  const messageId = typeof message.id === 'string' ? message.id : '';
  if (messageId && seenMessageIds.has(messageId)) return;
  if (clientId && seenClientIds.has(clientId)) {
    // Already drawn. The echo is itself proof the server stored it, and it
    // carries the message ID the moderation actions need.
    const row = pendingRows.get(clientId);
    if (row && message.id) {
      row.dataset.messageId = message.id;
      seenMessageIds.add(message.id);
      refreshRow(row);
    }
    markDelivered(clientId);
    return;
  }
  if (clientId) seenClientIds.add(clientId);
  if (messageId) seenMessageIds.add(messageId);

  removePlaceholder();
  const sender = String(message.sender || 'Someone');
  const text = String(message.text || '');
  const row = document.createElement('article');
  row.className = 'message-row';
  row.dataset.messageId = message.id || '';
  row.dataset.senderId = message.senderId || '';

  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.textContent = sender.slice(0, 1).toUpperCase();

  const content = document.createElement('div');
  content.className = 'message-content';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const senderName = document.createElement('strong');
  senderName.textContent = sender;
  const badge = document.createElement('span');
  badge.className = 'message-badge';
  const time = document.createElement('time');
  const date = new Date(message.timestamp || message.createdAt || Date.now());
  time.textContent = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  meta.append(senderName, badge, time);

  const bubble = document.createElement('p');
  bubble.className = 'message-bubble';
  bubble.textContent = text;

  const reactionsDisplay = document.createElement('div');
  reactionsDisplay.className = 'message-reactions';

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const reactionPicker = document.createElement('div');
  reactionPicker.className = 'reaction-picker';

  ['ðŸ‘', 'â¤ï¸', 'ðŸ˜‚', 'ðŸ˜®', 'ðŸ˜¢', 'ðŸŽ‰'].forEach((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reaction-picker-button';
    button.textContent = emoji;
    button.title = `React with ${emoji}`;

    button.addEventListener('click', () => {
      if (!row.dataset.messageId || row.classList.contains('is-pending')) return;

      socket.emit('toggle_reaction', {
        room: currentRoom,
        messageId: row.dataset.messageId,
        emoji,
      });
    });

    reactionPicker.append(button);
  });

  content.append(meta, bubble, reactionsDisplay, reactionPicker, actions);
  row.append(avatar, content);
  if (pending && clientId) {
    row.classList.add('is-pending');
    const status = document.createElement('span');
    status.className = 'message-status';
    status.textContent = socket.connected ? 'Sending…' : 'Queued — offline';
    meta.append(status);
    pendingRows.set(clientId, row);
  }
  messageList.append(row);
  messageList.append(row);

  renderReactions(row, message.reactions || []);

  if (message.deleted) markDeleted(row);
  else refreshRow(row);

  if (message.deleted) markDeleted(row);
  else refreshRow(row);
  messageDecorators.forEach((decorate) => decorate(row, message));
  messageList.scrollTop = messageList.scrollHeight;
}

function renderReports(reports) {
  reportsCount.textContent = reports.length;
  reportsList.replaceChildren();

  reports.forEach((report) => {
    const item = document.createElement('li');
    item.className = 'report-item';
    item.dataset.reportId = report.id;
    item.dataset.messageId = report.messageId;

    const text = document.createElement('p');
    text.className = 'report-text';
    text.textContent = report.text || '(message removed)';
    const reason = document.createElement('p');
    reason.className = 'report-reason';
    reason.textContent = report.reason ? `Reason: ${report.reason}` : 'No reason given';
    const actions = document.createElement('div');
    actions.className = 'message-actions is-visible';
    if (canModerate(report.reportedId)) actions.append(actionButton('delete-reported', 'Delete message'));
    actions.append(actionButton('dismiss', 'Dismiss'));
    item.append(text, reason, actions);
    reportsList.append(item);
  });
}

function showNotice(text) {
  notice.textContent = text;
  window.clearTimeout(showNotice.timeoutId);
  showNotice.timeoutId = window.setTimeout(() => {
    notice.textContent = '';
  }, 3500);
}

function resetRoom(room) {
  roomState = { ownerId: '', moderators: [], mutedIds: [] };
  isRemoved = false;
  clearMessages();
  showLoadingState(room);
  renderReports([]);
  refreshAllRows();
}

function joinRoom() {
  const nextRoom = roomInput.value.trim();
  if (!nextRoom) {
    showNotice('Enter a room name first.');
    roomInput.focus();
    return;
  }

  currentRoom = nextRoom;
  roomInput.value = nextRoom;
  roomTitle.textContent = nextRoom;
  resetRoom(nextRoom);
  if (socket.connected) {
    socket.disconnect();
  }
  socket.connect();
}

async function requestAuth(path, { body, token } = {}) {
  let response;
  try {
    response = await fetch(`${serverUrl}/api/auth/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body && JSON.stringify(body),
    });
  } catch {
    throw new Error(`Can't reach the chat server at ${serverUrl}.`);
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Something went wrong. Try again.');
  return data;
}

function showChat() {
  const { id, username } = session.user;
  myUserId = id;
  identity.querySelector('#identity-dot').textContent = username.slice(0, 1).toUpperCase();
  identity.querySelector('#identity-name').textContent = username;
  authView.hidden = true;
  identity.hidden = false;
  chatView.hidden = false;
  resetRoom(currentRoom);
  socket.connect();
  messageInput.focus();
}

function showAuth(message = '') {
  session = null;
  myUserId = '';
  localStorage.removeItem(sessionKey);
  socket.disconnect();
  // Queued messages belong to the account that wrote them.
  outbox.length = 0;
  clearMessages();
  chatView.hidden = true;
  identity.hidden = true;
  authView.hidden = false;
  authNotice.textContent = message;
  authUsername.focus();
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';
  document.querySelector('#auth-eyebrow').textContent = registering ? 'NEW HERE' : 'WELCOME BACK';
  document.querySelector('#auth-title').textContent = registering ? 'Create your account' : 'Log in to gather';
  document.querySelector('#auth-switch-text').textContent = registering ? 'Already have an account?' : 'New here?';
  authSwitch.textContent = registering ? 'Log in' : 'Create an account';
  authSubmit.textContent = registering ? 'Create account' : 'Log in';
  authPassword.autocomplete = registering ? 'new-password' : 'current-password';
  authNotice.textContent = '';
}

async function logOut() {
  const token = session?.token;
  setAuthMode('login');
  showAuth();
  // Revoke the token server-side; the local session is already gone either way.
  await requestAuth('logout', { token }).catch(() => {});
}

socket.on('connect', () => {
  reportedOffline = false;
  setConnectionState(true);
  socket.emit('join_room', { room: currentRoom });
  flushOutbox();
});

socket.on('disconnect', (reason) => {
  setConnectionState(false);
  requeueOutbox();
  // The server drops sockets when the user logs out elsewhere; reconnecting re-checks the token.
  if (reason === 'io server disconnect' && session) socket.connect();
});
socket.on('connect_error', (error) => {
  setConnectionState(false);
  if (error.message === 'Unauthorized') {
    showAuth('Your session has ended. Please log in again.');
    return;
  }
  requeueOutbox();
  if (reportedOffline) return;
  reportedOffline = true;
  showNotice(`Can't reach the chat server at ${serverUrl}.`);
});
socket.on('identity', ({ userId }) => {
  myUserId = userId;
  refreshAllRows();
});
socket.on('room_state', (state) => {
  if (state.room !== currentRoom) return;
  roomState = state;
  refreshAllRows();
  if (isStaff()) socket.emit('list_reports', { room: currentRoom });
});

socket.on('chat_history', (history) => {
  const messages = Array.isArray(history) ? history : [];
  clearMessages();
  if (messages.length) {
    messages.forEach((message) => renderMessage(message));
    // The server sends the newest PAGE_SIZE messages; if exactly PAGE_SIZE arrived
    // there may be older ones.  We detect this by whether the initial batch was
    // full (20 items).  The backend page size is 20.
    hasMoreHistory = messages.length >= 20;
  } else {
    showEmptyState(currentRoom);
  }
  updateLoadOlderButton();

  // Queued messages are not in history yet, so put them back on screen. Any
  // that the server did store are deduped and marked delivered instead.
  for (const message of [...outbox]) {
    if (message.room === currentRoom) renderMessage(message, { pending: true });
  }
});

socket.on('room_presence', ({ room, users }) => {
  if (room !== currentRoom || !Array.isArray(users)) return;

  const names = users.map((user) =>
    user.id === myUserId ? `${user.username} (you)` : user.username
  );

  presenceLabel.textContent = names.length
    ? `Online (${names.length}): ${names.join(', ')}`
    : 'No users online';
});


socket.on('receive_message', (message) => renderMessage(message));

socket.on('message_reactions', ({ messageId, reactions }) => {
  const row = [...messageList.querySelectorAll('.message-row')]
    .find((item) => item.dataset.messageId === messageId);

  if (!row) return;

  row.dataset.reactions = JSON.stringify(reactions);
  renderReactions(row, reactions);
});

socket.on('message_deleted', ({ messageId }) => {
  messageList.querySelectorAll('.message-row').forEach((row) => {
    if (row.dataset.messageId === messageId) markDeleted(row);
  });
});

socket.on('removed_from_room', ({ room }) => {
  if (room !== currentRoom) return;
  isRemoved = true;
  clearMessages();
  updateComposer();
  showNotice('You were removed from this room by a moderator.');
});
socket.on('reports_changed', () => {
  if (isStaff()) socket.emit('list_reports', { room: currentRoom });
});
socket.on('reports', (reports) => renderReports(Array.isArray(reports) ? reports : []));
socket.on('chat_notice', showNotice);
socket.on('chat_error', showNotice);

messageList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('.message-row');
  const { senderId: targetId, messageId } = row.dataset;
  const room = currentRoom;

  switch (button.dataset.action) {
    case 'report': {
      const reason = window.prompt('Why are you reporting this message? (optional)');
      if (reason !== null) socket.emit('report_message', { room, messageId, reason });
      break;
    }
    case 'delete':
      if (window.confirm('Remove this message for everyone?')) socket.emit('delete_message', { room, messageId });
      break;
    case 'mute':
      socket.emit('mute_user', { room, targetId });
      break;
    case 'unmute':
      socket.emit('unmute_user', { room, targetId });
      break;
    case 'remove':
      if (window.confirm('Remove this user from the room? They will not be able to rejoin.')) {
        socket.emit('remove_user', { room, targetId });
      }
      break;
    case 'promote':
      socket.emit('set_moderator', { room, targetId, value: true });
      break;
    case 'demote':
      socket.emit('set_moderator', { room, targetId, value: false });
      break;
    default:
  }
});

reportsList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { reportId, messageId } = button.closest('.report-item').dataset;

  if (button.dataset.action === 'dismiss') {
    socket.emit('dismiss_report', { room: currentRoom, reportId });
  } else if (button.dataset.action === 'delete-reported' && window.confirm('Remove this message for everyone?')) {
    socket.emit('delete_message', { room: currentRoom, messageId });
    socket.emit('dismiss_report', { room: currentRoom, reportId });
  }
});

messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !session) return;

  // The server decides the real sender; these fields only draw the pending bubble.
  const queued = {
    clientId: crypto.randomUUID(),
    room: currentRoom,
    sender: session.user.username,
    senderId: session.user.id,
    text,
    timestamp: new Date().toISOString(),
  };
  outbox.push(queued);
  renderMessage(queued, { pending: true });
  messageInput.value = '';
  messageInput.focus();

  if (socket.connected) flushOutbox();
  else showNotice('Offline. This will send when the connection is back.');
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authSubmit.disabled = true;
  authNotice.textContent = '';

  try {
    session = await requestAuth(authMode, {
      body: { username: authUsername.value, password: authPassword.value },
    });
    localStorage.setItem(sessionKey, JSON.stringify(session));
    authPassword.value = '';
    showChat();
  } catch (error) {
    authNotice.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});

authSwitch.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
document.querySelector('#logout-button').addEventListener('click', logOut);
document.querySelector('#join-button').addEventListener('click', joinRoom);
roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinRoom();
});

if (loadOlderBtn) {
  loadOlderBtn.addEventListener('click', () => {
    if (loadingOlderMessages || !hasMoreHistory) return;

    // Find the oldest rendered message to use as the cursor.
    const firstRow = messageList.querySelector('.message-row[data-message-id]');
    const cursorId = firstRow?.dataset.messageId;
    if (!cursorId) return;

    const room = currentRoom; // capture before any async await
    const requestGeneration = paginationGeneration;
    loadingOlderMessages = true;
    updateLoadOlderButton();

    socket.timeout(10000).emit('load_older_messages', { room, before: cursorId }, (timedOut, response) => {
      // Ignore if the user has since switched rooms.
      if (room !== currentRoom || requestGeneration !== paginationGeneration) return;

      loadingOlderMessages = false;

      if (timedOut || !response || response.error) {
        hasMoreHistory = true; // allow retry
        updateLoadOlderButton();
        showNotice(response?.error || 'Could not load older messages.');
        return;
      }

      hasMoreHistory = Boolean(response.hasMore);
      updateLoadOlderButton();

      const messages = Array.isArray(response.messages) ? response.messages : [];
      if (messages.length === 0) return;

      // Preserve scroll position: record how far the content bottom was from viewport bottom.
      const scrollBottom = messageList.scrollHeight - messageList.scrollTop;

      // Build a fragment with all older rows in chronological order (oldest first),
      // then insert the fragment before the existing first row in one operation.
      const fragment = document.createDocumentFragment();
      messages.forEach((msg) => {
        const clientId = typeof msg.clientId === 'string' ? msg.clientId : '';
        const messageId = typeof msg.id === 'string' ? msg.id : '';
        if (messageId && seenMessageIds.has(messageId)) return;
        if (clientId && seenClientIds.has(clientId)) return;
        if (clientId) seenClientIds.add(clientId);
        if (messageId) seenMessageIds.add(messageId);

        removePlaceholder();
        const sender = String(msg.sender || 'Someone');
        const text = String(msg.text || '');
        const row = document.createElement('article');
        row.className = 'message-row';
        row.dataset.messageId = msg.id || '';
        row.dataset.senderId = msg.senderId || '';

        const avatar = document.createElement('span');
        avatar.className = 'message-avatar';
        avatar.textContent = sender.slice(0, 1).toUpperCase();

        const content = document.createElement('div');
        content.className = 'message-content';
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        const senderName = document.createElement('strong');
        senderName.textContent = sender;
        const badge = document.createElement('span');
        badge.className = 'message-badge';
        const time = document.createElement('time');
        const date = new Date(msg.timestamp || msg.createdAt || Date.now());
        time.textContent = Number.isNaN(date.getTime())
          ? ''
          : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        meta.append(senderName, badge, time);

        const bubble = document.createElement('p');
        bubble.className = 'message-bubble';
        bubble.textContent = text;
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        content.append(meta, bubble, actions);
        row.append(avatar, content);
        fragment.append(row);

        if (msg.deleted) markDeleted(row);
        else refreshRow(row);
        messageDecorators.forEach((decorate) => decorate(row, msg));
      });

      // Insert the entire fragment before the oldest currently-visible message.
      const currentFirst = messageList.querySelector('.message-row');
      if (currentFirst) {
        messageList.insertBefore(fragment, currentFirst);
      } else {
        messageList.append(fragment);
      }

      // Restore scroll position so the user sees the same content they were looking at.
      messageList.scrollTop = messageList.scrollHeight - scrollBottom;
    });
  });
}


// Features in src/features/*.js extend the chat without editing this file. A feature's
// top-level code runs before this file does; its default export is called here, just
// before the chat opens, with the context below.
const messageDecorators = [];
const featureContext = {
  socket,
  serverUrl,
  elements: { messageList, messageForm, messageInput, roomInput, roomTitle },
  getRoom: () => currentRoom,
  getName: () => session?.user.username || '',
  getUserId: () => myUserId,
  showNotice,
  // Called with (row, message) every time a message is drawn.
  decorateMessage: (decorate) => messageDecorators.push(decorate),
};
Object.values(import.meta.glob('./features/*.js', { eager: true }))
  .forEach((feature) => feature.default?.(featureContext));

if (session?.token && session.user) {
  showChat();
} else {
  showAuth();
}
