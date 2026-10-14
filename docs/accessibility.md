# Accessibility

## What changed

- **Focus:** every button, link and input shows a clear outline when focused with the keyboard.
- **Skip link:** Tab once after the page loads to reach **Skip to messages**, which moves focus to the message list.
- **Escape:** closes the search results, or a direct-message conversation, and returns to the room.
- **Names:** every button has a name for screen readers, from its text or its title. Inputs without a
  label use their placeholder as their name.
- **Messages:** the message list is labelled "Messages", and new messages are announced politely.

## Keyboard test

1. Reload the page and press **Tab**. The first stop is "Skip to messages".
2. Press **Enter** on it. Focus moves to the messages.
3. Press **Tab** through the sidebar, the room field, the search boxes and the composer. Each stop
   shows an outline.
4. Open the search results, then press **Escape**. They close.
5. Open a direct message, then press **Escape**. It returns to the room.

Implemented in `frontend/src/features/accessibility.js` and `accessibility.css`.
