const { register, joinRoom, uniqueName, pause } = require('./helpers/client.cjs');

const newRoom = () => uniqueName('room');
const say = async (client, room, text, clientId) => {
  const ack = await client.emitWithAck('send_message', { room, text, clientId });
  if (ack?.timedOut) throw new Error(`Timed out sending message ${clientId || '(without a client ID)'}.`);
  if (!ack?.ok) throw new Error(`Message was rejected: ${ack?.error || 'unknown error'}`);
  return ack;
};

describe('messaging', () => {
  test('a message is acknowledged, broadcast to the room and stored with the account as sender', async () => {
    const [alice, bob] = [await register('al'), await register('bo')];
    const room = newRoom();
    const [a, b] = [await joinRoom(alice, room), await joinRoom(bob, room)];

    const ack = await say(a, room, 'hello there', 'c-1');
    expect(ack.ok).toBe(true);

    const received = await b.waitFor('receive_message');
    expect(received).toMatchObject({ sender: alice.username, senderId: alice.id, text: 'hello there', clientId: 'c-1' });
    a.close(); b.close();
  });

  test('the sender cannot be spoofed from the payload', async () => {
    const [alice, bob] = [await register('al'), await register('bo')];
    const room = newRoom();
    const [a, b] = [await joinRoom(alice, room), await joinRoom(bob, room)];

    await a.emitWithAck('send_message', { room, text: 'spoof', sender: 'someone', senderId: bob.id });
    const received = await b.waitFor('receive_message');
    expect(received.sender).toBe(alice.username);
    expect(received.senderId).toBe(alice.id);
    a.close(); b.close();
  });

  test('resending the same clientId is acknowledged but stored and broadcast once', async () => {
    const [alice, bob] = [await register('al'), await register('bo')];
    const room = newRoom();
    const [a, b] = [await joinRoom(alice, room), await joinRoom(bob, room)];

    expect((await say(a, room, 'once', 'dup-1')).ok).toBe(true);
    expect((await say(a, room, 'once', 'dup-1')).duplicate).toBe(true);
    await pause(300);
    expect(b.of('receive_message')).toHaveLength(1);

    const late = await joinRoom(await register('la'), room);
    expect(late.last('chat_history')).toHaveLength(1);
    a.close(); b.close(); late.close();
  });

  test('messages stay inside their room', async () => {
    const [alice, bob] = [await register('al'), await register('bo')];
    const roomA = newRoom();
    const [a, b] = [await joinRoom(alice, roomA), await joinRoom(bob, newRoom())];

    await say(a, roomA, 'only for room A', 'iso-1');
    await pause(300);
    expect(b.of('receive_message')).toHaveLength(0);
    a.close(); b.close();
  });

  test('history returns the stored messages, oldest first', async () => {
    const [alice, bob] = [await register('al'), await register('bo')];
    const room = newRoom();
    const a = await joinRoom(alice, room);
    for (const text of ['one', 'two', 'three']) await say(a, room, text, `h-${text}`);

    const b = await joinRoom(bob, room);
    expect(b.last('chat_history').map((message) => message.text)).toEqual(['one', 'two', 'three']);
    a.close(); b.close();
  });

  test('a message with no text is rejected through the acknowledgement', async () => {
    const a = await joinRoom(await register('al'), newRoom());
    const ack = await a.emitWithAck('send_message', { room: 'r', text: '   ' });
    expect(ack.ok).toBe(false);
    a.close();
  });
});

describe('moderation', () => {
  async function setup() {
    const [owner, member, other] = [await register('own'), await register('mem'), await register('oth')];
    const room = newRoom();
    const o = await joinRoom(owner, room); // the first user to join becomes the owner
    const m = await joinRoom(member, room);
    const t = await joinRoom(other, room);
    return { owner, member, other, room, o, m, t };
  }

  test('the first user in a room is the owner', async () => {
    const { owner, room, o, m } = await setup();
    expect((await m.waitFor('room_state')).ownerId).toBe(owner.id);
    expect(room).toBeTruthy();
    [o, m].forEach((client) => client.close());
  });

  test('a plain member cannot delete, mute or list reports', async () => {
    const { member, other, room, o, m, t } = await setup();
    await say(t, room, 'a message', 'm-1');
    const message = await m.waitFor('receive_message');

    m.socket.emit('delete_message', { room, messageId: message.id });
    m.socket.emit('mute_user', { room, targetId: other.id });
    m.socket.emit('list_reports', { room });
    await pause(400);
    expect(m.of('chat_error').length).toBe(3);
    expect(member.id).toBeTruthy();
    [o, m, t].forEach((client) => client.close());
  });

  test('the owner mutes and unmutes a member, and a muted member cannot send', async () => {
    const { member, room, o, m, t } = await setup();
    o.socket.emit('mute_user', { room, targetId: member.id });
    await m.waitFor('room_state', (state) => state.mutedIds.includes(member.id));

    const blocked = await m.emitWithAck('send_message', { room, text: 'muted talk', clientId: 'mu-1' });
    expect(blocked).toMatchObject({ ok: false, error: 'You are muted in this room.' });

    m.events.length = 0; // only a state sent after the unmute counts
    o.socket.emit('unmute_user', { room, targetId: member.id });
    await m.waitFor('room_state', (state) => !state.mutedIds.includes(member.id));
    expect((await say(m, room, 'back again', 'mu-2')).ok).toBe(true);
    [o, m, t].forEach((client) => client.close());
  });

  test('the owner deletes a message, everyone is told and history hides the text', async () => {
    const { room, o, m, t } = await setup();
    await say(m, room, 'secret words', 'del-1');
    const message = await o.waitFor('receive_message');

    o.socket.emit('delete_message', { room, messageId: message.id });
    expect((await t.waitFor('message_deleted')).messageId).toBe(message.id);

    const late = await joinRoom(await register('la'), room);
    const stored = late.last('chat_history').find((item) => item.id === message.id);
    expect(stored).toMatchObject({ deleted: true, text: '' });
    [o, m, t, late].forEach((client) => client.close());
  });

  test('a moderator can act on members but not on the owner or other moderators', async () => {
    const { owner, member, other, room, o, m, t } = await setup();
    o.socket.emit('set_moderator', { room, targetId: member.id, value: true });
    await m.waitFor('room_state', (state) => state.moderators.includes(member.id));

    m.socket.emit('mute_user', { room, targetId: owner.id });
    await m.waitFor('chat_error');
    m.socket.emit('mute_user', { room, targetId: other.id });
    await t.waitFor('room_state', (state) => state.mutedIds.includes(other.id));
    [o, m, t].forEach((client) => client.close());
  });

  test('removing a user kicks them and blocks them from rejoining', async () => {
    const { other, room, o, t } = await setup();
    o.socket.emit('remove_user', { room, targetId: other.id });
    await t.waitFor('removed_from_room');

    const again = await joinRoom(other, room).catch((error) => error);
    expect(again).toBeInstanceOf(Error);
    [o, t].forEach((client) => client.close());
  });

  test('a report reaches the owner, can only be filed once per user, and cannot target your own message', async () => {
    const { owner, member, room, o, m, t } = await setup();
    await say(t, room, 'rude message', 'rep-1');
    const message = await m.waitFor('receive_message');

    m.socket.emit('report_message', { room, messageId: message.id, reason: 'rude' });
    await m.waitFor('chat_notice');
    m.socket.emit('report_message', { room, messageId: message.id });
    await m.waitFor('chat_error', (error) => /already/.test(error));

    t.socket.emit('report_message', { room, messageId: message.id });
    await t.waitFor('chat_error', (error) => /own message/.test(error));

    o.socket.emit('list_reports', { room });
    const reports = await o.waitFor('reports');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ reason: 'rude', text: 'rude message' });
    expect([owner.id, member.id]).toHaveLength(2);
    [o, m, t].forEach((client) => client.close());
  });
});

describe('pagination', () => {
  const loadOlder = (client, room, before) =>
    client.emitWithAck('load_older_messages', { room, before });

  test('initial history returns the newest 20 messages in chronological order', async () => {
    const alice = await register('al');
    const room = newRoom();
    const a = await joinRoom(alice, room);

    // Send 25 messages: m-01 … m-25
    for (let i = 1; i <= 25; i++) {
      await say(a, room, `msg-${String(i).padStart(2, '0')}`, `pg-init-${i}`);
    }

    const b = await joinRoom(await register('bo'), room);
    const history = b.last('chat_history');

    // Should receive the newest 20 (msg-06 … msg-25) in chronological order.
    expect(history).toHaveLength(20);
    expect(history[0].text).toBe('msg-06');
    expect(history[19].text).toBe('msg-25');
    // Verify strict chronological order.
    for (let i = 0; i < history.length - 1; i++) {
      const t1 = new Date(history[i].createdAt).getTime();
      const t2 = new Date(history[i + 1].createdAt).getTime();
      expect(t1).toBeLessThanOrEqual(t2);
    }
    a.close(); b.close();
  });

  test('load_older_messages returns previous page and indicates whether more exist', async () => {
    const alice = await register('al');
    const room = newRoom();
    const a = await joinRoom(alice, room);

    for (let i = 1; i <= 25; i++) {
      await say(a, room, `msg-${String(i).padStart(2, '0')}`, `pg-batch-${i}`);
    }

    const b = await joinRoom(await register('bo'), room);
    const history = b.last('chat_history'); // msg-06 … msg-25, hasMore expected
    expect(history).toHaveLength(20);

    // First page backward: should return msg-01 … msg-05
    const page1 = await loadOlder(b, room, history[0].id);
    expect(page1.messages).toHaveLength(5);
    expect(page1.messages[0].text).toBe('msg-01');
    expect(page1.messages[4].text).toBe('msg-05');
    expect(page1.hasMore).toBe(false); // history exhausted

    a.close(); b.close();
  });

  test('load_older_messages reports no more history when exactly 20 older messages remain', async () => {
    const alice = await register('al');
    const room = newRoom();
    const a = await joinRoom(alice, room);

    for (let i = 1; i <= 40; i++) {
      await say(a, room, `msg-${String(i).padStart(2, '0')}`, `pg-exact-${i}`);
    }

    const b = await joinRoom(await register('bo'), room);
    const history = b.last('chat_history');
    const older = await loadOlder(b, room, history[0].id);

    expect(older.messages).toHaveLength(20);
    expect(older.messages[0].text).toBe('msg-01');
    expect(older.messages[19].text).toBe('msg-20');
    expect(older.hasMore).toBe(false);
    a.close(); b.close();
  });

  test('loading older messages in multiple batches yields no duplicates and no missing messages', async () => {
    const alice = await register('al');
    const room = newRoom();
    const a = await joinRoom(alice, room);

    // Send 45 messages so we need 3 pages (page1=newest20, page2=next20, page3=remaining5).
    for (let i = 1; i <= 45; i++) {
      await say(a, room, `msg-${String(i).padStart(2, '0')}`, `pg-multi-${i}`);
    }

    const b = await joinRoom(await register('bo'), room);
    const page1 = b.last('chat_history'); // msg-26 … msg-45
    expect(page1).toHaveLength(20);
    expect(page1[0].text).toBe('msg-26');

    const page2Response = await loadOlder(b, room, page1[0].id); // msgs before msg-26
    expect(page2Response.messages).toHaveLength(20);
    expect(page2Response.messages[0].text).toBe('msg-06');
    expect(page2Response.messages[19].text).toBe('msg-25');
    expect(page2Response.hasMore).toBe(true);

    const page3Response = await loadOlder(b, room, page2Response.messages[0].id); // msgs before msg-06
    expect(page3Response.messages).toHaveLength(5);
    expect(page3Response.messages[0].text).toBe('msg-01');
    expect(page3Response.messages[4].text).toBe('msg-05');
    expect(page3Response.hasMore).toBe(false);

    // Collect all IDs and verify no duplicates.
    const allIds = [
      ...page3Response.messages,
      ...page2Response.messages,
      ...page1,
    ].map((m) => m.id);
    expect(new Set(allIds).size).toBe(45);

    a.close(); b.close();
  });

  test('load_older_messages returns { hasMore: false } when history is exhausted', async () => {
    const alice = await register('al');
    const room = newRoom();
    const a = await joinRoom(alice, room);
    for (let i = 1; i <= 5; i++) await say(a, room, `m${i}`, `pg-ex-${i}`);

    const b = await joinRoom(await register('bo'), room);
    const history = b.last('chat_history');
    expect(history.length).toBe(5); // fewer than 20

    // Oldest message is history[0]; there's nothing older.
    const result = await loadOlder(b, room, history[0].id);
    expect(result.messages).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    a.close(); b.close();
  });

  test('load_older_messages rejects an invalid cursor', async () => {
    const a = await joinRoom(await register('al'), newRoom());
    const result = await loadOlder(a, 'any-room', 'not-a-valid-object-id');
    expect(result.error).toMatch(/[Ii]nvalid/);
    a.close();
  });

  test('load_older_messages rejects a cursor from another room', async () => {
    const alice = await register('al');
    const room = newRoom();
    const otherRoom = newRoom();
    const a = await joinRoom(alice, room);
    const other = await joinRoom(await register('bo'), otherRoom);
    await say(other, otherRoom, 'other room message', 'pg-other-room');
    const otherCursor = (await other.waitFor('receive_message')).id;

    const result = await loadOlder(a, room, otherCursor);
    expect(result.error).toMatch(/[Ii]nvalid/);
    a.close(); other.close();
  });

  test('load_older_messages requires the requesting socket to have joined the room', async () => {
    const room = newRoom();
    const owner = await joinRoom(await register('ow'), room);
    const outsider = await joinRoom(await register('ou'), newRoom());
    await say(owner, room, 'room message', 'pg-membership');
    const cursor = (await owner.waitFor('receive_message')).id;

    const result = await loadOlder(outsider, room, cursor);
    expect(result.error).toMatch(/Join the room/);
    owner.close(); outsider.close();
  });

  test('load_older_messages rejects a removed user', async () => {
    const [ownerUser, memberUser] = [await register('ow'), await register('mb')];
    const room = newRoom();
    const owner = await joinRoom(ownerUser, room);
    const member = await joinRoom(memberUser, room);
    await say(owner, room, 'room message', 'pg-banned');
    const cursor = (await owner.waitFor('receive_message')).id;

    owner.socket.emit('remove_user', { room, targetId: memberUser.id });
    await member.waitFor('removed_from_room');

    const result = await loadOlder(member, room, cursor);
    expect(result.error).toMatch(/removed from this room/);
    owner.close(); member.close();
  });

  test('load_older_messages rejects a missing room name', async () => {
    const a = await joinRoom(await register('al'), newRoom());
    const result = await a.emitWithAck('load_older_messages', { before: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(result.error).toBeDefined();
    a.close();
  });

  test('deleted messages appear as placeholders in pagination results', async () => {
    const [owner, member] = [await register('ow'), await register('mb')];
    const room = newRoom();
    const o = await joinRoom(owner, room);
    const m = await joinRoom(member, room);

    // Send 21 messages so there will be one member-authored message in the older page.
    await say(m, room, 'msg-1', 'pg-del-1');
    for (let i = 2; i <= 20; i++) await say(o, room, `msg-${i}`, `pg-del-${i}`);
    await say(o, room, 'visible', 'pg-del-21');

    // We need the ID of msg-1 via chat_history. Join a fresh client.
    const fresh = await joinRoom(await register('fr'), room);
    // The newest 20 are msg-02 … msg-21. The pagination cursor is fresh.last('chat_history')[0].
    const latestHistory = fresh.last('chat_history');
    const firstInHistory = latestHistory[0]; // oldest message in the window

    // Load older to get the real first messages.
    const older = await loadOlder(fresh, room, firstInHistory.id);
    expect(older.messages.length).toBeGreaterThan(0);

    // Delete the oldest message we can find.
    const target = older.messages[0];
    expect(target.senderId).toBe(member.id);
    o.socket.emit('delete_message', { room, messageId: target.id });
    await o.waitFor('message_deleted', (payload) => payload.messageId === target.id);

    // Reload older messages; the deleted entry must appear as a placeholder.
    const older2 = await loadOlder(fresh, room, firstInHistory.id);
    const deleted = older2.messages.find((msg) => msg.id === target.id);
    expect(deleted).toMatchObject({ deleted: true, text: '' });
    [o, m, fresh].forEach((c) => c.close());
  });
});
