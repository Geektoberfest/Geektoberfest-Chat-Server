import './roomNavigation.css';

const RECENT_KEY = 'gather-recent-rooms';
const FAVORITES_KEY = 'gather-favorite-rooms';
const MAX_RECENT = 8;
const MAX_FAVORITES = 20;

// Reads a saved list of room names, dropping anything that isn't a valid name.
function readList(key, limit) {
  try {
    const list = JSON.parse(localStorage.getItem(key));
    if (!Array.isArray(list)) return [];
    return list.filter((name) => typeof name === 'string' && name.trim()).slice(0, limit);
  } catch {
    return [];
  }
}

function writeList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage can be full or disabled; the list simply won't be remembered.
  }
}

// A "Recent rooms" and "Favourites" list in the sidebar. Clicking a room joins it, and the rooms you
// visit are remembered in this browser.
export default function initRoomNavigation({ socket, elements, getRoom }) {
  const { roomInput } = elements;
  const rail = document.querySelector('.room-rail');

  const section = document.createElement('section');
  section.className = 'room-nav';
  section.setAttribute('aria-label', 'Rooms');
  section.innerHTML = `
    <div class="rail-heading">FAVOURITES</div>
    <ul class="room-nav-list room-nav-favorites" aria-label="Favourite rooms"></ul>
    <div class="rail-heading">RECENT ROOMS</div>
    <ul class="room-nav-list room-nav-recent" aria-label="Recent rooms"></ul>
  `;
  rail.querySelector('.room-hint').after(section);

  const favoritesEl = section.querySelector('.room-nav-favorites');
  const recentEl = section.querySelector('.room-nav-recent');
  let recent = readList(RECENT_KEY, MAX_RECENT);
  let favorites = readList(FAVORITES_KEY, MAX_FAVORITES);

  function join(room) {
    roomInput.value = room;
    document.querySelector('#join-button').click();
  }

  function toggleFavorite(room) {
    favorites = favorites.includes(room)
      ? favorites.filter((item) => item !== room)
      : [room, ...favorites].slice(0, MAX_FAVORITES);
    writeList(FAVORITES_KEY, favorites);
    render();
  }

  function roomItem(room, { pinned }) {
    const item = document.createElement('li');
    item.className = 'room-nav-item';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'room-nav-open';
    open.textContent = `#${room}`;
    open.title = `Join #${room}`;
    open.setAttribute('aria-label', `Join room ${room}`);
    open.addEventListener('click', () => join(room));

    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'room-nav-star';
    star.textContent = favorites.includes(room) ? '★' : '☆';
    star.setAttribute('aria-pressed', String(favorites.includes(room)));
    star.setAttribute('aria-label', `${favorites.includes(room) ? 'Remove' : 'Add'} ${room} ${pinned ? 'from' : 'to'} favourites`);
    star.addEventListener('click', () => toggleFavorite(room));

    item.append(open, star);
    return item;
  }

  function render() {
    favoritesEl.replaceChildren(...favorites.map((room) => roomItem(room, { pinned: true })));
    recentEl.replaceChildren(...recent.filter((room) => !favorites.includes(room)).map((room) => roomItem(room, { pinned: false })));
    favoritesEl.previousElementSibling.hidden = !favorites.length;
    favoritesEl.hidden = !favorites.length;
    recentEl.previousElementSibling.hidden = !recent.length;
    recentEl.hidden = !recent.length;
  }

  // Each time the socket joins a room, remember it at the top of the recent list.
  socket.on('connect', () => {
    const room = getRoom();
    if (!room) return;
    recent = [room, ...recent.filter((item) => item !== room)].slice(0, MAX_RECENT);
    writeList(RECENT_KEY, recent);
    render();
  });

  render();
}
