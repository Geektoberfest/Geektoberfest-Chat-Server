import { Room } from '../models/moderation.js';
import { User } from '../models/user.js';
import { RoomAccess } from '../models/roomAccess.js';
import { loadRoomAccess } from '../models/roomAccess.js';
import { canChangePrivacy, canJoinRoom, canManageInvites } from '../utils/privateRooms.js';

const MAX_ROOM_LENGTH = 32;
const MAX_USERNAME_LENGTH = 24;

const roomNameFrom = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_ROOM_LENGTH) : '');

// Replies through the acknowledgement callback when the client sent one, otherwise as chat_error.
function reply(socket, args, result) {
  const ack = args.find((arg) => typeof arg === 'function');
  if (ack) ack(result);
  else if (!result.ok) socket.emit('chat_error', result.error);
}

async function loadState(room) {
  const [access, roomDoc] = await Promise.all([
    loadRoomAccess(room),
    Room.findOne({ name: room }).lean(),
  ]);
  return { access, roomDoc };
}

export function onConnection(socket) {
  // Runs before the join handler, so a refused join never joins the room.
  socket.use(async (packet, next) => {
    const [event, ...args] = packet;
    if (event !== 'join_room') return next();

    const payload = args[0];
    const room = roomNameFrom(typeof payload === 'string' ? payload : payload?.room);
    if (!room) return next();

    try {
      const { access, roomDoc } = await loadState(room);
      const allowed = canJoinRoom(
        { isPrivate: access.isPrivate, invitedIds: access.invitedIds },
        socket.data.userId,
        roomDoc,
      );
      if (allowed) return next();
      reply(socket, args, { ok: false, error: 'This room is private. Ask the owner for an invite.' });
    } catch (error) {
      console.error(`Room access check failed: ${error.message}`);
      reply(socket, args, { ok: false, error: 'Could not check room access.' });
    }
  });

  socket.on('set_private', async (data, ack) => {
    const respond = (result) => (typeof ack === 'function' ? ack(result) : socket.emit('chat_notice', result.error || 'Saved.'));
    const room = roomNameFrom(data?.room);
    const roomDoc = room && await Room.findOne({ name: room }).lean();
    if (!roomDoc || !canChangePrivacy(roomDoc, socket.data.userId)) {
      return respond({ ok: false, error: 'Only the room owner can change privacy.' });
    }

    await RoomAccess.updateOne({ room }, { $set: { isPrivate: data.value === true } }, { upsert: true });
    respond({ ok: true, isPrivate: data.value === true });
  });

  socket.on('invite_user', async (data, ack) => {
    const respond = (result) => (typeof ack === 'function' ? ack(result) : socket.emit('chat_notice', result.error || 'Saved.'));
    const room = roomNameFrom(data?.room);
    const roomDoc = room && await Room.findOne({ name: room }).lean();
    if (!roomDoc || !canManageInvites(roomDoc, socket.data.userId)) {
      return respond({ ok: false, error: 'You cannot manage invites for this room.' });
    }

    const username = typeof data?.username === 'string' ? data.username.trim().toLowerCase().slice(0, MAX_USERNAME_LENGTH) : '';
    const target = username && await User.findOne({ username }).lean();
    if (!target) return respond({ ok: false, error: 'No user with that username.' });

    const change = data.value === false
      ? { $pull: { invitedIds: String(target._id) } }
      : { $addToSet: { invitedIds: String(target._id) } };
    await RoomAccess.updateOne({ room }, change, { upsert: true });
    respond({ ok: true, username, invited: data.value !== false });
  });
}
