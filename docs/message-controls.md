# Message controls

People can edit or delete their own messages. Everyone in the room sees the change live, and an
edited message shows an "edited" marker. Deleted messages show as removed.

## Rules

- Only the author can edit or delete a message. The server checks this on every request, using the
  logged-in account, so it can't be bypassed from the client.
- A deleted message can't be edited or deleted again.
- Edited text follows the same checks as new messages: 1 to 1000 characters, no control characters.

## Socket events

| Event | Payload | Reply |
|---|---|---|
| `edit_message` | `{ room, messageId, text }` | `{ ok, editedAt }` |
| `delete_own_message` | `{ room, messageId }` | `{ ok }` |
| `message_states` | `{ room }` | `{ ok, states }` (edited and deleted messages in the room) |

Live events: `message_updated` (edit) and the existing `message_deleted` (delete).

## Implementation

- `backend/features/messageControls.js` holds the events and the edit record.
- `backend/utils/messageControls.js` holds the ownership and validation rules, with unit tests.
- `frontend/src/features/messageControls.js` adds the Edit and Delete buttons and the edited marker.

Run the unit tests with `npm run test:unit` in `backend/`.
