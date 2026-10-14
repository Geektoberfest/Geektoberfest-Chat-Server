const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const DM_MAX_LENGTH = 1000;

// One thread per pair of users, whichever way round they are listed.
export function threadKey(a, b) {
  return [String(a), String(b)].sort().join(':');
}

// Only the two people in a conversation can open it or send to it.
export function canAccessThread(thread, userId) {
  return Boolean(thread && userId && thread.participants?.includes(String(userId)));
}

export function cleanDmText(value) {
  if (typeof value !== 'string') return { error: 'Message must be text.' };
  const text = value.trim();
  if (!text) return { error: 'Message is empty.' };
  if (text.length > DM_MAX_LENGTH) return { error: `Messages can be ${DM_MAX_LENGTH} characters or fewer.` };
  if (CONTROL_CHARS.test(text)) return { error: 'Message contains invalid characters.' };
  return { value: text };
}
