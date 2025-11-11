// apc40mk2.js
// APC40 Mk2 module script for Chataigne
// Based on APC40 Mk2 protocol document v1.2 (APC40Mk2_Communications_Protocol_v1.2.pdf).
// See: provided protocol PDF for details.  [oai_citation:4‡APC40Mk2_Communications_Protocol_v1.2.pdf](sediment://file_00000000e2f8724395083a72dadc21ff)

/*
  Notes:
  - This script is written to run in the Chataigne Module Script environment.
  - It uses a minimal and explicit API:
      local.log(msg)                -> log to console
      local.sendMidi(bytesArray)    -> send raw MIDI bytes (array of ints)
      local.setValue(name, v)       -> set module value (Chataigne UI)
      local.getParameter(name)      -> get module parameter value
  - If your Chataigne version uses different names, change these wrappers.
*/

// ----------------- helpers / constants -----------------

const SYSEX_START = 0xF0;
const SYSEX_END = 0xF7;
const AKAI_MANUFACTURER = 0x47;
const PRODUCT_ID = 0x29;
const INTRO_TYPE = 0x60; // message id for intro (host->device)
const INTRO_RESPONSE = 0x61; // device->host response id

// Mode IDs (per protocol)
const MODE = {
  "Generic": 0x40,
  "Ableton Live": 0x41,
  "Alternate Ableton Live": 0x42
};

// helpers to access local API in a safe way (adapt here if needed)
function log() {
  try { local.log(Array.from(arguments).join(" ")); } catch (e) { /* fallback */ }
}
function sendMidi(bytes) {
  // bytes: array of integers 0..255
  try { local.sendMidi(bytes); } catch(e) { log("sendMidi error:", e); }
}
function setValue(name, v) {
  try { local.setValue(name, v); } catch(e) { /* ignore if not present */ }
}
function getParam(name) {
  try { return local.getParameter(name); } catch(e) { return null; }
}

// convert mode param to byte
function getModeByte() {
  const p = getParam("mode");
  return MODE[p] || MODE["Ableton Live"];
}

// ----------------- SysEx intro -----------------
function sendIntroduction() {
  // Format per protocol:
  // F0 47 <DeviceID 0x7F normally> 29 60 00 04 <appId> <verHigh> <verLow> <bugfix> F7
  const deviceId = 0x7F;
  const appId = 0x00;
  const verHigh = Math.max(0, Math.min(127, getParam("appVersionHigh") || 0));
  const verLow  = Math.max(0, Math.min(127, getParam("appVersionLow") || 1));
  const bugfix  = Math.max(0, Math.min(127, getParam("bugfix") || 0));

  const modeByte = getModeByte(); // placed at data start per docs (some docs show application id at data[0], here we follow the provided layout)
  // The doc's "Format of Type 0 outbound message" expects data bytes: 8: 0x40|0x41|0x42 etc then version high/low/bugfix
  // So we build the sysex accordingly:
  const sysex = [
    SYSEX_START,
    AKAI_MANUFACTURER,
    deviceId,
    PRODUCT_ID,
    INTRO_TYPE,
    0x00, // data length MSB
    0x04, // data length LSB
    modeByte,
    verHigh,
    verLow,
    bugfix,
    SYSEX_END
  ];
  log("APC40 Mk2: sending Introduction SysEx:", sysex.map(x=>x.toString(16)));
  sendMidi(sysex);
}

// ----------------- Incoming MIDI parsing -----------------

// utility to parse channel from status byte
function midiChannel(status) {
  return status & 0x0F;
}

function isNoteOn(status) {
  return (status & 0xF0) === 0x90;
}
function isNoteOff(status) {
  return (status & 0xF0) === 0x80;
}
function isCC(status) {
  return (status & 0xF0) === 0xB0;
}
function isSysEx(bytes) {
  return bytes && bytes.length >= 2 && bytes[0] === SYSEX_START;
}

// handle incoming SysEx messages (device responses)
function handleSysEx(bytes) {
  // Check for APC40 Mk2 response 0x47 0x7F 0x29 0x61 etc.
  // Example response to INTRO: F0 47 7F 29 61 00 04 <9 slider values> F7
  if (bytes.length < 6) return;
  if (bytes[1] !== AKAI_MANUFACTURER) return;
  // product id at bytes[3] should be 0x29
  if (bytes[3] !== PRODUCT_ID) return;

  const msgType = bytes[4];
  if (msgType === INTRO_RESPONSE) {
    // bytes[6..] contain 9 slider values per protocol; we'll publish them as deviceKnob/trackFader initial states
    // Protocol states: bytes 8..16 (indexing from 1 in document). Here in array indexing:
    // bytes = [F0, 47, 7F, 29, 61, 00, 04, s1,s2,...,s9, F7]
    const dataStart = 7;
    for (let i = 0; i < 9 && (dataStart + i) < bytes.length - 1; i++) {
      const val = bytes[dataStart + i];
      // sliders 1..9 -> we'll map first 8 to deviceKnob[0..7] and 9th to whatever (master or ignore)
      if (i < 8) {
        // update as deviceKnob initial position
        setValue("deviceKnob." + (i+1), val);
      } else {
        setValue("deviceKnob.9", val);
      }
    }
    log("APC40 Mk2: received intro response, sliders updated.");
  } else {
    log("APC40 Mk2: unknown sysex message type", msgType);
  }
}

// Map incoming note numbers and CCs to value names and update via setValue
function handleNoteOn(chan, note, vel) {
  // The device uses note numbers per protocol: 0x00..0x27 = clip launches
  // 0x30..0x3F and others map to control buttons
  // If velocity is 0, treat as Note Off per MIDI conventions (but APC prefers real Note Off)
  if (note >= 0x00 && note <= 0x27) {
    // clip grid: 0..39
    setValue("clip." + (note + 1), vel > 0 ? 1 : 0);
    return;
  }

  switch (note) {
    case 0x30: // RECORD ARM (0-7 across channels)
      setValue("recarm." + (chan+1), vel > 0 ? 1 : 0);
      break;
    case 0x31: // SOLO
      setValue("solo." + (chan+1), vel > 0 ? 1 : 0);
      break;
    case 0x32: // ACTIVATOR
      setValue("activator." + (chan+1), vel > 0 ? 1 : 0);
      break;
    case 0x33: // TRACK SELECT
      // For track select we have 9 buttons (1..8 + master). The device sends channel to indicate which track
      setValue("trackSelect." + (chan+1), vel > 0 ? 1 : 0);
      break;
    case 0x34: // TRACK STOP / CLIP STOP (0-7)
      setValue("trackStop." + (chan+1), vel > 0 ? 1 : 0);
      break;
    case 0x3A: // DEVICE LEFT
      setValue("deviceNav.1", vel > 0 ? 1 : 0);
      break;
    case 0x3B: // DEVICE RIGHT
      setValue("deviceNav.2", vel > 0 ? 1 : 0);
      break;
    case 0x3C: // BANK LEFT
      setValue("deviceNav.3", vel > 0 ? 1 : 0);
      break;
    case 0x3D: // BANK RIGHT
      setValue("deviceNav.4", vel > 0 ? 1 : 0);
      break;
    case 0x3E: // DEVICE ON/OFF
      setValue("deviceNav.5", vel > 0 ? 1 : 0);
      break;
    case 0x3F: // DEVICE LOCK
      setValue("deviceNav.6", vel > 0 ? 1 : 0);
      break;
    case 0x40: // CLIP/DEVICE VIEW
      setValue("deviceNav.7", vel > 0 ? 1 : 0);
      break;
    case 0x41: // DETAIL VIEW
      setValue("deviceNav.8", vel > 0 ? 1 : 0);
      break;
    case 0x42: // CROSSFADER A/B (0-7 through channels)
      setValue("crossfaderAB." + (chan+1), vel > 0 ? 1 : 0);
      break;
    case 0x50:
      setValue("master", vel > 0 ? 1 : 0);
      break;
    case 0x51:
      setValue("stopAll", vel > 0 ? 1 : 0);
      break;
    case 0x52: case 0x53: case 0x54: case 0x55: case 0x56:
      // Scene Launch 1..5
      setValue("sceneLaunch." + (note - 0x52 + 1), vel > 0 ? 1 : 0);
      break;
    case 0x5B:
      setValue("play", vel > 0 ? 1 : 0);
      break;
    case 0x5C:
      setValue("stop", vel > 0 ? 1 : 0);
      break;
    case 0x5D:
      setValue("record", vel > 0 ? 1 : 0);
      break;
    case 0x66:
      setValue("sessionRecord", vel > 0 ? 1 : 0);
      break;
    default:
      // other buttons (arrows, shift, nudge etc.) can be mapped by user if desired
      setValue("button_" + note, vel > 0 ? 1 : 0);
      break;
  }
}

function handleNoteOff(chan, note, vel) {
  // treat note-off as same mapping but 0
  handleNoteOn(chan, note, 0);
}

function handleCC(chan, controller, value) {
  // absolute & relative controllers
  // Track fader controller id 0x07 on channels 0..7
  if (controller === 0x07) {
    setValue("trackFader." + (chan+1), value);
    return;
  }
  if (controller === 0x0E) {
    setValue("masterFader", value);
    return;
  }
  // device knobs 0x10..0x17 (0-8 tracks for mode 0)
  if (controller >= 0x10 && controller <= 0x17) {
    const idx = controller - 0x10 + 1;
    setValue("deviceKnob." + idx, value);
    return;
  }
  // device knob LED ring types 0x18..0x1f
  if (controller >= 0x18 && controller <= 0x1f) {
    const idx = controller - 0x18 + 1;
    setValue("deviceKnobRingType." + idx, value);
    return;
  }
  // track knobs 0x30..0x37 (actual values)
  if (controller >= 0x30 && controller <= 0x37) {
    const idx = controller - 0x30 + 1;
    setValue("trackKnob." + idx, value);
    return;
  }
  // track knob ring types 0x38..0x3f
  if (controller >= 0x38 && controller <= 0x3f) {
    const idx = controller - 0x38 + 1;
    setValue("trackKnobRingType." + idx, value);
    return;
  }
  if (controller === 0x2F) { // cue level
    setValue("cue", value);
    return;
  }
  if (controller === 0x0D) { // tempo (relative controller)
    // Per doc: 0x01..0x3F positive increments, 0x40..0x7F negative increments
    setValue("tempo", value);
    return;
  }

  // fallback generic mapping
  setValue("cc_" + controller, value);
}

// main entrypoint for incoming midi bytes arrays
// Chataigne usually provides raw MIDI messages; adapt if your env gives a different structure
function onMidiMessage(bytes) {
  if (!bytes || bytes.length === 0) return;

  // SysEx handling
  if (isSysEx(bytes)) {
    handleSysEx(bytes);
    return;
  }

  const status = bytes[0];
  if (isNoteOn(status)) {
    const ch = midiChannel(status);
    const note = bytes[1];
    const vel = bytes[2];
    // treat vel==0 as note-off (but call noteOn handler which handles it)
    handleNoteOn(ch, note, vel);
    return;
  }
  if (isNoteOff(status)) {
    const ch = midiChannel(status);
    const note = bytes[1];
    const vel = bytes[2];
    handleNoteOff(ch, note, vel);
    return;
  }
  if (isCC(status)) {
    const ch = midiChannel(status);
    const controller = bytes[1];
    const value = bytes[2];
    handleCC(ch, controller, value);
    return;
  }
  // other messages ignored for now
}

// ----------------- Outbound helpers (LEDs, LED rings, controller updates) -----------------

// Set a LED using a Note On with specified velocity (state)
// - note: integer note number (0..127) per protocol
// - velocity: per protocol maps to color/state (0=off, 1..127 color/behaviour)
function setLed(note, velocity, channel) {
  // channel optional (0..7) used by certain LEDs (0x30..0x39)
  const chan = (typeof channel === "number") ? (channel & 0x0F) : 0;
  const status = 0x90 | (chan & 0x0F); // Note On with channel
  sendMidi([status, note & 0x7F, velocity & 0x7F]);
}

// Turn off LED (Note Off)
function clearLed(note, channel) {
  const chan = (typeof channel === "number") ? (channel & 0x0F) : 0;
  const status = 0x80 | (chan & 0x0F); // Note Off
  sendMidi([status, note & 0x7F, 0x00]);
}

// Update an absolute controller on device (Controller message)
// - controllerId: 0x07, 0x10.. etc per protocol
// - value: 0..127
// - channel: 0..15
function setController(controllerId, value, channel) {
  const ch = (typeof channel === "number") ? channel & 0x0F : 0;
  const status = 0xB0 | (ch & 0x0F);
  sendMidi([status, controllerId & 0x7F, value & 0x7F]);
}

// Convenience: set LED ring for a device knob: the protocol uses controller IDs 0x18..0x1F and 0x38..0x3F for types & 0x10..0x17 / 0x30..0x37 for values
function setDeviceKnobValue(knobIndex /*1..8*/, value /*0..127*/, channel) {
  const controllerId = 0x10 + (knobIndex - 1);
  setController(controllerId, value, channel);
}
function setDeviceKnobRingType(knobIndex /*1..8*/, type /*0..127*/, channel) {
  const controllerId = 0x18 + (knobIndex - 1);
  setController(controllerId, type, channel);
}
function setTrackKnobValue(knobIndex /*1..8*/, value /*0..127*/, channel) {
  const controllerId = 0x30 + (knobIndex - 1);
  setController(controllerId, value, channel);
}
function setTrackKnobRingType(knobIndex /*1..8*/, type /*0..127*/, channel) {
  const controllerId = 0x38 + (knobIndex - 1);
  setController(controllerId, type, channel);
}

// ----------------- Commands from module UI -----------------

function command_sendIntro() {
  sendIntroduction();
}

function command_ledsOff() {
  // quick sweep of major LEDs: clip grid 0x00..0x27, control notes listed 0x30..0x66 -> send note-off
  for (let n = 0x00; n <= 0x27; n++) clearLed(n, 0);
  const controlNotes = [0x30,0x31,0x32,0x33,0x34,0x3A,0x3B,0x3C,0x3D,0x3E,0x3F,0x40,0x41,0x42,0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x5B,0x5D,0x66];
  controlNotes.forEach(n => clearLed(n, 0));
  log("APC40 Mk2: requested turning common LEDs off.");
}

// ----------------- module lifecycle hooks -----------------

// called when the module script is loaded
function onModuleStart() {
  log("APC40 Mk2 module script started.");
  // if parameter instructs, send intro
  const sendOnConnect = getParam("sendIntroOnConnect");
  if (sendOnConnect) {
    // small delay might be beneficial in real-life usage; here we call directly
    sendIntroduction();
  }
}

// Called by Chataigne when an incoming MIDI message arrives
// We expect Chataigne to call this with a JS array of bytes
function onMidi(bytes) {
  try {
    onMidiMessage(bytes);
  } catch (e) {
    log("onMidi error", e);
  }
}

// Called when a parameter changes (e.g. user changed mode)
function moduleParameterChanged(param) {
  log("Parameter changed:", param.name);
  if (param.shortName === "mode") {
    // re-send intro to update device mode
    sendIntroduction();
  }
}

// Called when a command is triggered from the module UI
function moduleCommand(name) {
  if (name === "sendIntro") command_sendIntro();
  else if (name === "ledsOff") command_ledsOff();
}

// Exported API for Chataigne to wire in
return {
  onModuleStart,
  onMidi,
  moduleParameterChanged,
  moduleCommand,

  // helpers exposed for advanced scripting / triggers inside Chataigne
  _setLed: setLed,
  _clearLed: clearLed,
  _setController: setController,
  _setDeviceKnobValue: setDeviceKnobValue,
  _setDeviceKnobRingType: setDeviceKnobRingType,
  _setTrackKnobValue: setTrackKnobValue,
  _setTrackKnobRingType: setTrackKnobRingType
};
