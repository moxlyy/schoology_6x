# schoology 6x

> a *totally normal* “schoology implementation” that just so happens to be a tiny NES emulator running in your browser 

**Live demo:** https://moxlyy.github.io/schoology_6x/  
*(served straight off GitHub Pages, no setup)*

---

##  Overview

- Load and play real **`.nes` ROMs** right in the browser — everything runs client-side using `jsnes`.
- Fully static, super tiny, works on GitHub Pages like a charm. 

---

##  Legal / Safety

pls don’t summon nintendo’s lawyers 😭🙏  
**Only use ROMs you legally own.** No distributing copyrighted stuff.

---

##  Quick Start (local)

1. Clone / download the repo.
2. Run a small static server:

```bash
python3 -m http.server 8000
```

3. Head to `http://localhost:8000`  
4. Hit **Select a .nes file** → **Start**   

---

##  Controls

**Keyboard**
- `A` → **Z**  
- `B` → **X**  
- `Start` → **Enter**  
- `Select` → **Shift**  
- **D-pad** → Arrow keys  

**Gamepad**
- Most controllers get auto-mapped  
- A/B, D-pad or stick, Start/Select 

---

## 🔊 Audio & Performance

- Runs at the original NES framerate: **60.0988 FPS**.
- WebAudio API for smooth audio w/ resampling.
- Audio only starts after a user gesture (clicking Start).

---

## 🔈 Volume

- UI slider controls volume from **0–100%**.
- **Mute** temporarily silences audio without resetting your volume.

---

## 🛠️ File Breakdown

- **`index.html`** — UI layout + controls  
- **`js/app.js`** — emulator integration (`jsnes`), audio, gamepad mapping, framerate loop  
- **`css/style.css`** — styles

---
