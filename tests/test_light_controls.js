'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadGuestScript() {
  const template = fs.readFileSync(path.join(ROOT, 'templates', 'guest_pwa.html'), 'utf8');
  const match = template.match(/<script nonce="\{\{ csp_nonce \}\}">([\s\S]*?)<\/script>/);
  assert(match, 'guest inline script should be present');
  return match[1]
    .replace(/^requestAnimationFrame\(updateThemeToggles\);\s*$/m, '')
    .replace(/^const SLUG = .*;$/m, "const SLUG = 'test';")
    .replace(/^const EXPIRES_AT = .*;$/m, 'const EXPIRES_AT = 9999999999999;')
    .replace(/^const NEVER_EXPIRES = .*;$/m, 'const NEVER_EXPIRES = 9999999999999;')
    .replace(/^init\(\);\s*$/m, '')
    .replace(/^showInstallBanner\(\);\s*$/m, '');
}

function makeContext() {
  const listeners = {};
  const elements = new Map();
  const document = {
    activeElement: null,
    visibilityState: 'visible',
    documentElement: { classList: { contains: () => false } },
    addEventListener(type, handler) { listeners[type] = handler; },
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll() { return []; },
    createElement() { return { innerHTML: '', firstElementChild: null, classList: { add() {}, remove() {} } }; },
    createTextNode(text) { return { textContent: text }; },
  };
  const requests = [];
  const context = vm.createContext({
    console,
    document,
    navigator: {},
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame() {},
    setInterval() { return 0; },
    clearInterval() {},
    setTimeout(callback) { callback(); return 0; },
    clearTimeout() {},
    EventSource: function EventSource() {},
    fetch: async (_url, options) => {
      if (options?.body) requests.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'static', 'util.js'), 'utf8'), context, { filename: 'util.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'static', 'domains.js'), 'utf8'), context, { filename: 'domains.js' });
  vm.runInContext(loadGuestScript(), context, { filename: 'guest_pwa.html' });
  return { context, document, elements, listeners, requests };
}

function state(attributes = {}, state = 'on') {
  return { state, attributes: { friendly_name: 'Lamp', ...attributes } };
}

function fakeClassList() {
  return { toggle() {}, add() {}, remove() {} };
}

function focusedCard(context, document, elements, lightState) {
  const slider = {
    value: '50',
    dataset: { rangeAction: 'brightness' },
  };
  const color = { value: '#ff0000', dataset: { colorAction: 'rgb' } };
  const temperature = { value: '3000', dataset: { rangeAction: 'color-temp' } };
  const controls = {
    dataset: { lightCapabilityKey: context.lightCapabilityKey(lightState) },
    contains(element) { return element === slider || element === color || element === temperature; },
    querySelector(selector) {
      if (selector === '[data-range-action="brightness"]') return slider;
      if (selector === '[data-color-action="rgb"]') return color;
      if (selector === '[data-range-action="color-temp"]') return temperature;
      if (selector === '[data-eid]') return { dataset: { eid: 'light.lamp' } };
      return null;
    },
  };
  let replaced = false;
  const card = {
    classList: fakeClassList(),
    parentElement: { replaceChild() { replaced = true; } },
    querySelector(selector) {
      if (selector === '.toggle-track') return null;
      if (selector === '[data-light-controls]') return controls;
      return null;
    },
  };
  controls.closest = selector => selector === '[data-light-controls]' ? controls : null;
  slider.closest = selector => selector === '[data-light-controls]' ? controls : null;
  elements.set('card-light-lamp', card);
  elements.set('bri-light-lamp', { textContent: '50%' });
  elements.set('color-light-lamp', { textContent: '#ff0000' });
  elements.set('ct-light-lamp', { textContent: '3000 K' });
  return { card, slider, color, temperature, controls, wasReplaced: () => replaced };
}

async function main() {
  const { context, document, elements, listeners, requests } = makeContext();

  assert.equal(
    context.buildLightControls('light.onoff', state({ supported_color_modes: ['onoff'] })),
    '',
    'onoff-only lights must not show a brightness or color control',
  );
  const brightnessMarkup = context.buildLightControls(
    'light.dimmer', state({ supported_color_modes: ['brightness'], brightness: 128 }),
  );
  assert.match(brightnessMarkup, /data-range-action="brightness"/);
  assert.doesNotMatch(brightnessMarkup, /type="color"/);

  for (const mode of ['rgb', 'rgbw', 'rgbww', 'hs', 'xy']) {
    const markup = context.buildLightControls(
      `light.${mode}`,
      state({ supported_color_modes: [mode], rgb_color: [17, 34, 51], hs_color: [210, 67, 20] }),
    );
    assert.match(markup, /<input type="color"/);
    assert.match(markup, /data-color-action="rgb"/);
  }

  const kelvinState = state({
    supported_color_modes: ['color_temp'],
    min_color_temp_kelvin: 2700,
    max_color_temp_kelvin: 6500,
    color_temp_kelvin: 3200,
  });
  const kelvinMarkup = context.buildLightControls('light.kelvin', kelvinState);
  assert.match(kelvinMarkup, /min="2700" max="6500"/);
  assert.match(kelvinMarkup, /value="3200"/);
  assert.deepEqual(JSON.parse(JSON.stringify(context.colorTempBounds(state({
    supported_color_modes: ['color_temp'], min_mireds: 153, max_mireds: 500,
  })))), { min: 2000, max: 6536 });

  const miredMarkup = context.buildLightControls('light.mired', state({
    supported_color_modes: ['color_temp'], min_mireds: 153, max_mireds: 500, color_temp: 370,
  }));
  assert.match(miredMarkup, /min="2000" max="6536"/);
  assert.match(miredMarkup, /value="2703"/);

  vm.runInContext(`states = {
    'light.rgb': ${JSON.stringify(state({ supported_color_modes: ['rgb'], rgb_color: [0, 0, 0] }))},
    'light.kelvin': ${JSON.stringify(kelvinState)},
    'light.onoff': ${JSON.stringify(state({ supported_color_modes: ['onoff'] }))},
  };`, context);

  await context.sendColor('light.rgb', '#12abef');
  assert.deepEqual(requests.at(-1), {
    entity_id: 'light.rgb', service: 'light.turn_on', data: { rgb_color: [18, 171, 239] },
  });
  const requestCount = requests.length;
  await context.sendColor('light.rgb', 'invalid');
  await context.sendColor('light.onoff', '#123456');
  assert.equal(requests.length, requestCount, 'invalid and unsupported color changes must not send');

  await context.sendColorTemp('light.kelvin', 1000);
  assert.deepEqual(requests.at(-1).data, { color_temp_kelvin: 2700 });
  await context.sendColorTemp('light.kelvin', 8000);
  assert.deepEqual(requests.at(-1).data, { color_temp_kelvin: 6500 });

  const colorTarget = { value: '#abcdef', dataset: { colorAction: 'rgb', eid: 'light.rgb' } };
  listeners.change({ target: colorTarget });
  assert.deepEqual(requests.at(-1).data, { rgb_color: [171, 205, 239] });
  const tempTarget = { value: '2800', dataset: { rangeAction: 'color-temp', eid: 'light.kelvin' } };
  listeners.change({ target: tempTarget });
  assert.deepEqual(requests.at(-1).data, { color_temp_kelvin: 2800 });

  const unsafeName = '<img src=x onerror=alert(1)>&"';
  const escaped = context.buildCard('light.unsafe', state({
    friendly_name: unsafeName, supported_color_modes: ['onoff'],
  }));
  assert.ok(escaped.includes('&lt;img src=x onerror=alert(1)&gt;&amp;&quot;'));
  assert.ok(!escaped.includes(unsafeName));

  const activeState = state({ supported_color_modes: ['brightness'], brightness: 128 });
  vm.runInContext(`states = { 'light.lamp': ${JSON.stringify(activeState)} };`, context);
  const active = focusedCard(context, document, elements, activeState);
  document.activeElement = active.slider;
  context.updateLightCard('light.lamp', state({ supported_color_modes: ['brightness'], brightness: 230 }), active.card);
  assert.equal(active.slider.value, '50', 'SSE brightness updates must not move the active slider');
  document.activeElement = null;
  context.updateLightCard('light.lamp', state({ supported_color_modes: ['brightness'], brightness: 230 }), active.card);
  assert.equal(active.slider.value, String(Math.round((230 / 255) * 100)));

  vm.runInContext(`states['light.lamp'] = ${JSON.stringify(state({ supported_color_modes: ['brightness'] }, 'off'))};`, context);
  document.activeElement = active.slider;
  context.updateLightCard('light.lamp', state({ supported_color_modes: ['brightness'] }, 'off'), active.card);
  assert.equal(active.wasReplaced(), false, 'an active control must defer an off-state replacement');
  document.activeElement = null;
  listeners.focusout({ target: active.slider });
  assert.equal(active.wasReplaced(), true, 'focusout must reconcile the deferred off-state update');

  console.log('light controls tests passed');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
