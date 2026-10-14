const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const EDIT_MAX_LENGTH = 1000;

// Only the author can change or remove a message, and only while it is still there.
export function canEditMessage(message, userId) {
  return Boolean(message && userId && message.senderId === String(userId) && !message.deleted);
}

export function canDeleteMessage(message, userId) {
  return canEditMessage(message, userId);
}

export function cleanEditText(value) {
  if (typeof value !== 'string') return { error: 'Message must be text.' };
  const text = value.trim();
  if (!text) return { error: 'Message cannot be empty.' };
  if (text.length > EDIT_MAX_LENGTH) return { error: `Messages can be ${EDIT_MAX_LENGTH} characters or fewer.` };
  if (CONTROL_CHARS.test(text)) return { error: 'Message contains invalid characters.' };
  return { value: text };
}
