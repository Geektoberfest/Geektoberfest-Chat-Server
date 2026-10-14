import mongoose from 'mongoose';


const messageSchema = new mongoose.Schema({
    room: { type: String, required: true, index: true },
    sender: { type: String, required: true },
    senderId: { type: String },
    clientId: { type: String, index: { unique: true, sparse: true } },
    text: { type: String, required: true },
    reactions: [{
        emoji: { type: String, required: true },
        userIds: [{ type: String }],
    }],
    deleted: { type: Boolean, default: false },
    deletedBy: { type: String },
    timestamp: { type: Date, default: Date.now }},
    {
        timestamps: true
});

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Bumped on logout so previously issued tokens stop working.
    tokenVersion: { type: Number, default: 0 }},
    {
        timestamps: true
});

export const Message = mongoose.model('Message', messageSchema);
export const User = mongoose.model('User', userSchema);
