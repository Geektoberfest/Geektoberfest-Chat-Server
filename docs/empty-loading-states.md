# Empty and loading states

Clear indicators and friendly messages keep the chat view informative and prevent blank screens
during connection, room transitions, and empty channels.

## States

| State | Shown as | When |
|---|---|---|
| loading | Animated spinner + "Loading messages" with room name | Connecting, joining a room, or fetching chat history |
| empty | Friendly spark + "No messages yet" + room prompt + "Say hello 👋" action | Room history is empty; clicking "Say hello 👋" focuses the composer |
| loaded | Contextual room introduction banner (`.room-intro`) + message history | Chat history arrives; introduction stays at the top as the permanent header |
| error | Warning icon + "Couldn't load messages" + "Try again" action | History fetch fails (`chat_error`); "Try again" retries fetching |
| removed | Prohibited icon + "Removed from room" | The user was removed from the room by a moderator |

- Loading indicators use `role="status"` and `aria-live="polite"` for screen readers.
- Pre-filled starter actions help users start conversations effortlessly.
- Room introductions keep the welcome context visible at the start of any conversation.
- Blank screens are avoided across all transitions (loading, switching rooms, error, and removal).

Implemented in `frontend/src/main.js`, `frontend/index.html`, and `frontend/src/style.css`.
Tests in `frontend/__tests__/chat.test.js`.
