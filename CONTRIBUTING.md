# Contributing

Thanks for helping make Priority Board better.

## Local development

Priority Board has no runtime dependencies. You only need Node.js 18 or newer.

```bash
npm start
```

Open [http://localhost:4173](http://localhost:4173). Changes to HTML, CSS, and JavaScript are available after a browser refresh.

## Before opening a pull request

- Keep the board fast, legible from across a room, and useful without an account.
- Preserve keyboard, mouse, and touch interactions.
- Test the layout at both a TV-sized 16:9 viewport and a narrow mobile viewport.
- Avoid adding a dependency when the browser platform can do the job clearly.
- Run `npm test` to catch JavaScript syntax errors.

For a larger change, open an issue first so the interaction and scope can be discussed before implementation.

## Project structure

- `index.html` contains the application shell and controls.
- `styles.css` contains the full visual system and responsive layout.
- `app.js` contains note state, interactions, and local persistence.
- `server.mjs` is the dependency-free development/static server.

By contributing, you agree that your contribution will be licensed under the MIT License.
