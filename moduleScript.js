/* ---
 * AKAI APC40 Mk2 (Mode 1) Chataigne Modul-Skript
 * Basiert auf dem v1.2 Kommunikationsprotokoll.
 * ---
 */

// --- Globale MIDI-Maps ---

// Sysex-Nachricht für Mode 1 (Ableton Live Mode)
// F0 47 7F 29 60 00 04 41 01 00 00 F7
var sysexMode1 = [240, 71, 127, 41, 96, 0, 4, 65, 1, 0, 0, 247];

// --- Eingangs-Maps (Gerät -> Chataigne) ---
var ccValueObj = []; // Map für CC-Nummer -> Chataigne Value
var noteValueObj = []; // Map für Note-Nummer -> Chataigne Value (kanalunabhängig)
var trackNoteValueObj = []; // Map für Note-Nummer -> Chataigne Value (kanalabhängig)

// --- Ausgangs-Maps (Chataigne -> Gerät) ---
var ledParams = {}; // Haupt-Objekt zur Speicherung von LED-Zuständen
var knobParams = {}; // Haupt-Objekt zur Speicherung von Knob-Zuständen

// CCs für Track Knobs (Werte und Typen)
var knobValueCCs = [48, 49, 50, 51, 52, 53, 54, 55]; // CCs 0x30 - 0x37
var knobTypeCCs = [56, 57, 58, 59, 60, 61, 62, 63]; // CCs 0x38 - 0x3F

// --- Farb-Lookup-Tabelle (LUT) ---
// Konvertiert Chataigne-Farben [r,g,b] (0-255) in die nächste APC40 Mk2 Velocity (0-127)
// Dies ist eine verkürzte Version der 128 Farben aus dem PDF
var colorLUT = [
  { v: 0, r: 0, g: 0, b: 0 }, { v: 1, r: 30, g: 30, b: 30 }, { v: 2, r: 127, g: 127, b: 127 }, { v: 3, r: 255, g: 255, b: 255 },
  { v: 4, r: 255, g: 76, b: 76 }, { v: 5, r: 255, g: 0, b: 0 }, { v: 6, r: 89, g: 0, b: 0 }, { v: 7, r: 25, g: 0, b: 0 },
  { v: 8, r: 255, g: 189, b: 108 }, { v: 9, r: 255, g: 84, b: 0 }, { v: 10, r: 89, g: 29, b: 0 }, { v: 11, r: 39, g: 27, b: 0 },
  { v: 12, r: 255, g: 255, b: 76 }, { v: 13, r: 255, g: 255, b: 0 }, { v: 14, r: 89, g: 89, b: 0 }, { v: 15, r: 25, g: 25, b: 0 },
  { v: 16, r: 136, g: 255, b: 76 }, { v: 17, r: 84, g: 255, b: 0 }, { v: 18, r: 29, g: 89, b: 0 }, { v: 19, r: 20, g: 43, b: 0 },
  { v: 20, r: 76, g: 255, b: 76 }, { v: 21, r: 0, g: 255, b: 0 }, { v: 22, r: 0, g: 89, b: 0 }, { v: 23, r: 0, g: 25, b: 0 },
  { v: 24, r: 76, g: 255, b: 94 }, { v: 25, r: 0, g: 255, b: 25 }, { v: 26, r: 0, g: 89, b: 13 }, { v: 27, r: 0, g: 25, b: 2 },
  { v: 28, r: 76, g: 255, b: 136 }, { v: 29, r: 0, g: 255, b: 85 }, { v: 30, r: 0, g: 89, b: 29 }, { v: 31, r: 0, g: 31, b: 18 },
  { v: 32, r: 76, g: 255, b: 183 }, { v: 33, r: 0, g: 255, b: 153 }, { v: 34, r: 0, g: 89, b: 53 }, { v: 35, r: 0, g: 25, b: 18 },
  { v: 36, r: 76, g: 195, b: 255 }, { v: 37, r: 0, g: 169, b: 255 }, { v: 38, r: 0, g: 65, b: 82 }, { v: 39, r: 0, g: 16, b: 25 },
  { v: 40, r: 76, g: 136, b: 255 }, { v: 41, r: 0, g: 85, b: 255 }, { v: 42, r: 0, g: 29, b: 89 }, { v: 43, r: 0, g: 8, b: 25 },
  { v: 44, r: 76, g: 76, b: 255 }, { v: 45, r: 0, g: 0, b: 255 }, { v: 46, r: 0, g: 0, b: 89 }, { v: 47, r: 0, g: 0, b: 25 },
  { v: 48, r: 135, g: 76, b: 255 }, { v: 49, r: 84, g: 0, b: 255 }, { v: 50, r: 25, g: 0, b: 100 }, { v: 51, r: 15, g: 0, b: 48 },
  { v: 52, r: 255, g: 76, b: 255 }, { v: 53, r: 255, g: 0, b: 255 }, { v: 54, r: 89, g: 0, b: 89 }, { v: 55, r: 25, g: 0, b: 25 },
  { v: 56, r: 255, g: 76, b: 135 }, { v: 57, r: 255, g: 0, b: 84 }, { v: 58, r: 89, g: 0, b: 29 }, { v: 59, r: 34, g: 0, b: 19 }
  // ... (Farben 60-127 sind meist Variationen)
];

/**
 * Findet die nächste APC40 Mk2 Velocity für eine gegebene RGB-Farbe.
 */
function rgbToVelocity(r, g, b) {
  if (r == 0 && g == 0 && b == 0) return 0; // Off
  if (r > 0 && r == g && r == b) { // Graustufen
    if (r < 80) return 1;
    if (r < 200) return 2;
    return 3;
  }
  
  var closestV = 0;
  var minDist = Infinity;

  for (var i = 4; i < colorLUT.length; i++) { // Startet bei 4 (erste Farbe)
    var c = colorLUT[i];
    // Einfache Distanzberechnung
    var dist = Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b);
    
    if (dist < minDist) {
      minDist = dist;
      closestV = c.v;
    }
  }
  return closestV;
}


// ------ Initialisierung ------

function init() {
  script.log("APC40 Mk2 Modul initialisiert.");
  
  // --- 1. Helper-Objekte für LED-Zustände erstellen ---
  // (basierend auf der module.json-Struktur)
  
  // Clip Grid (5x8)
  for (var r = 0; r < 5; r++) {
    for (var c = 0; c < 8; c++) {
      var note = r * 8 + c;
      var name = "clip." + r + "." + c;
      ledParams[name] = {
        note: note,
        colorParam: local.parameters.ledsFarbe.clipGrid5x8.getChild("Row " + (r + 1)).getChild("Button " + (c + 1)),
        pulseParam: local.parameters.ledsAnimation.pulsingRGB.clipGrid5x8.getChild("Row " + (r + 1)).getChild("Button " + (c + 1)),
        blinkParam: local.parameters.ledsAnimation.blinkingRGB.clipGrid5x8.getChild("Row " + (r + 1)).getChild("Button " + (c + 1))
      };
      // Input-Map
      noteValueObj[note] = local.values.buttonsClipGrid5x8.getChild("Row " + (r + 1)).getChild("Button " + (c + 1));
    }
  }
  
  // Scene Launch (5 Tasten)
  for (var i = 0; i < 5; i++) {
    var note = 82 + i; // Note 82-86
    var name = "scene." + i;
    ledParams[name] = {
      note: note,
      colorParam: local.parameters.ledsFarbe.sceneLaunch.getChild("Scene " + (i + 1)),
      pulseParam: local.parameters.ledsAnimation.pulsingRGB.sceneLaunch.getChild("Scene " + (i + 1)),
      blinkParam: local.parameters.ledsAnimation.blinkingRGB.sceneLaunch.getChild("Scene " + (i + 1))
    };
    // Input-Map
    noteValueObj[note] = local.values.buttonsSceneStop.getChild("Scene " + (i + 1));
  }
  
  // Stop All Clips (RGB)
  ledParams["stopAll"] = {
    note: 81, // Note 81
    colorParam: local.parameters.ledsFarbe.globalRGB.stopAllClips,
    pulseParam: local.parameters.ledsAnimation.pulsingRGB.globalRGB.stopAllClips,
    blinkParam: local.parameters.ledsAnimation.blinkingRGB.globalRGB.stopAllClips
  };
  noteValueObj[81] = local.values.buttonsSceneStop.stopAllClips;

  // Track Control (8 Tracks, Kanal-abhängig)
  var trackLedNotes = { "Record Arm": 48, "Solo": 49, "Activator": 50, "Track Select": 51, "A/B": 66 };
  var trackStopBlinkNote = 52;
  
  for (var t = 1; t <= 8; t++) {
    // Einfache LEDs (Rec, Solo, Act, Select)
    for (var ledName in trackLedNotes) {
      var note = trackLedNotes[ledName];
      var name = "track." + t + "." + ledName;
      ledParams[name] = {
        note: note,
        channel: t, // Kanal 1-8
        isSimple: true, // Boolean-LED
        colorParam: local.parameters.ledsFarbe.trackControl.getChild("Track " + t).getChild(ledName)
      };
    }
    // Track Stop (Blink-fähig)
    var nameStop = "track." + t + ".Track Stop";
    ledParams[nameStop] = {
        note: trackStopBlinkNote,
        channel: t,
        isSimpleBlink: true, // Spezieller Typ für Track Stop
        colorParam: local.values.buttonsTrackControl.getChild("Track " + t).trackStop, // Note: Track Stop hat keine Farb-Param, wird vom Input gesteuert
        blinkParam: local.parameters.ledsAnimation.blinkingSimple.trackStop.getChild("Track " + t)
    };
    // A/B (Enum)
    var nameAB = "track." + t + ".A/B";
    ledParams[nameAB] = {
        note: 66,
        channel: t,
        isEnum: true, // Enum-LED (0=off, 1=Yel, 2=Org)
        colorParam: local.parameters.ledsFarbe.trackControl.getChild("Track " + t).getRawChild("A/B")
    };
    
    // Input-Maps (Kanal-abhängig)
    trackNoteValueObj[t] = {};
    trackNoteValueObj[t][48] = local.values.buttonsTrackControl.getChild("Track " + t).recordArm;
    trackNoteValueObj[t][49] = local.values.buttonsTrackControl.getChild("Track " + t).solo;
    trackNoteValueObj[t][50] = local.values.buttonsTrackControl.getChild("Track " + t).activator;
    trackNoteValueObj[t][51] = local.values.buttonsTrackControl.getChild("Track " + t).trackSelect;
    trackNoteValueObj[t][52] = local.values.buttonsTrackControl.getChild("Track " + t).trackStop;
    trackNoteValueObj[t][66] = local.values.buttonsTrackControl.getChild("Track " + t).getRawChild("A/B");
  }

  // Global Simple LEDs (An/Aus)
  var globalLedNotes = {
    "Master Select": 80, "Pan": 87, "Sends": 88, "User": 89, "Play": 91, "Record": 93,
    "Session Record": 94, "Metronome": 90, "Device On/Off": 62, "Device Lock": 63,
    "Clip/Device": 64, "Detail View": 65, "Bank Left": 60, "Bank Right": 61,
    "Device Left": 58, "Device Right": 59
  };
  
  for (var name in globalLedNotes) {
    var note = globalLedNotes[name];
    ledParams[name] = {
      note: note,
      isSimple: true,
      colorParam: local.parameters.ledsFarbe.globalSimple.getChild(name)
    };
    // Input-Map
    noteValueObj[note] = local.values.buttonsGlobal.getChild(name);
  }
  // Fehlende globale Inputs
  noteValueObj[92] = local.values.buttonsGlobal.stop;
  noteValueObj[95] = local.values.buttonsGlobal.tapTempo;
  noteValueObj[96] = local.values.buttonsGlobal.nudge;
  noteValueObj[97] = local.values.buttonsGlobal.nudge1;
  noteValueObj[98] = local.values.buttonsGlobal.shift;
  noteValueObj[85] = local.values.buttonsGlobal.up;
  noteValueObj[86] = local.values.buttonsGlobal.down;
  noteValueObj[84] = local.values.buttonsGlobal.left;
  noteValueObj[83] = local.values.buttonsGlobal.right;

  // --- 2. Input-Maps für Fader/Knobs erstellen ---
  // Faders (Kanal-abhängig)
  for (var t = 1; t <= 8; t++) {
    if (!ccValueObj[t]) ccValueObj[t] = {};
    ccValueObj[t][7] = local.values.faders.getChild("Track " + t); // CC 7 auf Kanal t
  }
  ccValueObj[14] = local.values.faders.master; // CC 14 (kanalunabhängig)
  ccValueObj[15] = local.values.faders.crossfader; // CC 15 (kanalunabhängig)
  
  // Knobs (Absolute)
  for (var k = 0; k < 8; k++) {
    var cc = 48 + k; // CC 48-55
    ccValueObj[cc] = local.values.knobsAbsolute.getChild("Track " + (k + 1));
  }
  ccValueObj[47] = local.values.knobsAbsolute.cueLevel; // CC 47
  
  // Knobs (Relative)
  ccValueObj[13] = local.values.knobsRelative.tempo; // CC 13
  
  // Footswitch
  ccValueObj[64] = local.values.footswitch; // CC 64
  
  // --- 3. Output-Maps für Knob-LEDs ---
  for (var k = 1; k <= 8; k++) {
    var name = "knob." + k;
    knobParams[name] = {
      valueCC: knobValueCCs[k - 1],
      typeCC: knobTypeCCs[k - 1],
      valueParam: local.parameters.knobLedsCC.trackKnobValues.getChild("Knob " + k),
      typeParam: local.parameters.knobLedsCC.trackKnobTypes.getChild("Knob " + k)
    };
  }

  // --- 4. Gerät initialisieren ---
  initDevice();
}

/**
 * Befehl: Sendet die Sysex-Initialisierungsnachricht für Mode 1.
 */
function initDevice() {
  script.log("Sende Sysex für Mode 1...");
  script.sendMidi(sysexMode1);
  util.delayThreadMS(100); // Kurze Pause, damit das Gerät den Modus wechseln kann
  resync(); // Alle LED-Zustände neu senden
}

/**
 * Befehl: Sendet den aktuellen Chataigne-Status an alle LEDs.
 */
function resync() {
  script.log("Resyncing all LEDs...");
  
  // Alle LEDs
  for (var name in ledParams) {
    updateLed(ledParams[name]);
  }
  
  // Alle Knob-LEDs
  for (var name in knobParams) {
    var p = knobParams[name];
    // Sendet CC für Typ (Off, Single, Vol, Pan)
    script.sendCc(1, p.typeCC, p.typeParam.get()); 
    // Sendet CC für Wert (0-127)
    script.sendCc(1, p.valueCC, p.valueParam.get());
  }
  script.log("Resync complete.");
}


// ------ MIDI-EINGANG (Gerät -> Chataigne) ------

function midiIn(message) {
  var channel = message.channel; // 1-basiert

  // Note On
  if (message.isNoteOn()) {
    var note = message.note;
    
    // Kanal-abhängige Buttons (Track Control)
    if (trackNoteValueObj[channel] && trackNoteValueObj[channel][note]) {
      trackNoteValueObj[channel][note].set(true);
    }
    // Kanal-unabhängige Buttons
    else if (noteValueObj[note]) {
      noteValueObj[note].set(true);
    }
  }
  // Note Off
  else if (message.isNoteOff()) {
    var note = message.note;
    
    // Kanal-abhängige Buttons
    if (trackNoteValueObj[channel] && trackNoteValueObj[channel][note]) {
      trackNoteValueObj[channel][note].set(false);
    }
    // Kanal-unabhängige Buttons
    else if (noteValueObj[note]) {
      noteValueObj[note].set(false);
    }
  }
  // Control Change
  else if (message.isCC()) {
    var cc = message.control;
    var value = message.value;
    
    // Kanal-abhängige Fader (Track 1-8)
    if (cc == 7 && ccValueObj[channel] && ccValueObj[channel][cc]) {
      ccValueObj[channel][cc].set(value / 127.0);
    }
    // Kanal-unabhängige CCs (Knobs, Master, etc.)
    else if (ccValueObj[cc]) {
      // Relative Knobs
      if (cc == 13) { 
        ccValueObj[cc].set(value);
      }
      // Absolute CCs (0.0 - 1.0)
      else {
        ccValueObj[cc].set(value / 127.0);
      }
    }
  }
}


// ------ MIDI-AUSGANG (Chataigne -> Gerät) ------

/**
 * Wird aufgerufen, wenn sich ein Parameter in Chataigne ändert.
 * Findet die betroffene LED/Knob und sendet das MIDI-Update.
 */
function moduleParameterChanged(param) {
  var parent = param.parent;
  if (!parent) return;
  
  var grandParent = parent.parent;
  if (!grandParent) return;

  var name = param.name;
  var parentName = parent.name;
  var grandParentName = grandParent.name;

  // --- 1. RGB-LEDs (Clip Grid, Scene, Stop All) ---
  if (grandParentName == "Clip Grid (5x8)" || parentName == "Scene Launch" || parentName == "Global RGB") {
    // Finde das LED-Objekt, das zu diesem Parameter gehört
    var led = findLedByParam(param);
    if (led) updateLed(led);
  }
  
  // --- 2. Einfache LEDs (Track, Global) ---
  else if (grandParentName == "Track Control" || parentName == "Global Simple") {
    var led = findLedByParam(param);
    if (led) updateLed(led);
  }

  // --- 3. Animation-Parameter (Puls/Blink) ---
  else if (grandParentName.indexOf("Clip Grid") >= 0 || parentName.indexOf("Scene") >= 0 || parentName.indexOf("Global") >= 0 || parentName.indexOf("Track Stop") >= 0) {
    var led = findLedByParam(param);
    if (led) updateLed(led);
  }
  
  // --- 4. Knob-LEDs (CC-basiert) ---
  else if (grandParentName == "Knob LEDs (CC)") {
    var knobIndex = parseInt(name.split(" ")[1]);
    if (isNaN(knobIndex)) return;
    
    var knob = knobParams["knob." + knobIndex];
    if (knob) {
      if (parentName == "Track Knob Values") {
        script.sendCc(1, knob.valueCC, param.get()); // Sendet Wert (0-127)
      } else if (parentName == "Track Knob Types") {
        script.sendCc(1, knob.typeCC, param.get()); // Sendet Typ (0-3)
      }
    }
  }
}

/**
 * Hilfsfunktion: Findet das LED-Objekt (aus ledParams) für einen gegebenen Parameter.
 */
function findLedByParam(param) {
  for (var name in ledParams) {
    var led = ledParams[name];
    if (led.colorParam === param || led.pulseParam === param || led.blinkParam === param) {
      return led;
    }
  }
  return null;
}

/**
 * Hilfsfunktion: Sendet den korrekten MIDI-Befehl für eine LED
 * basierend auf ihrem vollen Zustand (Farbe, Puls, Blink).
 */
function updateLed(led) {
  var note = led.note;
  var channel = led.channel || 1; // Standard-Kanal 1
  var velocity = 0;

  // --- Einfache Boolean-LED (An/Aus) ---
  if (led.isSimple) {
    velocity = led.colorParam.get() ? 1 : 0;
    // (Kanal ist 1 für Global, 1-8 für Track)
  }
  
  // --- Track Stop LED (An/Aus/Blink) ---
  else if (led.isSimpleBlink) {
    var isBlinking = led.blinkParam ? led.blinkParam.get() : false;
    // var isOn = led.colorParam.get(); // Input-Wert
    // Note: Track Stop LEDs werden durch Note On (on/blink) oder Note Off (off) gesteuert.
    // Wir verwenden den Blink-Parameter, um zu entscheiden.
    if (isBlinking) {
        velocity = 2; // Velocity 2 = Blinken
    } else {
        velocity = 1; // Velocity 1 = An (wird durch Note Off von Input ausgeschaltet)
    }
    // Workaround: Da colorParam ein Input-Value ist, senden wir Note On, wenn blinken, sonst nichts
    if (!isBlinking) {
        script.sendNoteOff(channel, note, 0);
        return;
    }
    // (Kanal ist 1-8)
  }
  
  // --- Enum-LED (A/B) ---
  else if (led.isEnum) {
      velocity = led.colorParam.get(); // 0=Off, 1=Yellow, 2=Orange
      // (Kanal ist 1-8)
  }

  // --- RGB-LED (Grid, Scene, StopAll) ---
  else {
    var color = led.colorParam.get(); // [r, g, b]
    var isPulsing = led.pulseParam ? led.pulseParam.get() : false;
    var isBlinking = led.blinkParam ? led.blinkParam.get() : false;

    // 1. Kanal bestimmen (Puls/Blink hat Vorrang)
    if (isBlinking) {
      channel = 11; // 0x9A (Blink 1/24)
    } else if (isPulsing) {
      channel = 7; // 0x96 (Puls 1/24)
    } else {
      channel = 1; // 0x90 (Solid)
    }

    // 2. Velocity (Farbe) bestimmen
    velocity = rgbToVelocity(color[0], color[1], color[2]);
  }

  // 3. MIDI senden
  if (velocity == 0) {
    // Note Off auf *allen* relevanten Kanälen senden, um die LED sicher auszuschalten
    script.sendNoteOff(1, note, 0); // Solid
    script.sendNoteOff(7, note, 0); // Puls
    script.sendNoteOff(11, note, 0); // Blink
  } else {
    // Note On auf dem richtigen Kanal mit der richtigen Farbe
    script.sendNoteOn(channel, note, velocity);
  }
}


// ------ USER COMMANDS (aus module.json) ------

// --- Set Clip ---
function setClipColor(row, col, color) {
  var p = ledParams["clip." + (row - 1) + "." + (col - 1)];
  if (p) p.colorParam.set(color);
}
function setClipPulsing(row, col, pulsing) {
  var p = ledParams["clip." + (row - 1) + "." + (col - 1)];
  if (p) p.pulseParam.set(pulsing);
}
function setClipBlinking(row, col, blinking) {
  var p = ledParams["clip." + (row - 1) + "." + (col - 1)];
  if (p) p.blinkParam.set(blinking);
}

// --- Set Scene ---
function setSceneColor(index, color) {
  var p = ledParams["scene." + (index - 1)];
  if (p) p.colorParam.set(color);
}
function setScenePulsing(index, pulsing) {
  var p = ledParams["scene." + (index - 1)];
  if (p) p.pulseParam.set(pulsing);
}

// --- Set Track LEDs ---
function setTrackLedSimple(track, ledName, value) {
  // ledName ist "Record Arm", "Solo", "Activator", "Track Select"
  var p = ledParams["track." + track + "." + ledName];
  if (p) p.colorParam.set(value);
}
function setTrackLedAB(track, value) {
  // value ist 0 (Off), 1 (Yellow), 2 (Orange)
  var p = ledParams["track." + track + ".A/B"];
  if (p) p.colorParam.set(value);
}
function setTrackStopBlinking(track, blinking) {
    var p = ledParams["track." + track + ".Track Stop"];
    if (p) p.blinkParam.set(blinking);
}

// --- Set Knob LEDs ---
function setKnobValue(knob, value) {
  var p = knobParams["knob." + knob];
  if (p) p.valueParam.set(value);
}
function setKnobType(knob, type) {
  // type ist 0 (Off), 1 (Single), 2 (Volume), 3 (Pan)
  var p = knobParams["knob." + knob];
  if (p) p.typeParam.set(type);
}
