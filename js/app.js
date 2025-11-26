(() => {
  const fileInput = document.getElementById('file');
  const info = document.getElementById('info');
  const startBtn = document.getElementById('start');
  const pauseBtn = document.getElementById('pause');
  const resetBtn = document.getElementById('reset');
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');

  let nes = null;
  let runInterval = null; // legacy interval id (kept temporarily for pause semantics)
  let rafId = null;
  let lastTime = 0;
  let accumulator = 0;
  let imageData = ctx.createImageData(256, 240);

  // Key mapping for player 1
  const KEYMAP = {
    'z': jsnes.Controller.BUTTON_A,
    'x': jsnes.Controller.BUTTON_B,
    'enter': jsnes.Controller.BUTTON_START,
    'shift': jsnes.Controller.BUTTON_SELECT,
    'arrowup': jsnes.Controller.BUTTON_UP,
    'arrowdown': jsnes.Controller.BUTTON_DOWN,
    'arrowleft': jsnes.Controller.BUTTON_LEFT,
    'arrowright': jsnes.Controller.BUTTON_RIGHT
  };

  // Gamepad state helpers
  let gamepadPrev = {};

  function mapGamepadToButtons(gp) {
    // Try D-Pad buttons first (12..15). Fallback to axes if needed.
    const buttons = {
      up: false,
      down: false,
      left: false,
      right: false,
      a: false,
      b: false,
      select: false,
      start: false
    };

    if (!gp) return buttons;

    // Standard dpad buttons if available
    buttons.up = !!(gp.buttons[12] && gp.buttons[12].pressed);
    buttons.down = !!(gp.buttons[13] && gp.buttons[13].pressed);
    buttons.left = !!(gp.buttons[14] && gp.buttons[14].pressed);
    buttons.right = !!(gp.buttons[15] && gp.buttons[15].pressed);

    // Common face buttons -> NES mapping
    buttons.a = !!(gp.buttons[0] && gp.buttons[0].pressed) || !!(gp.buttons[1] && gp.buttons[1].pressed && !buttons.a && false);
    buttons.b = !!(gp.buttons[1] && gp.buttons[1].pressed) || !!(gp.buttons[0] && gp.buttons[0].pressed && !buttons.b && false);

    // Start/Select
    buttons.select = !!(gp.buttons[8] && gp.buttons[8].pressed) || !!(gp.buttons[6] && gp.buttons[6].pressed);
    buttons.start = !!(gp.buttons[9] && gp.buttons[9].pressed) || !!(gp.buttons[7] && gp.buttons[7].pressed);

    // If no D-Pad buttons, use axes
    if (!buttons.up && !buttons.down && !buttons.left && !buttons.right && gp.axes && gp.axes.length >= 2) {
      const ax = gp.axes[0];
      const ay = gp.axes[1];
      const TH = 0.5;
      if (ay < -TH) buttons.up = true;
      if (ay > TH) buttons.down = true;
      if (ax < -TH) buttons.left = true;
      if (ax > TH) buttons.right = true;
    }

    return buttons;
  }

  function drawFrame(frameBuffer) {
    // frameBuffer is length 256*240 with 24-bit colors
    const data = imageData.data;
    for (let i = 0; i < frameBuffer.length; i++) {
      const c = frameBuffer[i];
      const j = i * 4;
      // jsnes returns color as 0xRRGGBB in some builds or 0xBBGGRR in others.
      // Swap red/blue so color ordering is correct for ImageData (RGBA)
      data[j] = c & 0xff; // blue
      data[j + 1] = (c >> 8) & 0xff; // green
      data[j + 2] = (c >> 16) & 0xff; // red
      data[j + 3] = 0xff;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // --- Audio output (WebAudio) ---
  let audioCtx = null;
  let audioQueue = []; // contains samples at NES sample rate
  let audioReadIndex = 0; // fractional read index into audioQueue
  let scriptNode = null;
  let gainNode = null;
  let currentVolume = 0.8; // 0.0 - 1.0
  let muted = false;
  const NES_AUDIO_RATE = 44100; // jsnes produces samples at 44.1k

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // small buffer, produce mono output. We'll resample to the AudioContext rate.
    const bufferSize = 2048;
    scriptNode = audioCtx.createScriptProcessor(bufferSize, 0, 1);
    scriptNode.onaudioprocess = function(e) {
      const output = e.outputBuffer.getChannelData(0);
      if (!audioQueue.length) {
        // underrun -> silence
        for (let i = 0; i < output.length; i++) output[i] = 0;
        return;
      }

      const outRate = audioCtx.sampleRate;
      const step = NES_AUDIO_RATE / outRate; // how many NES samples per output sample

      for (let i = 0; i < output.length; i++) {
        const pos = audioReadIndex + i * step;
        const idx = Math.floor(pos);
        const frac = pos - idx;
        let s = 0;
        if (idx < 0 || idx >= audioQueue.length) {
          s = 0;
        } else if (idx + 1 < audioQueue.length) {
          s = audioQueue[idx] * (1 - frac) + audioQueue[idx + 1] * frac;
        } else {
          s = audioQueue[idx];
        }
        output[i] = s;
      }

      // advance read index and drop consumed samples when we pass a whole sample
      audioReadIndex += output.length * step;
      const consumed = Math.floor(audioReadIndex);
      if (consumed > 0) {
        // remove consumed samples from the queue
        audioQueue.splice(0, consumed);
        audioReadIndex -= consumed;
      }
      // guard queue size
      if (audioQueue.length > NES_AUDIO_RATE * 2) audioQueue.splice(0, audioQueue.length - NES_AUDIO_RATE * 2);
    };
    // attach to a gain node so we can control overall volume + mute
    gainNode = audioCtx.createGain();
    gainNode.gain.value = muted ? 0 : currentVolume;
    scriptNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);
  }

  function readAsBinaryString(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      // Use latin1 so bytes map 1:1 to characters
      reader.readAsBinaryString(file);
    });
  }

  function parseNESHeader(bytes) {
    if (bytes.length < 16) return null;
    if (bytes[0] !== 0x4E || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1A) return null;
    return {
      prgROMSizeKB: bytes[4] * 16,
      chrROMSizeKB: bytes[5] * 8,
      flags6: bytes[6],
      flags7: bytes[7]
    };
  }

  function enableControls(enabled) {
    startBtn.disabled = !enabled;
    pauseBtn.disabled = !enabled;
    resetBtn.disabled = !enabled;
  }

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.nes')) {
      info.textContent = 'Please select a .nes file.';
      return;
    }

    info.textContent = 'Parsing file — this runs entirely in your browser.';
    try {
      const binary = await readAsBinaryString(file);

      // Inspect header
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
      const header = parseNESHeader(bytes);

      const meta = [];
      meta.push(`Name: ${file.name}`);
      meta.push(`Size: ${Math.round(file.size / 1024)} KB`);
      if (header) {
        meta.push(`PRG-ROM: ${header.prgROMSizeKB} KB`);
        meta.push(`CHR-ROM: ${header.chrROMSizeKB} KB`);
      } else {
        meta.push('Warning: Not a valid iNES header, emulator may still run if file is valid.');
      }

      info.innerHTML = meta.join(' — ');

      // Create the NES instance
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
        runInterval = null;
      }

      nes = new jsnes.NES({
        onFrame: function(frameBuffer) { drawFrame(frameBuffer); },
        onAudioSample: function(left, right) {
          // jsnes provides left/right [-1..1], mix to mono and queue for ScriptProcessor
          const s = (left + right) * 0.5;
          // clamp
          audioQueue.push(Math.max(-1, Math.min(1, s)));
          // keep queue bounded
          if (audioQueue.length > NES_AUDIO_RATE * 2) audioQueue.splice(0, audioQueue.length - NES_AUDIO_RATE * 2);
        }
      });

      // load ROM as binary string
      nes.loadROM(binary);
      // prepare audio engine on ROM load — but resume on user gesture
      audioQueue.length = 0;
      if (audioCtx) {
        try { audioCtx.close(); } catch (e) {}
        audioCtx = null;
      }

      enableControls(true);
      info.innerText += '\nROM loaded. Click Start.';
    } catch (err) {
      console.error(err);
      info.textContent = 'Failed to load file: ' + err.message;
    }
  });

  const NES_FRAMERATE = 60.0988;
  const NES_FRAME_MS = 1000 / NES_FRAMERATE;

  function mainLoop(now) {
    if (!lastTime) lastTime = now;
    const dt = now - lastTime;
    lastTime = now;
    accumulator += dt;

    // To avoid spiral of death, cap the number of frames we run in a single tick
    let frames = 0;
    while (accumulator >= NES_FRAME_MS && frames < 10) {
      pollGamepads();
      nes.frame();
      accumulator -= NES_FRAME_MS;
      frames++;
    }

    rafId = requestAnimationFrame(mainLoop);
  }

  startBtn.addEventListener('click', () => {
    if (!nes) return;
    if (!rafId) {
      // create/resume audio on user gesture
      if (!audioCtx) initAudio();
      if (audioCtx && audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
      lastTime = 0;
      accumulator = 0;
      rafId = requestAnimationFrame(mainLoop);
      // keep runInterval flag for compatibility with pause state
      runInterval = rafId;
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
      runInterval = null;
    } else if (nes) {
      // restart main loop
      lastTime = 0;
      accumulator = 0;
      rafId = requestAnimationFrame(mainLoop);
      runInterval = rafId;
    }
  });

  resetBtn.addEventListener('click', () => {
    if (nes) nes.reset();
  });

  // keyboard bindings to controller 1
  window.addEventListener('keydown', (ev) => {
    if (!nes) return;
    const k = (ev.key || '').toLowerCase();
    const btn = KEYMAP[k];
    if (btn !== undefined) {
      nes.buttonDown(1, btn);
      ev.preventDefault();
    }
  });

  window.addEventListener('keyup', (ev) => {
    if (!nes) return;
    const k = (ev.key || '').toLowerCase();
    const btn = KEYMAP[k];
    if (btn !== undefined) {
      nes.buttonUp(1, btn);
      ev.preventDefault();
    }
  });

  // Gamepad polling — reads the first connected gamepad and maps to controller 1
  function pollGamepads() {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!gps) return;
    let gp = null;
    for (let i = 0; i < gps.length; i++) if (gps[i]) { gp = gps[i]; break; }

    // read mapped buttons
    const mapped = mapGamepadToButtons(gp);
    const prev = gamepadPrev;

    // transitions
    if (mapped.a !== prev.a) {
      if (mapped.a) nes.buttonDown(1, jsnes.Controller.BUTTON_A); else nes.buttonUp(1, jsnes.Controller.BUTTON_A);
    }
    if (mapped.b !== prev.b) {
      if (mapped.b) nes.buttonDown(1, jsnes.Controller.BUTTON_B); else nes.buttonUp(1, jsnes.Controller.BUTTON_B);
    }

    if (mapped.start !== prev.start) {
      if (mapped.start) nes.buttonDown(1, jsnes.Controller.BUTTON_START); else nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    }
    if (mapped.select !== prev.select) {
      if (mapped.select) nes.buttonDown(1, jsnes.Controller.BUTTON_SELECT); else nes.buttonUp(1, jsnes.Controller.BUTTON_SELECT);
    }

    // D-Pad
    if (mapped.up !== prev.up) { if (mapped.up) nes.buttonDown(1, jsnes.Controller.BUTTON_UP); else nes.buttonUp(1, jsnes.Controller.BUTTON_UP); }
    if (mapped.down !== prev.down) { if (mapped.down) nes.buttonDown(1, jsnes.Controller.BUTTON_DOWN); else nes.buttonUp(1, jsnes.Controller.BUTTON_DOWN); }
    if (mapped.left !== prev.left) { if (mapped.left) nes.buttonDown(1, jsnes.Controller.BUTTON_LEFT); else nes.buttonUp(1, jsnes.Controller.BUTTON_LEFT); }
    if (mapped.right !== prev.right) { if (mapped.right) nes.buttonDown(1, jsnes.Controller.BUTTON_RIGHT); else nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT); }

    // save
    gamepadPrev = mapped;
  }

  // start disabled until ROM loaded
  enableControls(false);

  // volume + mute UI
  const volSlider = document.getElementById('volume');
  const volLabel = document.getElementById('vol-label');
  const muteBtn = document.getElementById('mute');
  if (volLabel) volLabel.textContent = Math.round(currentVolume * 100) + '%';

  if (volSlider) {
    volSlider.addEventListener('input', (e) => {
      currentVolume = Number(e.target.value || 0) / 100;
      if (volLabel) volLabel.textContent = Math.round(currentVolume * 100) + '%';
      if (gainNode && !muted) gainNode.gain.value = currentVolume;
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      muteBtn.setAttribute('aria-pressed', String(!!muted));
      muteBtn.textContent = muted ? '🔇' : '🔈';
      if (gainNode) gainNode.gain.value = muted ? 0 : currentVolume;
    });
  }

})();
