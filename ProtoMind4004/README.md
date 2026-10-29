# ProtoMind4004

Schematic canvas (left) + code editor (right) + one-click install and upload to a real Arduino.
Works on Windows, macOS and Linux.

## Run
1. Install Node 18+
2. `npm install && npm start`
3. Open http://localhost:3000
4. First run: click **Install now** in the yellow bar. ProtoMind downloads arduino-cli and the
   AVR board support into your user folder (no admin rights needed):
   - Windows: `%APPDATA%\ProtoMind`
   - macOS: `~/Library/Application Support/ProtoMind`
   - Linux: `~/.local/share/protomind`
5. Plug in a board, click **Detect boards**, then **Upload**.

Override with `ARDUINO_CLI=/path/to/arduino-cli` or `PROTOMIND_HOME=/some/folder`.

Linux: add your user to the `dialout` group once (`sudo usermod -aG dialout $USER`, then re-login).
Windows: clone boards (CH340) may need their USB driver.
