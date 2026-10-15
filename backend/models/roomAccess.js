import mongoose from 'mongoose';
import { Room } from './moderation.js';
import { canJoinRoom } from '../utils/privateRooms.js';

// Privacy and invites live in their own collection, so the Room model and the rest of the server
// are left untouched.
const accessSchema = new mongoose.Schema(
  {
    room: { type: String, required: true, unique: true },
    isPrivate: { type: Boolean, default: false },
    invitedIds: { type: [String], default: [] },
  },
  {
    timestamps: true,
  },
);

export const RoomAccess =
  mongoose.models.RoomAccess || mongoose.model('RoomAccess', accessSchema);

export async function loadRoomAccess(room) {
  const access = room && (await RoomAccess.findOne({ room }).lean());
  return access || { isPrivate: false, invitedIds: [] };
}

// Single place to decide if a user may join/read/write a room.
// Returns { allowed, roomDoc, access }. Banned users are never allowed,
// even with an invite.
export async function checkRoomAccess(roomName, userId) {
  if (!roomName) return { allowed: true, roomDoc: null, access: { isPrivate: false, invitedIds: [] } };
  const [access, roomDoc] = await Promise.all([
    RoomAccess.findOne({ room: roomName }).lean(),
    Room.findOne({ name: roomName }).lean(),
  ]);
  const state = access || { isPrivate: false, invitedIds: [] };
  if (roomDoc?.bannedIds?.includes(userId)) {
    return { allowed: false, roomDoc, access: state, reason: 'banned' };
  }
  const allowed = canJoinRoom(
    { isPrivate: state.isPrivate, invitedIds: state.invitedIds },
    userId,
    roomDoc,
  );
  return { allowed, roomDoc, access: state, reason: allowed ? '' : 'private' };
}
