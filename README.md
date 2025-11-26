# schoology 6x

An "implementation of Schoology" but actually a tiny, static NES emulator you run in the browser.

Live demo (GitHub Pages): https://moxlyy.github.io/schoology_6x/

Overview
- Play real `.nes` ROM files directly in the browser (client-side). The emulator uses `jsnes` and runs entirely in your browser when you open the page.
- This project was built to be served from GitHub Pages; the demo link above shows it live.

Legal / Safety
- Do not upload or distribute copyrighted ROMs that you don't own. Use only ROMs you are permitted to run.

Quick start
1. Clone or download the repository.
2. Start a local static server from the repo root and open `http://localhost:8000`:

```bash
python3 -m http.server 8000
```

3. Open the page, click "Select a .nes file", and `Start` to begin emulation.

Controls
- Keyboard: `A = Z`, `B = X`, `Start = Enter`, `Select = Shift`, `D-pad = Arrow keys`.
- Gamepad: Most controllers map automatically (A/B, D-pad or axes, Start/Select).

Audio & performance
- The emulator loop targets the NES-native framerate of **60.0988 FPS** using a high-precision accumulator.
- Audio is produced via the WebAudio API and resampled for smoother playback. Audio starts on a user gesture (click `Start`).

Volume
- Use the range slider in the UI to control volume (0–100%). The Mute button momentarily silences audio while preserving your chosen volume.

Implementation notes
- `index.html` — UI and controls
- `js/app.js` — emulator integration (`jsnes`), audio (WebAudio resampling + GainNode), gamepad mapping, framerate loop
- `css/style.css` — styles


