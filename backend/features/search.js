import { requireAuth } from '../auth.js';
import { Message } from '../models/user.js';
import { checkRoomAccess } from '../models/roomAccess.js';
import { SEARCH_PAGE_SIZE, buildSearchFilter } from '../utils/search.js';

// GET /api/search?room=&q=&user=&before= finds messages in one room by keyword and/or username,
// newest first, with a createdAt cursor for older pages. It needs a logged-in user and skips
// removed messages. CORS is already handled for everything under /api.
export async function setup({ app }) {
  try {
    await Message.collection.createIndex({ room: 1, createdAt: -1 });
    await Message.collection.createIndex({ room: 1, sender: 1, createdAt: -1 });
  } catch (error) {
    console.error(`Could not create message search indexes: ${error.message}`);
  }

  app.get('/api/search', requireAuth, async (req, res) => {
    const { filter, error } = buildSearchFilter(req.query);
    if (error) return res.status(400).json({ error });

    try {
      // Private rooms and bans apply to search the same as joins/writes.
      const access = await checkRoomAccess(filter.room, req.user.id);
      if (!access.allowed) {
        return res.status(403).json({ error: access.reason === 'banned'
          ? 'You have been removed from this room.'
          : 'This room is private. Ask the owner for an invite.' });
      }

      const found = await Message.find({ ...filter, deleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .limit(SEARCH_PAGE_SIZE + 1)
        .lean();
      const hasMore = found.length > SEARCH_PAGE_SIZE;
      const messages = found.slice(0, SEARCH_PAGE_SIZE).map(({ sender, senderId, text, timestamp, createdAt }) => (
        { sender, senderId, text, timestamp, createdAt }
      ));
      res.json({ messages, hasMore });
    } catch (searchError) {
      console.error(`Message search failed: ${searchError.message}`);
      res.status(500).json({ error: 'Search failed.' });
    }
  });
}
