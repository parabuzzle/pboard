# Priority Board

A dark, free-form sticky-note board for the things a team needs to keep in view right now. It is designed for a shared office or lab display, without the lanes, statuses, or ceremony of a traditional kanban board.

![Priority Board running at TV resolution](docs/priority-board.png)

## Features

- Create and edit notes directly on the board.
- Drag notes anywhere and resize them from the corner.
- Choose from six colors, four typefaces, and four text sizes.
- Add optional dates with clear due-soon and overdue labels.
- Hide the controls with presentation mode for an always-on display.
- Save automatically in the browser—no account or backend required.
- Use it with a mouse, touchscreen, or keyboard.

## Quick start

Priority Board has no runtime dependencies. Node.js 18 or newer is sufficient.

```bash
git clone https://github.com/parabuzzle/pboard.git
cd pboard
npm start
```

Open [http://localhost:4173](http://localhost:4173).

The server listens on the local network by default. Other devices can open `http://<display-computer-ip>:4173` while the server is running and the computer's firewall permits it.

## Controls

- Click **New note** and type directly on the card.
- Drag a card's narrow top edge to move it.
- Drag the bottom-right corner to resize it.
- Select a card to change its color, typeface, text size, or date.
- Press `Delete` or `Backspace` with a card selected to remove it.
- Press `P` for presentation mode; press `P` or `Escape` to exit.
- Press `Ctrl+Enter` or `Cmd+Enter` to create a note quickly.

## Where the data lives

Notes are stored in the display browser's `localStorage` under the key `pboard.notes.v1`. They persist through refreshes and browser restarts, but they are tied to that browser profile and site address.

There is currently no synchronization or automatic backup. Clearing the site's browser data erases the board.

## Linear integration

The core board is deliberately local and frictionless. A useful Linear integration should be a small, opinionated layer rather than turning this into a second issue tracker.

The likely next step is a one-way **Due soon** feed: select a Linear team or project, pull incomplete issues due in the next 7–14 days, and show them as visually distinct, read-only cards. Manually created notes would remain free-form. A small backend would keep the Linear API key out of the TV browser and periodically refresh the feed.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a substantial change.

## License

Priority Board is available under the [MIT License](LICENSE).
