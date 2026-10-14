import './messageControls.css';

// Lets each person edit or delete their own messages. Edits and deletions show up live for everyone
// in the room, and the "edited" state is kept when the history is reloaded.
export default function initMessageControls({ socket, getRoom, getUserId, showNotice, decorateMessage }) {
  const isOwn = (row) => Boolean(row.dataset.senderId) && row.dataset.senderId === getUserId();

  function rowFor(messageId) {
    return [...document.querySelectorAll('.message-row')].find((row) => row.dataset.messageId === messageId);
  }

  function actionButton(action, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'message-action';
    button.dataset.action = action;
    button.textContent = label;
    return button;
  }

  // Keeps the Edit and Delete buttons in step with the message: only on your own live messages.
  function syncControls(row) {
    const existing = row.querySelector('.message-own-actions');
    const live = isOwn(row) && Boolean(row.dataset.messageId) && row.dataset.deleted !== 'true';
    if (!live) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const box = document.createElement('span');
    box.className = 'message-own-actions';
    box.append(actionButton('edit', 'Edit'), actionButton('delete', 'Delete'));
    row.querySelector('.message-meta').append(box);
  }

  function showEdited(row, text, editedAt) {
    row.querySelector('.message-bubble').textContent = text;
    row.classList.add('is-edited');
    let badge = row.querySelector('.message-edited');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'message-edited';
      badge.textContent = 'edited';
      row.querySelector('.message-meta').append(badge);
    }
    const date = new Date(editedAt);
    badge.title = Number.isNaN(date.getTime()) ? '' : `Edited ${date.toLocaleString()}`;
  }

  decorateMessage((row) => syncControls(row));

  // Edit and delete buttons on your own messages.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.message-own-actions button[data-action]');
    if (!button) return;
    const row = button.closest('.message-row');
    const messageId = row.dataset.messageId;
    if (!messageId) return;

    if (button.dataset.action === 'edit') {
      const current = row.querySelector('.message-bubble').textContent;
      const next = window.prompt('Edit your message', current);
      if (next === null || !next.trim() || next.trim() === current) return;
      socket.emit('edit_message', { room: getRoom(), messageId, text: next }, (response) => {
        if (!response?.ok) return showNotice(response?.error || 'Could not edit this message.');
        showEdited(row, next.trim(), response.editedAt);
      });
    } else if (button.dataset.action === 'delete') {
      if (!window.confirm('Delete this message for everyone?')) return;
      socket.emit('delete_own_message', { room: getRoom(), messageId }, (response) => {
        if (!response?.ok) return showNotice(response?.error || 'Could not delete this message.');
        row.dataset.deleted = 'true';
        syncControls(row);
      });
    }
  });

  // Live updates from everyone in the room.
  socket.on('message_updated', ({ messageId, text, editedAt }) => {
    const row = rowFor(messageId);
    if (row) showEdited(row, text, editedAt);
  });

  socket.on('message_deleted', ({ messageId }) => {
    const row = rowFor(messageId);
    if (row) syncControls(row);
  });

  // The server sends the edited and deleted state of the room's messages once history has loaded.
  socket.on('chat_history', () => {
    socket.emit('message_states', { room: getRoom() }, (response) => {
      if (!response?.ok) return;
      Object.entries(response.states).forEach(([messageId, state]) => {
        const row = rowFor(messageId);
        if (!row) return;
        if (state.edited) showEdited(row, state.text, state.editedAt);
        if (state.deleted) row.dataset.deleted = 'true';
        syncControls(row);
      });
    });
  });

  // Your own message is drawn before the server confirms it, so link the confirmed id to that bubble.
  socket.on('receive_message', (message) => {
    if (!message.id || message.senderId !== getUserId()) return;
    const row = [...document.querySelectorAll('.message-row')].find((item) => (
      isOwn(item) && !item.dataset.messageId && item.querySelector('.message-bubble').textContent === message.text
    ));
    if (row) {
      row.dataset.messageId = message.id;
      syncControls(row);
    }
  });
}
