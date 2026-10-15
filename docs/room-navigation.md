# Room navigation

The sidebar lists your **Recent rooms** and your **Favourites**. Click a room name to join it, and
click the star to pin or unpin it as a favourite. Favourites appear first.

- Each room you join goes to the top of the recent list. The list keeps the last 8 rooms.
- Favourites keep up to 20 rooms, in the order you pinned them.
- Both lists are saved in this browser's local storage (`gather-recent-rooms`, `gather-favorite-rooms`).
  They aren't stored on the server, so they don't follow you to another browser.
- On small screens the lists sit in a single row that scrolls sideways.

Implemented in `frontend/src/features/roomNavigation.js` and `roomNavigation.css`.
