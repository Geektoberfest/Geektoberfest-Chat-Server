# Gather Chat

Realtime chat app with a Vite frontend and an Express/Socket.IO backend. MongoDB stores message history and Redis Pub/Sub broadcasts messages between backend instances.

## Documentation

Comprehensive guides and technical references for developers and contributors:

- **[System Architecture](docs/architecture.md)**: High-level system overview, multi-instance Redis scaling, plugin architecture, and data flow.
- **[API Reference](docs/api.md)**: Complete HTTP REST endpoints and Socket.IO real-time event schemas, payloads, and error codes.
- **[Setup & Local Development Guide](docs/setup-guide.md)**: Step-by-step setup with Docker Compose, environment configuration, CLI client, and troubleshooting FAQs.
- **[Testing Guide](docs/testing.md)**: Running integration and unit tests across backend and frontend.
- **Feature Deep Dives**:
  - [Production Hardening & Rate Limiting](docs/production-hardening.md)
  - [Direct Messaging](docs/direct-messages.md)
  - [Private Rooms & Invites](docs/private-rooms.md)
  - [Message Controls (Edit & Delete)](docs/message-controls.md)
  - [Search & Mentions](docs/search-and-mentions.md)
  - [Typing Indicators](docs/typing-indicators.md)
  - [Connection Feedback](docs/connection-feedback.md)
  - [Accessibility](docs/accessibility.md)

## Local development

1. Copy `backend/.env.example` to `backend/.env` and fill in `MONGO_URL`, `REDIS_URL`, and `JWT_SECRET` (any long random string, e.g. `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`).
2. In `backend/`, run `npm ci` and then `npm run dev`.
3. Copy `frontend/.env.example` to `frontend/.env` if the backend is not at `http://localhost:5000`.
4. In `frontend/`, run `npm ci` and then `npm run dev`.
*(For detailed instructions and Docker Compose setup, see the [Setup Guide](docs/setup-guide.md).)*

## Deploy

### Render backend

The root `render.yaml` defines a Node web service rooted at `backend/`. Create a Render Blueprint from this repository and provide `MONGO_URL`, `REDIS_URL`, and `FRONTEND_ORIGIN` when prompted. Render generates `JWT_SECRET` and supplies `PORT`; the backend binds to it and exposes `/health` for health checks.

### Vercel services

For a separate Render backend and Vercel frontend, set the Vercel project's Root Directory to `frontend` and set `VITE_CHAT_SERVER_URL` to `https://chat-server-2-fzyd.onrender.com` (or your Render service URL). Set Render's `FRONTEND_ORIGIN` to the exact deployed Vercel origin. The frontend defaults to this repository's Render URL in production, but the environment variable can override it.

For a single Vercel project using the root `vercel.json`, set the repository root as the Root Directory. It builds `frontend/` and `backend/` as services, routes `/api/` and `/socket.io/` to the backend, and sends other paths to the frontend; leave `VITE_CHAT_SERVER_URL` unset so the browser connects to the same origin. Configure `MONGO_URL`, `REDIS_URL`, `JWT_SECRET`, and `FRONTEND_ORIGIN` for the backend service. Service bindings are not needed because the browser uses the public `/api` and Socket.IO rewrites and the backend does not call another Vercel service.

### Moderation

The first user to join a room becomes its owner and can promote others to moderator. Owners can act on anyone; moderators only on regular members. Staff can delete messages, mute/unmute users and remove users from a room (removal is permanent for that room), and see a list of reported messages. Any user can report another user's message. Permissions are enforced on the server, and muted or removed users cannot send messages. Roles, mutes, and removals are tied to the logged-in account (see Authentication below), so they follow a user across devices and can't be dodged by clearing browser storage. Run backend tests with `npm test` in `backend/`.

Keep credentials in Render/Vercel environment settings. Do not commit `.env` files.

## Authentication

Users register and log in with a username and password before they can chat.

- `POST /api/auth/register` and `POST /api/auth/login` take `{ "username", "password" }` and return `{ token, user }`. Usernames are 3-24 lowercase letters, numbers, `_`, or `-`; passwords are 8-128 characters and are stored as salted scrypt hashes.
- Tokens are JWTs signed with `JWT_SECRET` and expire after 7 days. The browser keeps the session in local storage and sends the token in the Socket.IO handshake (`auth: { token }`); connections without a valid token are rejected with `Unauthorized`.
- `POST /api/auth/logout` (with `Authorization: Bearer <token>`) revokes every token issued to that user and disconnects their open sockets.
- Messages are always attributed to the authenticated user; any `sender` sent by the client is ignored.
- `cli-client.js` asks you to log in or register before joining a room. Set `CHAT_SERVER_URL` to point it at a local backend.

## Issues for contributors

These are proposed improvements, not current deployment blockers. Pick one, open an issue describing the approach, and submit a focused pull request. Keep secrets out of commits and include screenshots for UI changes.

### Good first issues

- [ ] **Remember the display name:** Store the chosen display name in local storage and restore it on reload.
- [ ] **Improve connection feedback:** Show clear connecting, connected, reconnecting, and disconnected states; let users retry after an error.
- [ ] **Empty and loading states:** Add useful UI while chat history loads and when a room has no messages.
- [ ] **Room navigation:** Show recently joined rooms and make switching rooms easier on mobile.
- [ ] **Message history paging:** Load older messages on demand instead of limiting the room to the latest 20.
- [ ] **Accessibility pass:** Check keyboard navigation, focus states, and screen-reader labels across the chat UI.

### Major upgrades

- [x] **User accounts and authentication:** Add registration, login, logout, secure password hashing, and a session or token strategy. Protect Socket.IO connections and ensure clients can only send messages as the authenticated user.
- [ ] **User profiles:** Persist a unique display name and optional avatar; add profile editing and show profile details beside messages. Do not trust sender names supplied by the browser once authentication exists.
- [ ] **Room membership and permissions:** Add room creation, public/private rooms, invitations, and server-side checks before joining or sending messages.
- [ ] **Message controls:** Add edit/delete support with ownership checks, plus clear edited/deleted states in history and live updates.
- [ ] **Reliable message delivery:** Acknowledge successful sends, retain unsent messages during disconnects, and avoid duplicate messages after reconnecting.
- [ ] **Production hardening:** Add request and message rate limits, stricter payload validation, graceful shutdown, structured logs, and health checks that report dependency status.
- [ ] **Automated coverage:** Add backend tests for authentication, permissions, message persistence, and Socket.IO events, plus frontend tests for chat and connection states.

### Stretch ideas

- [ ] Add direct messages, typing indicators, reactions, and online presence.
- [ ] Add image/file attachments with type and size limits and external object storage.
- [ ] Add message search and notifications for mentions or replies.
- [x] Add moderation tools such as reporting, muting, and room administrators.
