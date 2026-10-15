# API Reference

This document provides a comprehensive specification for both the HTTP REST API and the real-time Socket.IO WebSocket protocol implemented in Gather Chat.

---

## 1. HTTP REST Endpoints

### Base URL
- Local development: `http://localhost:5000`
- Production: Deployment domain (e.g. `https://your-service.onrender.com`)

### Authentication Header
Endpoints requiring authentication expect an `Authorization` header containing a valid Bearer token:
```http
Authorization: Bearer <jwt-token>
```

---

### 1.1 Register Account
Creates a new user account with a salted scrypt-hashed password.

- **Endpoint**: `POST /api/auth/register`
- **Content-Type**: `application/json`
- **Request Body**:
  ```json
  {
    "username": "alice",
    "password": "supersecretpassword123"
  }
  ```
  - `username` *(string, required)*: 3–24 characters matching `^[a-z0-9_-]{3,24}$`. Automatically normalized to lowercase and trimmed.
  - `password` *(string, required)*: 8–128 characters.

- **Responses**:
  - `201 Created`:
    ```json
    {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": "64bf0a88b5a19c4d8e20f1a1",
        "username": "alice"
      }
    }
    ```
  - `400 Bad Request`: Validation failure (e.g., username regex or password length violation).
  - `409 Conflict`: Username is already taken.

---

### 1.2 User Login
Authenticates an existing user and issues a fresh 7-day JWT.

- **Endpoint**: `POST /api/auth/login`
- **Content-Type**: `application/json`
- **Request Body**:
  ```json
  {
    "username": "alice",
    "password": "supersecretpassword123"
  }
  ```

- **Responses**:
  - `200 OK`:
    ```json
    {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": "64bf0a88b5a19c4d8e20f1a1",
        "username": "alice"
      }
    }
    ```
  - `401 Unauthorized`: Invalid credentials (`{"error": "Incorrect username or password."}`). Employs dummy-hash comparison to resist timing analysis attacks.

---

### 1.3 User Logout
Revokes all active sessions across devices by incrementing `tokenVersion` and disconnects all active sockets for the account.

- **Endpoint**: `POST /api/auth/logout`
- **Headers**: `Authorization: Bearer <token>`
- **Responses**:
  - `204 No Content`: Successful logout and session revocation.
  - `401 Unauthorized`: Token missing or invalid.

---

### 1.4 Search Messages
Performs indexed search across room messages by keyword and/or username.

- **Endpoint**: `GET /api/search`
- **Headers**: `Authorization: Bearer <token>`
- **Query Parameters**:
  | Parameter | Type | Required | Description |
  | :--- | :--- | :--- | :--- |
  | `room` | string | Yes | Room name to search in (max 32 chars). |
  | `q` | string | Optional | Keyword search filter (max 100 chars). |
  | `user` | string | Optional | Username filter (max 24 chars). |
  | `before` | ISO Date / timestamp | Optional | Pagination cursor (loads messages before this timestamp). |

- **Responses**:
  - `200 OK`:
    ```json
    {
      "messages": [
        {
          "sender": "alice",
          "senderId": "64bf0a88b5a19c4d8e20f1a1",
          "text": "Hello team, let's sync up!",
          "timestamp": "10:42 AM",
          "createdAt": "2026-10-15T05:12:00.000Z"
        }
      ],
      "hasMore": false
    }
    ```
  - `400 Bad Request`: Missing `room` parameter or invalid pagination format.
  - `401 Unauthorized`: Missing or invalid Bearer token.

---

### 1.5 Health & Readiness Check
Inspects database connectivity, Redis publisher/subscriber status, and server shutdown state.

- **Endpoint**: `GET /health`
- **Responses**:
  - `200 OK`:
    ```json
    { "status": "OK" }
    ```
  - `503 Service Unavailable`:
    ```json
    { "status": "Unavailable" }
    ```
    Returned when MongoDB is disconnected, either Redis client is down, or server is undergoing graceful shutdown.

---

## 2. Socket.IO Real-Time Protocol

### 2.1 Connection & Handshake

Socket.IO connections **must** provide the JWT token in the connection handshake `auth` object:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  auth: {
    token: '<jwt-token>'
  }
});
```

- If `token` is missing, expired, or revoked (`tokenVersion` mismatch), the handshake is rejected with `Unauthorized`.
- Upon successful authentication, the server populates `socket.data.user = { id, username }` and joins the socket to a private channel `user:<userId>`.

---

### 2.2 Core Room Events

#### `join_room` (Client -> Server)
Joins a chat room. Checks private room access and ban status.
- **Payload**: `{ "room": "general" }` or string `"general"`
- **Server Reactions**:
  - Emits `identity` with `{ userId }` to calling socket.
  - Broadcasts `room_presence` with current online users to room.
  - Emits `room_state` with owner, moderators, and muted list.
  - Emits `chat_history` with the 20 most recent messages.

#### `room_presence` (Server -> Client)
Emitted when members join or disconnect from a room.
- **Payload**:
  ```json
  {
    "room": "general",
    "users": [
      { "id": "64bf0a88b5a19c4d8e20f1a1", "username": "alice" },
      { "id": "64bf0b12b5a19c4d8e20f1b2", "username": "bob" }
    ]
  }
  ```

#### `room_state` (Server -> Client)
Synchronizes room governance and role permissions.
- **Payload**:
  ```json
  {
    "room": "general",
    "ownerId": "64bf0a88b5a19c4d8e20f1a1",
    "moderators": ["64bf0b12b5a19c4d8e20f1b2"],
    "mutedIds": []
  }
  ```

#### `chat_history` (Server -> Client)
Initial recent messages returned upon room join (chronological order).
- **Payload**: Array of message objects:
  ```json
  [
    {
      "id": "64bf0c99b5a19c4d8e20f1c3",
      "sender": "alice",
      "senderId": "64bf0a88b5a19c4d8e20f1a1",
      "clientId": "uuid-1234",
      "text": "Welcome to Gather Chat!",
      "deleted": false,
      "timestamp": "10:45 AM",
      "createdAt": "2026-10-15T05:15:00.000Z",
      "reactions": [
        { "emoji": "👍", "userIds": ["64bf0b12b5a19c4d8e20f1b2"] }
      ]
    }
  ]
  ```

#### `send_message` (Client -> Server)
Sends a message to the active room.
- **Payload**:
  ```json
  {
    "room": "general",
    "text": "Hello world!",
    "clientId": "optional-client-side-uuid"
  }
  ```
- **Acknowledgement Callback**: `(response) => void`
  - Success: `{ "ok": true, "clientId": "...", "timestamp": "..." }`
  - Duplicate: `{ "ok": true, "clientId": "...", "duplicate": true }`
  - Failure: `{ "ok": false, "error": "Reason" }`
- **Broadcast**: Emits `receive_message` to everyone in the room across all backend instances via Redis.

#### `receive_message` (Server -> Client)
Live message delivery to room subscribers.
- **Payload**:
  ```json
  {
    "id": "64bf0c99b5a19c4d8e20f1c3",
    "room": "general",
    "sender": "alice",
    "senderId": "64bf0a88b5a19c4d8e20f1a1",
    "text": "Hello world!",
    "clientId": "uuid-1234",
    "timestamp": "10:46 AM"
  }
  ```

#### `load_older_messages` (Client -> Server)
Cursor-based pagination to load older message history.
- **Payload**:
  ```json
  {
    "room": "general",
    "before": "64bf0c99b5a19c4d8e20f1c3"
  }
  ```
- **Acknowledgement Callback**:
  ```json
  {
    "messages": [ /* Array of older message objects */ ],
    "hasMore": true
  }
  ```

---

### 2.3 Message Controls & Reactions

#### `edit_message` (Client -> Server)
Edits the text of an existing message. The authenticated user must be the author.
- **Payload**: `{ "room": "general", "messageId": "<id>", "text": "Updated text" }`
- **Acknowledgement**: `{ "ok": true, "editedAt": "2026-10-15T05:20:00.000Z" }`
- **Server Broadcast**: Emits `message_updated` with `{ messageId, text, editedAt }` to the room.

#### `delete_own_message` (Client -> Server)
Soft-deletes a message written by the calling user.
- **Payload**: `{ "room": "general", "messageId": "<id>" }`
- **Acknowledgement**: `{ "ok": true }`
- **Server Broadcast**: Emits `message_deleted` with `{ messageId }` to the room.

#### `toggle_reaction` (Client -> Server)
Toggles an emoji reaction on a message.
- **Payload**:
  ```json
  {
    "room": "general",
    "messageId": "<id>",
    "emoji": "👍"
  }
  ```
- **Allowed Emojis**: `👍`, `❤️`, `😂`, `😮`, `😢`, `🎉`
- **Server Broadcast**: Emits `message_reactions` with `{ messageId, reactions: [{ emoji, userIds }] }`.

---

### 2.4 Typing Indicators

#### `typing` (Client -> Server)
Notifies the room of active or stopped typing. Throttled automatically.
- **Payload**: `{ "room": "general", "typing": true }`
- **Server Broadcast**: Emits `typing` to the room:
  ```json
  {
    "room": "general",
    "typing": true,
    "sender": "alice",
    "senderId": "64bf0a88b5a19c4d8e20f1a1"
  }
  ```

---

### 2.5 Moderation Protocol

Only room **Owners** and **Moderators** can execute staff moderation actions.

| Event (Client -> Server) | Payload | Permission | Effect |
| :--- | :--- | :--- | :--- |
| `set_moderator` | `{ "room": "...", "targetId": "...", "value": true/false }` | Owner only | Promotes or demotes moderator; emits `room_state`. |
| `mute_user` | `{ "room": "...", "targetId": "..." }` | Staff | Silences user; emits `room_state`. User cannot send messages. |
| `unmute_user` | `{ "room": "...", "targetId": "..." }` | Staff | Unsilences user; emits `room_state`. |
| `remove_user` | `{ "room": "...", "targetId": "..." }` | Staff | Permanently bans target from room. Emits `user_removed` and forces socket disconnect from room. |
| `delete_message` | `{ "room": "...", "messageId": "..." }` | Staff | Moderation delete of any member message. Emits `message_deleted`. |
| `report_message` | `{ "room": "...", "messageId": "...", "reason": "Spam" }` | Any Member | Submits message to moderation queue. Emits `reports_changed` to staff. |
| `list_reports` | `{ "room": "..." }` | Staff | Responds with `reports` event containing recent pending reports. |
| `dismiss_report` | `{ "room": "...", "reportId": "..." }` | Staff | Deletes report and emits `reports_changed`. |

---

### 2.6 Private Rooms & Direct Messages

#### Private Rooms
- `set_private`: `{ "room": "...", "value": true }` (Owner only). Sets room invite-only.
- `invite_user`: `{ "room": "...", "username": "bob", "value": true }` (Owner/Staff). Grants access.

#### Direct Messages (1-on-1)
- `dm_open`: `{ "username": "bob" }` (Ack: `{ ok: true, thread: { id, with: { id, username } } }`)
- `dm_list`: `{}` (Ack: `{ ok: true, threads: [...] }`)
- `dm_history`: `{ "threadId": "<id>" }` (Ack: `{ ok: true, threadId, messages: [...] }`)
- `dm_send`: `{ "threadId": "<id>", "text": "Hi Bob" }` (Ack: `{ ok: true, message: {...} }`)
- `dm_message` (Server -> Client): Delivers new message to both participants' sockets across instances.

---

### 2.7 System Notices & Error Events
- `chat_error` *(Server -> Client)*: String message indicating an action failed (e.g. `'You are muted in this room.'`, `'Enter a room name first.'`).
- `chat_notice` *(Server -> Client)*: Informational notification (e.g. `'Report sent to the room moderators.'`).
- `removed_from_room` *(Server -> Client)*: Emitted to a user when banned by a moderator (`{ "room": "general" }`).
