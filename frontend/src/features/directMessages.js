import './directMessages.css';

// A "Direct messages" list in the sidebar. Opening a conversation swaps the room's messages for a
// private thread with one other user; "Back to room" returns to the room.
export default function initDirectMessages({ socket, elements, getUserId, showNotice }) {
  const { messageList, messageForm } = elements;
  const rail = document.querySelector('.room-rail');

  const section = document.createElement('section');
  section.className = 'dm-rail';
  section.setAttribute('aria-label', 'Direct messages');
  section.innerHTML = `
    <div class="rail-heading">DIRECT MESSAGES</div>
    <form class="dm-open">
      <input id="dm-username" maxlength="24" placeholder="Username" autocomplete="off" aria-label="Username to message" />
      <button class="join-button" type="submit" title="Start a direct message" aria-label="Start a direct message">✉</button>
    </form>
    <ul class="dm-threads" aria-label="Your conversations"></ul>
  `;
  rail.querySelector('.room-hint').after(section);

  const view = document.createElement('section');
  view.className = 'dm-view';
  view.setAttribute('aria-label', 'Direct message conversation');
  view.hidden = true;
  view.innerHTML = `
    <div class="dm-header">
      <button class="message-action dm-back" type="button">← Back to room</button>
      <h1 class="dm-title"></h1>
    </div>
    <div class="dm-messages message-list" role="log" aria-live="polite"></div>
    <form class="dm-composer composer">
      <input maxlength="1000" placeholder="Write a direct message..." autocomplete="off" aria-label="Direct message" />
      <button class="send-button" type="submit" aria-label="Send direct message" title="Send">↑</button>
    </form>
  `;
  messageList.before(view);

  const threadList = section.querySelector('.dm-threads');
  const messagesEl = view.querySelector('.dm-messages');
  const titleEl = view.querySelector('.dm-title');
  const composer = view.querySelector('.dm-composer input');
  let threads = [];
  let current = null;

  function renderThreads() {
    threadList.replaceChildren();
    threads.forEach((thread) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dm-thread' + (current?.id === thread.id ? ' is-active' : '');
      button.textContent = `@${thread.with.username}`;
      button.addEventListener('click', () => openThread(thread));
      item.append(button);
      threadList.append(item);
    });
  }

  function renderMessage(message) {
    const row = document.createElement('article');
    row.className = 'message-row' + (message.senderId === getUserId() ? ' is-mine' : '');
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.textContent = String(message.sender || '?').slice(0, 1).toUpperCase();
    const content = document.createElement('div');
    content.className = 'message-content';
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const name = document.createElement('strong');
    name.textContent = String(message.sender || 'Someone');
    const time = document.createElement('time');
    const date = new Date(message.createdAt);
    time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    meta.append(name, time);
    const bubble = document.createElement('p');
    bubble.className = 'message-bubble';
    bubble.textContent = String(message.text || '');
    content.append(meta, bubble);
    row.append(avatar, content);
    messagesEl.append(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showRoom() {
    current = null;
    view.hidden = true;
    messageList.hidden = false;
    messageForm.hidden = false;
    renderThreads();
  }

  function openThread(thread) {
    current = thread;
    titleEl.textContent = `@${thread.with.username}`;
    messagesEl.replaceChildren();
    messageList.hidden = true;
    messageForm.hidden = true;
    view.hidden = false;
    composer.focus();
    renderThreads();
    socket.emit('dm_history', { threadId: thread.id }, (response) => {
      if (!response?.ok) return showNotice(response?.error || 'Could not open this conversation.');
      if (current?.id !== response.threadId) return;
      messagesEl.replaceChildren();
      response.messages.forEach(renderMessage);
    });
  }

  function loadThreads() {
    socket.emit('dm_list', (response) => {
      if (!response?.ok) return;
      threads = response.threads;
      renderThreads();
    });
  }

  section.querySelector('.dm-open').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = section.querySelector('#dm-username');
    const username = input.value.trim();
    if (!username) return showNotice('Enter a username to message.');
    socket.emit('dm_open', { username }, (response) => {
      if (!response?.ok) return showNotice(response?.error || 'Could not start the conversation.');
      input.value = '';
      if (!threads.some((item) => item.id === response.thread.id)) threads.unshift(response.thread);
      openThread(response.thread);
    });
  });

  view.querySelector('.dm-back').addEventListener('click', showRoom);

  view.querySelector('.dm-composer').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = composer.value.trim();
    if (!text || !current) return;
    socket.emit('dm_send', { threadId: current.id, text }, (response) => {
      if (response?.ok) return;
      if (!composer.value.trim()) composer.value = text;
      showNotice(response?.error || 'Could not send your message.');
    });
    composer.value = '';
  });

  // Live delivery: the server sends every new message to both people in the conversation.
  socket.on('dm_message', ({ threadId, message }) => {
    if (current?.id === threadId) {
      renderMessage(message);
      return;
    }
    const thread = threads.find((item) => item.id === threadId);
    if (thread && message.senderId !== getUserId()) showNotice(`New direct message from ${thread.with.username}.`);
    else if (!thread) loadThreads();
  });

  socket.on('connect', loadThreads);
}
