import mongoose from 'mongoose';
import { Message } from '../models/user.js';
import { canDeleteMessage, canEditMessage, cleanEditText } from '../utils/messageControls.js';

// When each message was last edited. The Message model is unchanged; this feature keeps its own record.
const editSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true },
  room: { type: String, required: true, index: true },
  editedAt: { type: Date, required: true },
});
const MessageEdit = mongoose.models.MessageEdit || mongoose.model('MessageEdit', editSchema);

const STATE_LIMIT = 100;
const MAX_ROOM_LENGTH = 32;

let io;
export function setup(context) {
  io = context.io;
}

// Replies through the acknowledgement callback when the client sent one, otherwise as chat_error.
function reply(socket, args, result) {
  const ack = args.find((arg) => typeof arg === 'function');
  if (ack) ack(result);
  else if (!result.ok) socket.emit('chat_error', result.error);
}

async function findMessage(room, messageId) {
  if (!mongoose.isValidObjectId(messageId)) return null;
  return Message.findOne({ _id: messageId, room }).lean();
}

export function onConnection(socket, { publishEvent }) {
  const me = () => socket.data.userId;

  const handle = (event, fn) => socket.on(event, async (data, ...rest) => {
    const args = [data, ...rest];
    try {
      await fn(data, args);
    } catch (error) {
      console.error(`Message control ${event} failed: ${error.message}`);
      reply(socket, args, { ok: false, error: 'Something went wrong.' });
    }
  });

  handle('edit_message', async (data, args) => {
    const room = typeof data?.room === 'string' ? data.room.trim().slice(0, MAX_ROOM_LENGTH) : '';
    const message = await findMessage(room, data?.messageId);
    if (!message) return reply(socket, args, { ok: false, error: 'Message not found.' });
    if (!canEditMessage(message, me())) return reply(socket, args, { ok: false, error: 'You can only edit your own messages.' });

    const cleaned = cleanEditText(data?.text);
    if (cleaned.error) return reply(socket, args, { ok: false, error: cleaned.error });

    const messageId = String(message._id);
    const editedAt = new Date();
    await Message.updateOne({ _id: message._id }, { $set: { text: cleaned.value } });
    await MessageEdit.updateOne({ messageId }, { $set: { room, editedAt } }, { upsert: true });
    await publishEvent('message_edited', { room, messageId, text: cleaned.value, editedAt });
    reply(socket, args, { ok: true, editedAt });
  });

  handle('delete_own_message', async (data, args) => {
    const room = typeof data?.room === 'string' ? data.room.trim().slice(0, MAX_ROOM_LENGTH) : '';
    const message = await findMessage(room, data?.messageId);
    if (!message) return reply(socket, args, { ok: false, error: 'Message not found.' });
    if (!canDeleteMessage(message, me())) return reply(socket, args, { ok: false, error: 'You can only delete your own messages.' });

    const messageId = String(message._id);
    await Message.updateOne({ _id: message._id }, { $set: { deleted: true, deletedBy: me() } });
    // The existing message_deleted event tells every client in the room, as for moderator deletes.
    await publishEvent('message_deleted', { room, messageId });
    reply(socket, args, { ok: true });
  });

  // Edited and deleted messages in a room, so a client can show them after loading history.
  handle('message_states', async (data, args) => {
    const room = typeof data?.room === 'string' ? data.room.trim().slice(0, MAX_ROOM_LENGTH) : '';
    const edits = await MessageEdit.find({ room }).sort({ editedAt: -1 }).limit(STATE_LIMIT).lean();
    const deleted = await Message.find({ room, deleted: true }).sort({ _id: -1 }).limit(STATE_LIMIT).lean();

    const states = {};
    for (const edit of edits) {
      states[edit.messageId] = { edited: true, editedAt: edit.editedAt };
    }
    const editedIds = edits.map((edit) => edit.messageId);
    const edited = editedIds.length ? await Message.find({ _id: { $in: editedIds } }).lean() : [];
    for (const message of edited) {
      states[String(message._id)] = { ...states[String(message._id)], text: message.text, deleted: Boolean(message.deleted) };
    }
    for (const message of deleted) {
      states[String(message._id)] = { ...states[String(message._id)], text: '', deleted: true };
    }
    reply(socket, args, { ok: true, room, states });
  });
}

// Live delivery of edits, to everyone in the room across backend instances.
export function onRedisMessage(payload) {
  if (payload.type !== 'message_edited' || !io) return false;
  io.to(payload.room).emit('message_updated', {
    messageId: payload.messageId,
    text: payload.text,
    editedAt: payload.editedAt,
  });
  return true;
}
