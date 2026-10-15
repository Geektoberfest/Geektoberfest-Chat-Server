# Better chat UI

- **Grouped messages:** consecutive messages from the same person share one name and avatar, so a
  conversation reads as blocks rather than repeated labels. Deleted messages are never grouped.
- **Jump to latest:** if new messages arrive while you are scrolled up, a "New messages ↓" button
  appears. Click it, or scroll to the bottom, to dismiss it. Your own messages always show you the
  bottom.
- Implemented in `frontend/src/features/betterUi.js` and `betterUi.css`, with no shared files changed.
