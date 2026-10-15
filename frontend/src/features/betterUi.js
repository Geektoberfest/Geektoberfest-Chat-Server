import './betterUi.css';

// Small polish for the chat: messages from the same person in a row are grouped under one name,
// and a "Jump to latest" button appears when new messages arrive while you are scrolled up.
export default function initBetterUi({ elements, decorateMessage }) {
  const { messageList } = elements;
  const NEAR_BOTTOM_PX = 80;

  let nearBottom = true;
  messageList.addEventListener('scroll', () => {
    nearBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) jump.hidden = true;
  });

  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'jump-latest';
  jump.textContent = 'New messages ↓';
  jump.hidden = true;
  jump.addEventListener('click', () => {
    messageList.scrollTop = messageList.scrollHeight;
    jump.hidden = true;
  });
  messageList.parentElement.append(jump);

  // Runs for every message as it is drawn, after it is added to the list and before it scrolls.
  decorateMessage((row) => {
    const previous = row.previousElementSibling;
    const sameSender = previous
      && previous.classList.contains('message-row')
      && previous.dataset.senderId
      && previous.dataset.senderId === row.dataset.senderId
      && !row.dataset.deleted;

    row.classList.toggle('is-grouped', Boolean(sameSender));

    // main.js scrolls to the newest message straight after drawing it. If the reader is up in the
    // history, put them back where they were once that scroll has happened, and offer the pill.
    if (!nearBottom && !row.classList.contains('is-mine')) {
      const place = messageList.scrollTop;
      queueMicrotask(() => { messageList.scrollTop = place; });
      jump.hidden = false;
    }
  });
}
