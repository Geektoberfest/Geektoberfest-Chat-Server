import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import http from 'node:http';
import { readdir } from 'node:fs/promises';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { Message } from './models/user.js';
import { Report, Room } from './models/moderation.js';
import { canManageModerators, canModerate, getRole, isStaff } from './utils/permissions.js';
import { authRouter, authenticateSocket, getJwtSecret } from './auth.js';

const REDIS_CHAT_CHANNEL = 'CHAT_ROOMS';
const activeRoomUsers = new Map();
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const redisOptions = {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => (attempt <= 3 ? 500 : null),
};
const pubClient = new Redis(redisUrl, redisOptions);
const subClient = new Redis(redisUrl, redisOptions);

for (const [name, client] of [['publisher', pubClient], ['subscriber', subClient]]) {
  client.on('error', (error) => console.error(`Redis ${name} error: ${error.message}`));
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});
app.set('io', io);
app.use('/api', cors({ origin: allowedOrigins }));
app.use('/api/auth', authRouter);
io.use(authenticateSocket);

// An error whose message is safe to show to the user.
class UserError extends Error {}

function cleanRoomName(value) {
  if (typeof value !== 'string' || !value.trim()) throw new UserError('Enter a room name first.');
  return value.trim().slice(0, 32);
}

// User IDs are account IDs, so they are Mongo ObjectIds.
function cleanUserId(value) {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) throw new UserError('Invalid user.');
  return value;
}

function cleanMessageId(value) {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) throw new UserError('Invalid message.');
  return value;
}

function roomState(room) {
  return { room: room.name, ownerId: room.ownerId, moderators: room.moderators, mutedIds: room.mutedIds };
}

function publishEvent(type, payload) {
  return pubClient.publish(REDIS_CHAT_CHANNEL, JSON.stringify({ type, ...payload }));
}

function publishRoomState(room) {
  return publishEvent('room_state', { room: room.name, state: roomState(room) });
}

async function ensureRoom(name, ownerId) {
  const existing = await Room.findOne({ name });
  if (existing || !ownerId) return existing;

  try {
    return await Room.create({ name, ownerId });
  } catch (error) {
    if (error.code === 11000) return Room.findOne({ name });
    throw error;
  }
}

async function removeUserFromRoom(room, userId) {
  const sockets = await io.in(room).fetchSockets();
  for (const remote of sockets) {
    if (remote.data.userId !== userId) continue;
    remote.emit('removed_from_room', { room });
    remote.leave(room);
  }
}

// Feature modules in ./features/*.js extend the server without editing this file. They may export:
//   setup(context)                once at startup, after the database is connected
//   onConnection(socket, context) for every new, authenticated socket
//   onRedisMessage(payload)       for every event on the chat channel; return true if handled
const features = [];
const featureContext = { app, io, pubClient, subClient, allowedOrigins, publishEvent };

async function loadFeatures() {
  const directory = new URL('./features/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.js')).sort();
  for (const file of files) features.push(await import(new URL(file, directory)));
  for (const feature of features) await feature.setup?.(featureContext);
}

subClient.on('message', async (channel, message) => {
  if (channel !== REDIS_CHAT_CHANNEL) return;

  try {
    const payload = JSON.parse(message);
    if (features.some((feature) => feature.onRedisMessage?.(payload))) return;

    switch (payload.type) {
      case 'room_state':
        io.to(payload.room).emit('room_state', payload.state);
        break;
      case 'message_deleted':
        io.to(payload.room).emit('message_deleted', { messageId: payload.messageId });
        break;
      case 'message_reactions':
        io.to(payload.room).emit('message_reactions', {
          messageId: payload.messageId,
          reactions: payload.reactions,
        });
        break;
      case 'reports_changed':
        io.to(payload.room).emit('reports_changed');
        break;
      case 'user_removed':
        await removeUserFromRoom(payload.room, payload.userId);
        break;
      default: {
        const { id, room, sender, senderId, text, clientId, timestamp } = payload;
        if (room && typeof sender === 'string' && typeof text === 'string') {
          io.to(room).emit('receive_message', { id, sender, senderId, text, clientId, timestamp });
        }
      }
    }
  } catch (error) {
    console.error(`Invalid Redis chat payload: ${error.message}`);
  }
});


async function broadcastRoomPresence(roomName, excludedSocketId = null) {
  const sockets = await io.in(roomName).fetchSockets();
  const users = new Map();

  for (const member of sockets) {
    if (member.id === excludedSocketId) continue;

    const user = member.data.user;
    if (!user?.id || !user?.username) continue;

    users.set(user.id, {
      id: user.id,
      username: user.username,
    });
  }

  io.to(roomName).emit('room_presence', {
    room: roomName,
    users: [...users.values()],
  });
}

io.on('connection', (socket) => {
  const { id: senderId, username: sender } = socket.data.user;
  console.log(`User connected: ${sender} (${socket.id})`);
  // Moderation and message ownership both key off the authenticated account.
  socket.data.userId = senderId;
  // Lets logout disconnect every socket belonging to this user.
  socket.join(`user:${senderId}`);

  // Runs a socket event handler, turning failures into a chat_error for the sender.
  const handle = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof UserError) {
        socket.emit('chat_error', error.message);
      } else {
        console.error(`Socket handler failed: ${error.message}`);
        socket.emit('chat_error', 'Something went wrong.');
      }
    }
  };

  async function loadModerationContext(roomName) {
    const actorId = socket.data.userId;
    const room = await Room.findOne({ name: cleanRoomName(roomName) });
    if (!room) throw new UserError('Room not found.');
    return { actorId, room };
  }

  function requireStaff(room, actorId) {
    if (!isStaff(room, actorId)) throw new UserError('You do not have permission to do that.');
  }

  socket.on('join_room', handle(async (payload) => {
    const room = cleanRoomName(typeof payload === 'string' ? payload : payload?.room);
    const roomDoc = await ensureRoom(room, senderId);
    if (roomDoc?.bannedIds.includes(senderId)) {
      throw new UserError('You have been removed from this room.');
    }

    socket.join(room);
    socket.emit('identity', { userId: senderId });

    await broadcastRoomPresence(room);

    if (roomDoc) socket.emit('room_state', roomState(roomDoc));

    try {
      const chatHistory = await Message.find({ room }).sort({ createdAt: 1 }).limit(20).lean();
      socket.emit('chat_history', chatHistory.map((message) => ({
        id: String(message._id),
        sender: message.sender,
        senderId: message.senderId,
        text: message.deleted ? '' : message.text,
        deleted: Boolean(message.deleted),
        timestamp: message.timestamp,
        createdAt: message.createdAt,

        reactions: (message.reactions || []).map((reaction) => ({
          emoji: reaction.emoji,
          userIds: reaction.userIds || [],
        })),

      })));
    } catch (error) {
      console.error(`Failed to fetch chat history: ${error.message}`);
      socket.emit('chat_error', 'Could not load chat history.');
    }
  }));

  // The sender always comes from the authenticated socket, never from the payload.
  socket.on('send_message', handle(async (data, ack) => {
    // Clients without an ack callback (the CLI client) still get chat_error.
    const respond = typeof ack === 'function'
      ? ack
      : (result) => { if (!result.ok) socket.emit('chat_error', result.error); };

    const room = typeof data?.room === 'string' ? data.room.trim().slice(0, 32) : '';
    const text = typeof data?.text === 'string' ? data.text.trim().slice(0, 1000) : '';
    const clientId = typeof data?.clientId === 'string' ? data.clientId.slice(0, 64) : '';
    if (!room || !text) {
      respond({ ok: false, error: 'Message needs a room and some text.' });
      return;
    }

    const roomDoc = await Room.findOne({ name: room }).lean();
    if (roomDoc?.bannedIds.includes(senderId)) {
      respond({ ok: false, error: 'You have been removed from this room.' });
      return;
    }
    if (roomDoc?.mutedIds.includes(senderId)) {
      respond({ ok: false, error: 'You are muted in this room.' });
      return;
    }

    try {
      const newMessage = await Message.create({ room, sender, senderId, text, clientId: clientId || undefined });
      await publishEvent('message', {
        id: String(newMessage._id),
        room,
        sender,
        senderId,
        text,
        clientId,
        timestamp: newMessage.timestamp,
      });
      respond({ ok: true, clientId, timestamp: newMessage.timestamp });
    } catch (error) {
      if (error?.code === 11000) {
        // Stored by an earlier attempt whose acknowledgement never arrived;
        // it was broadcast then, so do not publish it a second time.
        respond({ ok: true, clientId, duplicate: true });
        return;
      }

      console.error(`Failed to save or broadcast message: ${error.message}`);
      respond({ ok: false, error: 'Could not send your message.' });
    }
  }));


  socket.on('toggle_reaction', handle(async (data) => {
    const room = cleanRoomName(data?.room);
    const messageId = cleanMessageId(data?.messageId);
    const emoji = data?.emoji;

    const allowedEmojis = ['ðŸ‘', 'â¤ï¸', 'ðŸ˜‚', 'ðŸ˜®', 'ðŸ˜¢', 'ðŸŽ‰'];

    if (!allowedEmojis.includes(emoji)) {
      throw new UserError('Invalid reaction.');
    }

    const message = await Message.findById(messageId);
    if (!message || message.room !== room || message.deleted) {
      throw new UserError('Message not found.');
    }

    if (!Array.isArray(message.reactions)) {
      message.reactions = [];
    }

    let reaction = message.reactions.find((item) => item.emoji === emoji);

    if (!reaction) {
      message.reactions.push({ emoji, userIds: [senderId] });
    } else {
      const userIndex = reaction.userIds.indexOf(senderId);

      if (userIndex >= 0) {
        reaction.userIds.splice(userIndex, 1);
      } else {
        reaction.userIds.push(senderId);
      }

      if (reaction.userIds.length === 0) {
        message.reactions = message.reactions.filter(
          (item) => item.emoji !== emoji,
        );
      }
    }

    await message.save();

    await publishEvent('message_reactions', {
      room,
      messageId: String(message._id),
      reactions: message.reactions.map((item) => ({
        emoji: item.emoji,
        userIds: item.userIds,
      })),
    });
  }));


  const setMuted = (muted) => handle(async (data) => {
    const { actorId, room } = await loadModerationContext(data?.room);
    const targetId = cleanUserId(data?.targetId);
    if (!canModerate(room, actorId, targetId)) throw new UserError('You do not have permission to do that.');

    const updated = await Room.findByIdAndUpdate(
      room._id,
      muted ? { $addToSet: { mutedIds: targetId } } : { $pull: { mutedIds: targetId } },
      { new: true },
    );
    await publishRoomState(updated);
  });
  socket.on('mute_user', setMuted(true));
  socket.on('unmute_user', setMuted(false));

  socket.on('remove_user', handle(async (data) => {
    const { actorId, room } = await loadModerationContext(data?.room);
    const targetId = cleanUserId(data?.targetId);
    if (!canModerate(room, actorId, targetId)) throw new UserError('You do not have permission to do that.');

    const updated = await Room.findByIdAndUpdate(
      room._id,
      { $addToSet: { bannedIds: targetId }, $pull: { moderators: targetId } },
      { new: true },
    );
    await publishRoomState(updated);
    await publishEvent('user_removed', { room: updated.name, userId: targetId });
  }));

  socket.on('set_moderator', handle(async (data) => {
    const { actorId, room } = await loadModerationContext(data?.room);
    const targetId = cleanUserId(data?.targetId);
    if (!canManageModerators(room, actorId)) throw new UserError('Only the room owner can manage moderators.');
    if (getRole(room, targetId) === 'owner') throw new UserError('The owner is already in charge.');

    const updated = await Room.findByIdAndUpdate(
      room._id,
      data?.value === true ? { $addToSet: { moderators: targetId } } : { $pull: { moderators: targetId } },
      { new: true },
    );
    await publishRoomState(updated);
  }));

  socket.on('delete_message', handle(async (data) => {
    const { actorId, room } = await loadModerationContext(data?.room);
    const message = await Message.findById(cleanMessageId(data?.messageId));
    if (!message || message.room !== room.name) throw new UserError('Message not found.');
    if (message.deleted) return;
    if (!canModerate(room, actorId, message.senderId || '')) {
      throw new UserError('You do not have permission to do that.');
    }

    message.deleted = true;
    message.deletedBy = actorId;
    await message.save();
    await publishEvent('message_deleted', { room: room.name, messageId: String(message._id) });
  }));

  socket.on('report_message', handle(async (data) => {
    const { actorId, room } = await loadModerationContext(data?.room);
    const message = await Message.findById(cleanMessageId(data?.messageId));
    if (!message || message.room !== room.name || message.deleted) throw new UserError('Message not found.');
    if (message.senderId === actorId) throw new UserError('You cannot report your own message.');

    const reason = typeof data?.reason === 'string' ? data.reason.trim().slice(0, 200) : '';
    const result = await Report.updateOne(
      { messageId: String(message._id), reporterId: actorId },
      {
        $setOnInsert: {
          room: room.name,
          reportedId: message.senderId || '',
          text: message.text,
          reason,
        },
      },
      { upsert: true },
    );
    if (!result.upsertedCount) throw new UserError('You already reported this message.');

    socket.emit('chat_notice', 'Report sent to the room moderators.');
    await publishEvent('reports_changed', { room: room.name });
  }));

  socket.on('list_reports', handle(async (data) => {
    const { actorId, room } = await loadModerationContext(data?.room);
    requireStaff(room, actorId);

    const reports = await Report.find({ room: room.name }).sort({ createdAt: -1 }).limit(50).lean();
    socket.emit('reports', reports.map((report) => ({
      id: String(report._id),
      messageId: report.messageId,
      reportedId: report.reportedId,
      text: report.text,
      reason: report.reason,
      createdAt: report.createdAt,
    })));
  }));

  socket.on('dismiss_report', handle(async (data) => {
    const { actorId, room } = await loadModerationContext(data?.room);
    requireStaff(room, actorId);
    if (typeof data?.reportId !== 'string' || !mongoose.isValidObjectId(data.reportId)) {
      throw new UserError('Invalid report.');
    }

    await Report.deleteOne({ _id: data.reportId, room: room.name });
    await publishEvent('reports_changed', { room: room.name });
  }));

  
  features.forEach((feature) => feature.onConnection?.(socket, featureContext));

  socket.on('disconnecting', async () => {
    const rooms = [...socket.rooms].filter(
      (room) => room !== socket.id && room !== `user:${senderId}`,
    );

    for (const room of rooms) {
      try {
        await broadcastRoomPresence(room, socket.id);
      } catch (error) {
        console.error(`Failed to update room presence: ${error.message}`);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${sender} (${socket.id})`);
  });
}); // Closes io.on('connection')

app.get('/health', (_req, res) => {
  const healthy = mongoose.connection.readyState === 1
    && pubClient.status === 'ready'
    && subClient.status === 'ready';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'OK' : 'Unavailable',
  });
});

async function start() {
  try {
    getJwtSecret();
    await connectDB();
    await loadFeatures();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    await subClient.subscribe(REDIS_CHAT_CHANNEL);

    const port = Number(process.env.PORT || 5000);
    server.listen(port, '0.0.0.0', () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error(`Backend startup failed: ${error.message}`);
    pubClient.disconnect();
    subClient.disconnect();
    await mongoose.disconnect();
    process.exitCode = 1;
  }
}

start();
