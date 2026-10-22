// Palantir kompyuter yordamchisi (macOS, JXA): sichqoncha va klaviatura. server/computer/desktop.ts chaqiradi:
//   osascript -l JavaScript mac-input.js '<json>'   → stdout'ga JSON
// Koordinatalar — ekran nuqtalarida (points; Retina'da piksellarning yarmi). Tizim: «Maxfiylik → Maxsus imkoniyatlar» ruxsati kerak.
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
ObjC.import('ApplicationServices');

const KEYCODES = {
  enter: 36, return: 36, tab: 48, space: 49, backspace: 51, delete: 117, del: 117, esc: 53, escape: 53,
  left: 123, right: 124, down: 125, up: 126, arrowleft: 123, arrowright: 124, arrowdown: 125, arrowup: 126,
  home: 115, end: 119, pageup: 116, page_up: 116, pagedown: 121, page_down: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  a: 0, b: 11, c: 8, d: 2, e: 14, f: 3, g: 5, h: 4, i: 34, j: 38, k: 40, l: 37, m: 46, n: 45, o: 31, p: 35, q: 12, r: 15, s: 1, t: 17, u: 32, v: 9, w: 13, x: 7, y: 16, z: 6,
  '0': 29, '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26, '8': 28, '9': 25,
  '-': 27, '=': 24, '[': 33, ']': 30, ';': 41, "'": 39, ',': 43, '.': 47, '/': 44, '\\': 42, '`': 50,
};
const FLAGS = { ctrl: $.kCGEventFlagMaskControl, control: $.kCGEventFlagMaskControl, alt: $.kCGEventFlagMaskAlternate, option: $.kCGEventFlagMaskAlternate, shift: $.kCGEventFlagMaskShift, super: $.kCGEventFlagMaskCommand, cmd: $.kCGEventFlagMaskCommand, command: $.kCGEventFlagMaskCommand, meta: $.kCGEventFlagMaskCommand, win: $.kCGEventFlagMaskCommand };

const post = ev => $.CGEventPost($.kCGHIDEventTap, ev);
const pause = s => { const until = Date.now() + s * 1000; while (Date.now() < until) { /* kutish */ } };

function flagsOf(mods) {
  let f = 0;
  for (const m of String(mods || '').split('+')) { const v = FLAGS[m.trim().toLowerCase()]; if (v) f |= v; }
  return f;
}

function mouse(type, x, y, button, flags, clicks) {
  const ev = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), button);
  if (flags) $.CGEventSetFlags(ev, flags);
  if (clicks) $.CGEventSetIntegerValueField(ev, $.kCGMouseEventClickState, clicks);
  post(ev);
}

function combo(text, holdSec) {
  const parts = String(text).split('+').map(p => p.trim()).filter(Boolean);
  let flags = 0, key = null;
  for (const p of parts) { const f = FLAGS[p.toLowerCase()]; if (f) flags |= f; else key = p; }
  if (key === null) throw new Error('tugma yo\'q: ' + text);
  const lower = key.toLowerCase();
  const code = KEYCODES[lower];
  if (code === undefined) throw new Error('noma\'lum tugma: ' + key);
  if (key.length === 1 && key !== lower) flags |= $.kCGEventFlagMaskShift;
  const down = $.CGEventCreateKeyboardEvent(null, code, true), up = $.CGEventCreateKeyboardEvent(null, code, false);
  $.CGEventSetFlags(down, flags); $.CGEventSetFlags(up, flags);
  post(down);
  pause(holdSec || 0.03);
  post(up);
}

function typeText(text) {
  // Matn (kirill, o' va boshqa belgilar bilan) — almashuv buferi orqali: avvalgisi saqlanib, keyin qaytariladi
  const pb = $.NSPasteboard.generalPasteboard;
  const before = pb.stringForType($.NSPasteboardTypeString);
  pb.clearContents;
  pb.setStringForType($(text), $.NSPasteboardTypeString);
  combo('cmd+v');
  pause(0.15);
  pb.clearContents;
  if (before && before.js !== undefined) pb.setStringForType(before, $.NSPasteboardTypeString);
}

function run(argv) {
  const c = JSON.parse(argv[0]);
  const BUTTON = { left: [$.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp, $.kCGMouseButtonLeft], right: [$.kCGEventRightMouseDown, $.kCGEventRightMouseUp, $.kCGMouseButtonRight], middle: [$.kCGEventOtherMouseDown, $.kCGEventOtherMouseUp, $.kCGMouseButtonCenter] };
  switch (c.cmd) {
    // trusted — «Maxsus imkoniyatlar» ruxsati: busiz sichqoncha va klaviatura hodisalari jimgina tashlab yuboriladi
    case 'points': { const b = $.CGDisplayBounds($.CGMainDisplayID()); return JSON.stringify({ ok: true, w: b.size.width, h: b.size.height, trusted: $.AXIsProcessTrusted() }); }
    case 'cursor': { const p = $.CGEventGetLocation($.CGEventCreate(null)); return JSON.stringify({ ok: true, x: p.x, y: p.y }); }
    case 'move': mouse($.kCGEventMouseMoved, c.x, c.y, $.kCGMouseButtonLeft, 0, 0); break;
    case 'click': {
      const [down, up, btn] = BUTTON[c.button] || BUTTON.left, flags = flagsOf(c.mods);
      mouse($.kCGEventMouseMoved, c.x, c.y, btn, 0, 0);
      for (let i = 1; i <= Math.max(1, c.count || 1); i++) { mouse(down, c.x, c.y, btn, flags, i); mouse(up, c.x, c.y, btn, flags, i); }
      break;
    }
    case 'down': { const p = $.CGEventGetLocation($.CGEventCreate(null)); mouse($.kCGEventLeftMouseDown, p.x, p.y, $.kCGMouseButtonLeft, 0, 1); break; }
    case 'up': { const p = $.CGEventGetLocation($.CGEventCreate(null)); mouse($.kCGEventLeftMouseUp, p.x, p.y, $.kCGMouseButtonLeft, 0, 1); break; }
    case 'drag': {
      mouse($.kCGEventLeftMouseDown, c.x0, c.y0, $.kCGMouseButtonLeft, 0, 1);
      for (let i = 1; i <= 12; i++) mouse($.kCGEventLeftMouseDragged, c.x0 + (c.x - c.x0) * i / 12, c.y0 + (c.y - c.y0) * i / 12, $.kCGMouseButtonLeft, 0, 0);
      mouse($.kCGEventLeftMouseUp, c.x, c.y, $.kCGMouseButtonLeft, 0, 1);
      break;
    }
    case 'scroll': {
      mouse($.kCGEventMouseMoved, c.x, c.y, $.kCGMouseButtonLeft, 0, 0);
      const ev = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 2, -(c.dy || 0) * 3, -(c.dx || 0) * 3);
      if (c.mods) $.CGEventSetFlags(ev, flagsOf(c.mods));
      post(ev);
      break;
    }
    case 'type': typeText(String(c.text || '')); break;
    case 'key': for (let i = 0; i < Math.max(1, c.repeat || 1); i++) for (const k of String(c.combo).split(/\s+/).filter(Boolean)) combo(k); break;
    case 'hold': combo(c.combo, (c.ms || 0) / 1000); break;
    default: throw new Error('noma\'lum buyruq: ' + c.cmd);
  }
  return JSON.stringify({ ok: true });
}
