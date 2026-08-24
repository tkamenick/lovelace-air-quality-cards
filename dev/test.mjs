import assert from 'node:assert/strict';

const registry = new Map();

globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ set id(_) {}, set rel(_) {}, set href(_) {} }),
  head: { appendChild: () => {} },
};
globalThis.HTMLElement = class {
  attachShadow() {
    this.shadowRoot = { innerHTML: '', querySelectorAll: () => [] };
    return this.shadowRoot;
  }
};
globalThis.customElements = {
  define: (name, constructor) => registry.set(name, constructor),
};
globalThis.requestAnimationFrame = (callback) => {
  callback();
  return 1;
};
globalThis.cancelAnimationFrame = () => {};

await import('../air-quality-cards.js');

const M = globalThis.__AIR_QUALITY_CARDS__;
assert.equal(M.VERSION, '0.1.0');
assert.deepEqual([...registry.keys()], [
  'air-quality-cards-overview',
  'air-quality-cards-room',
  'air-quality-cards-radon',
]);

const thresholds = M.mergeThresholds({});
const cases = [
  ['radon', 74, 0],
  ['radon', 75, 1],
  ['radon', 147, 1],
  ['radon', 148, 2],
  ['co2', 800, 0],
  ['co2', 801, 1],
  ['co2', 999, 1],
  ['co2', 1000, 2],
  ['pm25', 9, 0],
  ['pm25', 9.1, 1],
  ['pm25', 35.4, 1],
  ['pm25', 35.5, 2],
  ['voc', 250, 0],
  ['voc', 251, 1],
  ['voc', 499, 1],
  ['voc', 500, 2],
];

for (const [metric, value, expected] of cases) {
  assert.equal(M.metricState(metric, value, thresholds).severity, expected, `${metric} at ${value}`);
}

assert.equal(M.metricState('co2', Number.NaN, thresholds).severity, -1);
assert.throws(
  () => M.mergeThresholds({ thresholds: { co2: { good: 1200, action: 800 } } }),
  /good < action <= max/
);

const RoomCard = registry.get('air-quality-cards-room');
const roomCard = new RoomCard();
roomCard.setConfig({ room: { name: 'Test room', co2: 'sensor.test_co2' } });
assert.equal(roomCard._config.rooms.length, 1);
assert.equal(roomCard._config.rooms[0].co2, 'sensor.test_co2');
assert.deepEqual(roomCard.getGridOptions(), { columns: 12, rows: 7, min_columns: 6, min_rows: 6 });

roomCard.setConfig({
  room: {
    name: 'Average test',
    radon: 'sensor.radon_now',
    radon_average: 'sensor.radon_average',
  },
});
roomCard._hass = {
  states: {
    'sensor.radon_now': { state: '200', attributes: { unit_of_measurement: 'Bq/m³' } },
    'sensor.radon_average': { state: '20', attributes: { unit_of_measurement: 'Bq/m³' } },
  },
};
const averagedRadon = roomCard._rooms()[0].readings.find((reading) => reading.metric === 'radon');
assert.equal(averagedRadon.value, 20);
assert.equal(averagedRadon.current.value, 200);
assert.equal(averagedRadon.status.severity, 0);
assert.equal(averagedRadon.basis, 'average');

console.log(`air-quality-cards: ${cases.length + 10} assertions passed`);
