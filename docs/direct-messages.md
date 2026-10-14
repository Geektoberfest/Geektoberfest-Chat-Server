# Direct messages

Any logged-in user can message another user by username. Each pair of users shares one private
conversation, shown in the sidebar under **Direct messages**. Opening one replaces the room's
messages with that conversation; **Back to room** returns to the room.

## Access rules

- Only the two people in a conversation can open it, read its history or send to it.
- You cannot message yourself, and usernames must match an existing account.
- Messages are 1 to 1000 characters, with no control characters.
- Conversations are stored separately from rooms, and the room model is unchanged.

## Socket events

| Event | Payload | Reply |
|---|---|---|
| `dm_open` | `{ username }` | `{ ok, thread: { id, with } }` |
| `dm_list` | none | `{ ok, threads }` |
| `dm_history` | `{ threadId }` | `{ ok, threadId, messages }` (latest 50) |
| `dm_send` | `{ threadId, text }` | `{ ok, message }` |

New messages arrive as `dm_message` to both people in the conversation, across all backend
instances.

## Implementation

- `backend/features/directMessages.js` holds the models, the events and the Redis delivery.
- `backend/utils/directMessages.js` holds the access and validation rules, with unit tests.
- `frontend/src/features/directMessages.js` adds the sidebar list and the conversation view.

Run the unit tests with `npm run test:unit` in `backend/`.
