# Local Development & Setup Guide

This guide walks you through setting up and running Gather Chat locally for development, testing, and production deployment.

---

## 1. Prerequisites

Ensure you have the following installed on your machine:
- **Node.js**: v18.0.0 or later (v20+ recommended)
- **npm**: v9.0.0 or later
- **Git**
- **MongoDB**: v6.0+ (Local install, Docker, or [MongoDB Atlas](https://www.mongodb.com/atlas))
- **Redis**: v6.0+ (Local install, Docker, or [Upstash](https://upstash.com/))

> [!TIP]
> If you prefer not to install MongoDB and Redis directly on your host machine, you can run both services via Docker with a single command (see Section 2).

---

## 2. Fast Setup with Docker Compose (Recommended)

You can launch both MongoDB and Redis locally using Docker:

Create a `docker-compose.yml` file in the project root:

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:7
    container_name: gather-mongo
    restart: always
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

  redis:
    image: redis:7-alpine
    container_name: gather-redis
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  mongo-data:
  redis-data:
```

Start the containers:
```bash
docker compose up -d
```

Verify that both containers are running:
```bash
docker compose ps
```

---

## 3. Environment Configuration

### 3.1 Backend Configuration (`backend/.env`)

1. Copy the example configuration file:
   ```bash
   cp backend/.env.example backend/.env
   ```
2. Generate a cryptographically secure random `JWT_SECRET`:
   ```bash
   node -e "console.log(crypto.randomBytes(32).toString('hex'))"
   ```
3. Populate `backend/.env` with your settings:

```ini
# Port the Express & Socket.IO server binds to
PORT=5000

# MongoDB connection string
MONGO_URL=mongodb://127.0.0.1:27017/gather_chat

# Redis connection URL for multi-instance Pub/Sub
REDIS_URL=redis://127.0.0.1:6379

# Long random secret for signing and verifying JSON Web Tokens
JWT_SECRET=your_generated_random_secret_here

# Comma-separated list of allowed frontend origins for CORS
FRONTEND_ORIGIN=http://localhost:5173,http://localhost:5174

# Set to 'true' if running behind a reverse proxy (e.g. Render, Nginx, Cloudflare)
TRUST_PROXY=false
```

### 3.2 Frontend Configuration (`frontend/.env`)

1. If connecting to a local backend running on `http://localhost:5000`, creating `frontend/.env` is optional because `http://localhost:5000` is the default in development.
2. If your backend runs on a custom port or remote host, create `frontend/.env`:
   ```ini
   VITE_CHAT_SERVER_URL=http://localhost:5000
   ```

---

## 4. Installing Dependencies & Running

Open two terminal sessions (one for the backend and one for the frontend).

### Terminal 1: Backend Server

```bash
# Navigate to backend directory
cd backend

# Install dependencies cleanly
npm ci

# Start the server with Nodemon (auto-reloads on file changes)
npm run dev
```

You should see logs similar to:
```text
MongoDB connected: 127.0.0.1:27017
Server is running on port 5000
```

Verify backend health in your browser or terminal:
```bash
curl http://localhost:5000/health
# Response: {"status":"OK"}
```

### Terminal 2: Frontend Web App

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies cleanly
npm ci

# Start the Vite development server
npm run dev
```

Open your browser and navigate to the printed URL (usually **`http://localhost:5173`**).

---

## 5. Running the CLI Client

Gather Chat includes an interactive terminal client (`cli-client.js`) located in the root repository.

1. Ensure the backend server is running on port 5000.
2. Open a new terminal and run:
   ```bash
   node cli-client.js
   ```
3. If running against a custom backend URL:
   ```bash
   CHAT_SERVER_URL=http://localhost:5000 node cli-client.js
   ```
4. Follow the interactive prompts to register or log in, choose a room, and chat directly from your terminal.

---

## 6. Running Tests

The test suite includes automated backend integration tests (using an in-memory MongoDB and Redis stub), backend unit tests, and frontend integration tests.

### Backend Tests
```bash
cd backend

# Run both integration and unit tests
npm test

# Run only Jest integration tests
npm run test:integration

# Run only native Node.js unit tests
npm run test:unit
```

### Frontend Tests
```bash
cd frontend

# Run frontend tests
npm test
```

---

## 7. Troubleshooting & FAQ

### Issue: `JWT_SECRET is not set`
- **Cause**: The `JWT_SECRET` environment variable is missing from `backend/.env`.
- **Solution**: Run `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` and paste the generated string into `backend/.env` under `JWT_SECRET=`.

### Issue: `Redis connection error: connect ECONNREFUSED 127.0.0.1:6379`
- **Cause**: The local Redis service is not running or blocked by a firewall.
- **Solution**: Start Redis via `docker compose up -d` or verify the service status with `redis-cli ping` (should reply `PONG`).

### Issue: `MongoDB connection error: connect ECONNREFUSED 127.0.0.1:27017`
- **Cause**: MongoDB daemon is inactive.
- **Solution**: Start MongoDB via `docker compose up -d` or check your local service (`mongod` / `net start MongoDB`).

### Issue: `CORS error in browser console`
- **Cause**: Frontend origin (e.g. `http://localhost:5173`) is not listed in `FRONTEND_ORIGIN`.
- **Solution**: Add your exact frontend URL (including port) to `FRONTEND_ORIGIN` in `backend/.env`, e.g., `FRONTEND_ORIGIN=http://localhost:5173,http://127.0.0.1:5173`. Restart the backend.

### Issue: `Port 5000 is already in use` (`EADDRINUSE`)
- **Cause**: Another process is occupying port 5000.
- **Solution**: Either stop the conflicting process or change `PORT=5001` in `backend/.env` and update `VITE_CHAT_SERVER_URL=http://localhost:5001` in `frontend/.env`.
