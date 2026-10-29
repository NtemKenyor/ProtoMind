# ProtoMind

One local server, one `npm start`. A hub page links to three projects:

| Path | Project | Status |
|---|---|---|
| `/` | Hub | Embedded CSS/JS for now |
| `/protomind` | **ProtoMind4004**: schematic canvas + code editor + one-click install and upload to a real Arduino | Working |
| `/protoweb` | **ProtoWeb**: visual drag-and-drop HTML & inline CSS website builder with Code and View modes | Ready |
| `/protogame` | ProtoGame | Placeholder |

Works on Windows, macOS and Linux.

## Layout

```
ProtoMind/
├── package.json            # one root package, one `npm start`
├── server.js               # launcher: serves the hub, mounts each sub-project
├── README.md
├── public/
│   └── index.html          # the hub (CSS + JS embedded; split into hub.css / hub.js later)
└── projects/
    ├── ProtoMind4004/
    │   ├── server.js       # exports { router, handleUpgrade, WS_PATH } instead of calling listen()
    │   ├── toolchain.js
    │   └── public/index.html   # served at /protomind
    ├── ProtoWeb/index.html     # served at /protoweb
    └── ProtoGame/index.html    # served at /protogame
```

## Run
1. Install Node 18+
2. `npm install && npm start`
3. Open http://localhost:3000

## ProtoMind4004 first run
Click **Install now** in the yellow bar. ProtoMind downloads arduino-cli and the AVR board support
into your user folder (no admin rights needed):
- Windows: `%APPDATA%\ProtoMind`
- macOS: `~/Library/Application Support/ProtoMind`
- Linux: `~/.local/share/protomind`

Then plug in a board, click **Detect boards**, then **Upload**.

Override with `ARDUINO_CLI=/path/to/arduino-cli`, `PROTOMIND_HOME=/some/folder` or `PORT=3001`.

Linux: add your user to the `dialout` group once (`sudo usermod -aG dialout $USER`, then re-login).
Windows: clone boards (CH340) may need their USB driver.

## Adding a project
1. Create `projects/<Name>/` with an `index.html` (or a `server.js` that exports a router).
2. Mount it in the root `server.js`.
3. Add an entry to `PROJECTS` in `public/index.html`.

A project that needs a WebSocket exports a `handleUpgrade` and a `WS_PATH`; the root server routes `upgrade` events by path.
