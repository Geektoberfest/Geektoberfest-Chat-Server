const { loadApp, openChat, message, $, $$, user } = require('./helpers/loadApp');

const texts = () => $$('.message-bubble').map((bubble) => bubble.textContent);
const typeAndSend = (text) => {
  $('#message-input').value = text;
  $('#message-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
};

describe('login and connection', () => {
  test('without a saved session the login form is shown and nothing connects', () => {
    const socket = loadApp({ session: null });
    expect($('#auth-view').hidden).toBe(false);
    expect($('#chat-view').hidden).toBe(true);
    expect(socket.connectCalls).toBeUndefined();
  });

  test('with a saved session the chat opens as that user and connects with the token', () => {
    const socket = loadApp();
    expect($('#chat-view').hidden).toBe(false);
    expect($('#auth-view').hidden).toBe(true);
    expect($('#identity-name').textContent).toBe(user.username);
    expect(socket.connectCalls).toBe(1);

    let handshake;
    socket.options.auth((data) => { handshake = data; });
    expect(handshake).toEqual({ token: 'tok' });
  });

  test('once connected it joins the current room and shows Connected', () => {
    const socket = loadApp();
    socket.open();
    expect($('#connection-label').textContent).toBe('Connected');
    expect(socket.sent('join_room')[0].args[0]).toEqual({ room: 'general' });
  });

  test('a failed connection shows the error notice', () => {
    const socket = loadApp();
    socket.serverEmit('connect_error', new Error('boom'));
    expect($('#connection-label').textContent).toBe('Connecting');
    expect($('#notice').textContent).toMatch(/Can't reach the chat server/);
  });

  test('the login form signs in through the API and opens the chat', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: 'fresh', user }),
      text: async () => JSON.stringify({ token: 'fresh', user }),
    }));
    const socket = loadApp({ session: null });
    $('#auth-username').value = 'alice';
    $('#auth-password').value = 'correct-horse-battery';
    $('#auth-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.fetch.mock.calls[0][0]).toMatch(/\/api\/auth\/login$/);
    expect($('#chat-view').hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem('gather-session')).token).toBe('fresh');
    expect(socket.connectCalls).toBe(1);
  });
});

describe('messages', () => {
  test('history renders oldest first, and an empty room shows the empty state', () => {
    const socket = loadApp();
    openChat(socket);
    socket.serverEmit('chat_history', [message({ text: 'first' }), message({ text: 'second' })]);
    expect(texts()).toEqual(['first', 'second']);

    socket.serverEmit('chat_history', []);
    expect($('.welcome-note')).not.toBeNull();
    expect(document.body.textContent).toMatch(/No messages yet/);
  });

  test('a live message is appended with its sender', () => {
    const socket = loadApp();
    openChat(socket);
    socket.serverEmit('chat_history', []);
    socket.serverEmit('receive_message', message({ sender: 'carol', text: 'hello all' }));
    expect(texts()).toEqual(['hello all']);
    expect($('.message-meta strong').textContent).toBe('carol');
  });

  test('message text is shown as text, never as HTML', () => {
    const socket = loadApp();
    openChat(socket);
    socket.serverEmit('receive_message', message({ text: '<img src=x onerror=alert(1)>', sender: '<b>x</b>' }));
    expect($('.message-list img')).toBeNull();
    expect($('.message-bubble').textContent).toBe('<img src=x onerror=alert(1)>');
    expect($('.message-meta strong').textContent).toBe('<b>x</b>');
  });

  test('sending queues a pending bubble and emits with a clientId; the ack clears it', () => {
    const socket = loadApp();
    openChat(socket);
    typeAndSend('  hi there  ');

    expect($('#message-input').value).toBe('');
    expect($('.is-pending')).not.toBeNull();
    expect($('.message-status').textContent).toBe('Sending…');

    const [sent] = socket.sent('send_message');
    expect(sent.args[0]).toMatchObject({ room: 'general', text: 'hi there' });
    expect(sent.args[0].clientId).toEqual(expect.any(String));

    sent.callback(null, { ok: true, clientId: sent.args[0].clientId });
    expect($('.is-pending')).toBeNull();
    expect($('.message-status')).toBeNull();
  });

  test('a rejected send removes the bubble, restores the text and shows the reason', () => {
    const socket = loadApp();
    openChat(socket);
    typeAndSend('not allowed');
    socket.sent('send_message')[0].callback(null, { ok: false, error: 'You are muted in this room.' });

    expect($$('.message-row')).toHaveLength(0);
    expect($('#message-input').value).toBe('not allowed');
    expect($('#notice').textContent).toBe('You are muted in this room.');
  });

  test('sending while offline queues the message and flushes it on reconnect', () => {
    const socket = loadApp();
    typeAndSend('later');
    expect($('.message-status').textContent).toBe('Queued — offline');
    expect(socket.sent('send_message')).toHaveLength(0);

    openChat(socket);
    expect(socket.sent('send_message')).toHaveLength(1);
  });

  test('the server echo of a queued message does not draw it twice', () => {
    const socket = loadApp();
    openChat(socket);
    typeAndSend('once only');
    const { clientId } = socket.sent('send_message')[0].args[0];

    socket.serverEmit('receive_message', message({ sender: user.username, senderId: user.id, text: 'once only', clientId }));
    expect(texts()).toEqual(['once only']);
    expect($('.is-pending')).toBeNull();
  });

  test('a chat_error is shown as a notice', () => {
    const socket = loadApp();
    openChat(socket);
    socket.serverEmit('chat_error', 'Something went wrong.');
    expect($('#notice').textContent).toBe('Something went wrong.');
  });

  test('empty room displays friendly UI with Say hello action that pre-fills composer', () => {
    const socket = loadApp();
    openChat(socket);
    socket.serverEmit('chat_history', []);

    expect($('.welcome-note')).not.toBeNull();
    expect($('.welcome-title').textContent).toBe('No messages yet');
    expect(document.body.textContent).toMatch(/Say hello to start the conversation in #general/);
    const helloBtn = $('[data-action="say-hello"]');
    expect(helloBtn).not.toBeNull();

    helloBtn.click();
    expect($('#message-input').value).toBe('Hello everyone! 👋');
  });

  test('joining a new room shows the loading spinner and placeholder without blank screens', () => {
    const socket = loadApp();
    openChat(socket);
    socket.serverEmit('chat_history', [message({ text: 'prev' })]);

    $('#room-input').value = 'random';
    $('#join-button').click();

    expect($('.welcome-note.is-loading')).not.toBeNull();
    expect($('.welcome-spinner')).not.toBeNull();
    expect(document.body.textContent).toMatch(/Fetching the conversation in #random/);
  });

  test('room with history displays contextual room introduction at the top', () => {
    const socket = loadApp();
    openChat(socket);
    socket.serverEmit('chat_history', [message({ text: 'first' }), message({ text: 'second' })]);

    expect($('.room-intro')).not.toBeNull();
    expect($('.room-intro-title').textContent).toContain('general');
    expect($('.room-intro-desc').textContent).toContain('Welcome to the start of the #general channel');
    expect(texts()).toEqual(['first', 'second']);
  });

  test('chat history error displays error state with a retry button', () => {
    const socket = loadApp();
    openChat(socket);
    socket.serverEmit('chat_error', 'Could not load chat history.');

    expect($('.welcome-note.is-error')).not.toBeNull();
    expect(document.body.textContent).toMatch(/Couldn’t load messages/);
    const retryBtn = $('[data-action="retry-history"]');
    expect(retryBtn).not.toBeNull();

    retryBtn.click();
    expect($('.welcome-note.is-loading')).not.toBeNull();
    expect(socket.sent('join_room')).toHaveLength(2);
  });

  test('being removed from room displays friendly removed state instead of blank screen', () => {
    const socket = loadApp();
    openChat(socket);
    socket.serverEmit('chat_history', [message({ text: 'hi' })]);
    socket.serverEmit('removed_from_room', { room: 'general' });

    expect($('.welcome-note')).not.toBeNull();
    expect(document.body.textContent).toMatch(/Removed from room/);
  });
});

describe('roles and moderation', () => {
  const actionsOn = (index = 0) => $$('.message-row')[index].querySelectorAll('.message-actions button');
  const labels = (index) => [...actionsOn(index)].map((button) => button.textContent);

  test('the room owner sees moderation controls on other people\'s messages only', () => {
    const socket = loadApp();
    openChat(socket, { state: { ownerId: user.id } });
    socket.serverEmit('receive_message', message({ senderId: 'u-bob' }));
    socket.serverEmit('receive_message', message({ sender: user.username, senderId: user.id }));

    expect($('#role-label').textContent).toBe('You are the owner');
    expect(labels(0)).toEqual(['Report', 'Delete', 'Mute', 'Remove user', 'Make mod']);
    expect(labels(1)).toEqual([]);
  });

  test('a regular member can only report', () => {
    const socket = loadApp();
    openChat(socket, { state: { ownerId: 'u-owner' } });
    socket.serverEmit('receive_message', message({ senderId: 'u-bob' }));
    expect($('#role-label').textContent).toBe('');
    expect(labels(0)).toEqual(['Report']);
  });

  test('a moderator can act on members but not on the owner', () => {
    const socket = loadApp();
    openChat(socket, { state: { ownerId: 'u-owner', moderators: [user.id] } });
    socket.serverEmit('receive_message', message({ senderId: 'u-bob' }));
    socket.serverEmit('receive_message', message({ senderId: 'u-owner' }));
    expect(labels(0)).toEqual(['Report', 'Delete', 'Mute', 'Remove user']);
    expect(labels(1)).toEqual(['Report']);
  });

  test('clicking Mute and Delete emit the moderation events for that message', () => {
    window.confirm = jest.fn(() => true);
    const socket = loadApp();
    openChat(socket, { state: { ownerId: user.id } });
    const msg = message({ senderId: 'u-bob' });
    socket.serverEmit('receive_message', msg);

    $('[data-action="mute"]').click();
    $('[data-action="delete"]').click();
    expect(socket.sent('mute_user')[0].args[0]).toEqual({ room: 'general', targetId: 'u-bob' });
    expect(socket.sent('delete_message')[0].args[0]).toEqual({ room: 'general', messageId: msg.id });
  });

  test('a deleted message is replaced by a placeholder and loses its controls', () => {
    const socket = loadApp();
    openChat(socket, { state: { ownerId: user.id } });
    const msg = message({ senderId: 'u-bob', text: 'bad words' });
    socket.serverEmit('receive_message', msg);
    socket.serverEmit('message_deleted', { messageId: msg.id });

    expect($('.message-bubble').textContent).toBe('Message removed by a moderator');
    expect(actionsOn(0)).toHaveLength(0);
  });

  test('being muted disables the composer', () => {
    const socket = loadApp();
    openChat(socket, { state: { ownerId: 'u-owner', mutedIds: [user.id] } });
    expect($('#message-input').disabled).toBe(true);
    expect($('#message-input').placeholder).toBe('You are muted in this room');
  });

  test('being removed from the room disables the composer and tells the user', () => {
    const socket = loadApp();
    openChat(socket);
    socket.serverEmit('removed_from_room', { room: 'general' });
    expect($('#message-input').disabled).toBe(true);
    expect($('#notice').textContent).toMatch(/removed from this room/);
  });

  test('staff see the reports panel and a report can be dismissed', () => {
    const socket = loadApp();
    openChat(socket, { state: { ownerId: user.id } });
    expect($('#reports-panel').hidden).toBe(false);
    expect(socket.sent('list_reports')).toHaveLength(1);

    socket.serverEmit('reports', [{ id: 'r1', messageId: 'm1', reportedId: 'u-bob', text: 'rude', reason: 'spam' }]);
    expect($('#reports-count').textContent).toBe('1');
    $('[data-action="dismiss"]').click();
    expect(socket.sent('dismiss_report')[0].args[0]).toEqual({ room: 'general', reportId: 'r1' });
  });
});
