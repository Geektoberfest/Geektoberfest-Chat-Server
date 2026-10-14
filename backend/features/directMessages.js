import mongoose from 'mongoose';
import { User } from '../models/user.js';
import { canAccessThread, cleanDmText, threadKey } from '../utils/directMessages.js';

// Direct messages live in their own collections, so the room model and message history are unchanged.
const threadSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  participants: { type: [String], required: true },
}, { timestamps: true });

const dmSchema = new mongoose.Schema({
  threadId: { type: String, required: true, index: true },
  senderId: { type: String, required: true },
  sender: { type: String, required: true },
  text: { type: String, required: true },
}, { timestamps: true });

const DirectThread = mongoose.models.DirectThread || mongoose.model('DirectThread', threadSchema);
const DirectMessage = mongoose.models.DirectMessage || mongoose.model('DirectMessage', dmSchema);

const HISTORY_LIMIT = 50;
const LIST_LIMIT = 50;

let io;
let publishEvent;

export function setup(context) {
  io = context.io;
  publishEvent = context.publishEvent;
}

// Answers through the acknowledgement callback when the client sent one, otherwise as chat_error.
function reply(socket, args, result) {
  const ack = args.find((arg) => typeof arg === 'function');
  if (ack) ack(result);
  else if (!result.ok) socket.emit('chat_error', result.error);
}

async function threadView(thread, me) {
  const otherId = thread.participants.find((id) => id !== me);
  const other = await User.findById(otherId).lean();
  return { id: String(thread._id), with: { id: otherId, username: other?.username || 'deleted user' } };
}

export function onConnection(socket) {
  const me = socket.data.userId;

  // Rejoin the rooms of existing conversations, so messages reach this socket after a reconnect.
  // Runs in the background so the handlers below are registered before any event can arrive.
  DirectThread.find({ participants: me }).lean()
    .then((threads) => threads.forEach((thread) => socket.join(`dm:${thread._id}`)))
    .catch((error) => console.error(`Could not rejoin direct messages: ${error.message}`));

  // Each handler runs inside the dispatcher, so its errors are turned into a reply.
  const handle = (event, fn) => socket.on(event, async (data, ...rest) => {
    const args = [data, ...rest];
    try {
      await fn(data, args);
    } catch (error) {
      console.error(`Direct message ${event} failed: ${error.message}`);
      reply(socket, args, { ok: false, error: 'Something went wrong.' });
    }
  });

  // Only the two people in a conversation may read or send in it.
  async function accessibleThread(threadId) {
    if (!mongoose.isValidObjectId(threadId)) return null;
    const thread = await DirectThread.findById(threadId).lean();
    return canAccessThread(thread, socket.data.userId) ? thread : null;
  }

  handle('dm_open', async (data, args) => {
    const username = typeof data?.username === 'string' ? data.username.trim().toLowerCase().slice(0, 24) : '';
    const target = username && await User.findOne({ username }).lean();
    if (!target) return reply(socket, args, { ok: false, error: 'No user with that username.' });
    if (String(target._id) === me) return reply(socket, args, { ok: false, error: 'You cannot message yourself.' });

    const thread = await DirectThread.findOneAndUpdate(
      { key: threadKey(me, target._id) },
      { $setOnInsert: { participants: [me, String(target._id)] } },
      { upsert: true, new: true },
    ).lean();
    socket.join(`dm:${thread._id}`);
    reply(socket, args, { ok: true, thread: await threadView(thread, me) });
  });

  handle('dm_list', async (_data, args) => {
    const threads = await DirectThread.find({ participants: me }).sort({ updatedAt: -1 }).limit(LIST_LIMIT).lean();
    reply(socket, args, { ok: true, threads: await Promise.all(threads.map((thread) => threadView(thread, me))) });
  });

  handle('dm_history', async (data, args) => {
    const thread = await accessibleThread(data?.threadId);
    if (!thread) return reply(socket, args, { ok: false, error: 'You cannot open this conversation.' });

    const messages = await DirectMessage.find({ threadId: String(thread._id) })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .lean();
    reply(socket, args, {
      ok: true,
      threadId: String(thread._id),
      messages: messages.reverse().map((message) => ({
        id: String(message._id),
        senderId: message.senderId,
        sender: message.sender,
        text: message.text,
        createdAt: message.createdAt,
      })),
    });
  });

  handle('dm_send', async (data, args) => {
    const thread = await accessibleThread(data?.threadId);
    if (!thread) return reply(socket, args, { ok: false, error: 'You cannot send to this conversation.' });

    const cleaned = cleanDmText(data?.text);
    if (cleaned.error) return reply(socket, args, { ok: false, error: cleaned.error });

    const threadId = String(thread._id);
    const saved = await DirectMessage.create({ threadId, senderId: me, sender: socket.data.user.username, text: cleaned.value });
    await DirectThread.updateOne({ _id: thread._id }, { $set: { updatedAt: new Date() } });

    const message = {
      id: String(saved._id),
      senderId: me,
      sender: socket.data.user.username,
      text: cleaned.value,
      createdAt: saved.createdAt,
    };
    await publishEvent('dm', { threadId, message });
    reply(socket, args, { ok: true, message });
  });
}

// Every backend instance receives the event over Redis and delivers it to its own sockets.
export function onRedisMessage(payload) {
  if (payload.type !== 'dm' || !io) return false;
  io.to(`dm:${payload.threadId}`).emit('dm_message', { threadId: payload.threadId, message: payload.message });
  return true;
}
