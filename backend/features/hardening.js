import mongoose from 'mongoose';
import { createRateLimiter } from '../utils/rateLimiter.js';
import { validateMessage, validateRoom } from '../utils/validation.js';

const trustProxy = process.env.TRUST_PROXY === 'true';
const SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const DEFAULT_MESSAGE_RATE_LIMIT = 10;
const DEFAULT_CONNECTION_RATE_LIMIT = 30;

function testOnlyLimit(name, defaultLimit) {
  const configured = Number(process.env[name]);
  return process.env.NODE_ENV === 'test' && Number.isInteger(configured) && configured > 0
    ? configured
    : defaultLimit;
}

const messageRateLimit = testOnlyLimit('TEST_MESSAGE_RATE_LIMIT_MAX', DEFAULT_MESSAGE_RATE_LIMIT);
const connectionRateLimit = testOnlyLimit('TEST_CONNECTION_RATE_LIMIT_MAX', DEFAULT_CONNECTION_RATE_LIMIT);

const httpLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });

const connectionLimiter = createRateLimiter({
  windowMs: 60_000,
  max: connectionRateLimit,
});

const messageLimiter = createRateLimiter({
  windowMs: 10_000,
  max: messageRateLimit,
});

const joinLimiter = createRateLimiter({ windowMs: 10_000, max: 20 });

let shuttingDown = false;

// Behind a reverse proxy (e.g. Render) set TRUST_PROXY=true so the proxy-appended
// address is used instead of the proxy's own.
function getClientIp(req) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',').pop().trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// Reports a rejected event the way the handler would: through the acknowledgement
// callback when the client sent one, otherwise as a chat_error.
function reject(socket, args, message) {
  const ack = args.find((arg) => typeof arg === 'function');
  if (ack) ack({ ok: false, error: message });
  else socket.emit('chat_error', message);
}

async function shutdown(signal, { io, pubClient, subClient }) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully`);

  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // Stops accepting connections and disconnects connected sockets.
    await new Promise((resolve) => io.close(resolve));
    await Promise.all([pubClient, subClient].map((client) => client.quit().catch(() => client.disconnect())));
    await mongoose.disconnect();
    for (const limiter of [httpLimiter, connectionLimiter, messageLimiter, joinLimiter]) limiter.stop();
    console.log('Shutdown complete');
  } catch (error) {
    console.error(`Error during shutdown: ${error.message}`);
    process.exitCode = 1;
  }
}

export function setup(context) {
  const { app, io } = context;

  // Cap the size of a single socket payload.
  io.engine.opts.maxHttpBufferSize = MAX_PAYLOAD_BYTES;

  // Request rate limit. This has to run before routes that were registered earlier, so the
  // layer is moved to the front of the stack.
  app.use((req, res, next) => {
    if (shuttingDown && req.path === '/health') return res.status(503).json({ status: 'Unavailable' });

    const { allowed, retryAfterMs } = httpLimiter.consume(getClientIp(req));
    if (allowed) return next();
    res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    res.status(429).json({ status: 'Too Many Requests' });
  });
  app.router.stack.unshift(app.router.stack.pop());

  io.use((socket, next) => {
    if (shuttingDown) return next(new Error('Server is shutting down.'));
    const { allowed } = connectionLimiter.consume(getClientIp(socket.request));
    next(allowed ? undefined : new Error('Too many connection attempts. Try again shortly.'));
  });

  process.on('SIGTERM', () => shutdown('SIGTERM', context));
  process.on('SIGINT', () => shutdown('SIGINT', context));
}

// Packet middleware runs before the event handlers, so rejected events never reach them.
export function onConnection(socket) {
  socket.use((packet, next) => {
    const [event, ...args] = packet;

    if (event === 'join_room') {
      if (!joinLimiter.consume(socket.id).allowed) {
        return reject(socket, args, 'You are joining rooms too quickly.');
      }
      const payload = args[0];
      const room = validateRoom(typeof payload === 'string' ? payload : payload?.room);
      if (!room.ok) return reject(socket, args, room.error);
    }

    if (event === 'send_message') {
      if (!messageLimiter.consume(socket.id).allowed) {
        return reject(socket, args, 'You are sending messages too quickly. Slow down.');
      }
      const message = validateMessage(args[0]);
      if (!message.ok) return reject(socket, args, message.error);
      packet[1] = message.value;
    }

    next();
  });

  socket.on('disconnect', () => {
    messageLimiter.reset(socket.id);
    joinLimiter.reset(socket.id);
  });
}
