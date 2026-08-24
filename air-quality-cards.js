/*! Air Quality Cards — a Lovelace card set for Home Assistant
 *  https://github.com/tkamenick/lovelace-air-quality-cards
 *
 *  Five cards:
 *    · custom:air-quality-cards-overview — whole-home air status and room comparison
 *    · custom:air-quality-cards-room     — one room, with four pollutant ranges
 *    · custom:air-quality-cards-radon    — radon comparison with the EPA action line
 *    · custom:air-quality-cards-trend    — normalized small-multiple pollutant history
 *    · custom:air-quality-cards-radon-trend — multi-room long-term radon history
 *
 *  No external dependencies. Sensor entities and thresholds are configurable.
 */
(() => {
  'use strict';

  const VERSION = '0.2.0';
  const REPO = 'https://github.com/tkamenick/lovelace-air-quality-cards';

  const ACCENTS = {
    dark: {
      amber: '#f2a35c',
      blue: '#8fa8d9',
      green: '#a8d98f',
      pink: '#d98fa8',
      red: '#ed7b72',
    },
    light: {
      amber: '#a8620f',
      blue: '#4f74ad',
      green: '#4a7a30',
      pink: '#a33c62',
      red: '#b7443d',
    },
  };

  const NEUTRALS = {
    text: 'var(--primary-text-color, #e8e6e1)',
    ink: 'var(--primary-text-color, #c9c7c2)',
    dim: 'var(--secondary-text-color, #8b8d96)',
    faint: 'var(--disabled-text-color, #565963)',
    ghost: 'var(--disabled-text-color, #3a3d46)',
    line: 'var(--primary-text-color, #ffffff)',
    divider: 'var(--divider-color, rgba(255,255,255,0.08))',
    surface: 'var(--ha-card-background, var(--card-background-color, #1c1c1c))',
  };

  const palette = (darkMode) => {
    const a = darkMode ? ACCENTS.dark : ACCENTS.light;
    return { ...NEUTRALS, ...a, good: a.green, watch: a.amber, action: a.red };
  };

  const MONO = "'Fragment Mono',ui-monospace,SFMono-Regular,Menlo,monospace";
  const SANS = "'Familjen Grotesk','Instrument Sans',system-ui,-apple-system,sans-serif";
  const MONO_SVG = 'Fragment Mono, ui-monospace, Menlo, monospace';
  const SANS_SVG = 'Familjen Grotesk, system-ui, sans-serif';
  const FONTS_URL =
    'https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&family=Fragment+Mono&display=swap';

  function loadFonts() {
    if (document.getElementById('air-quality-cards-fonts')) return;
    const link = document.createElement('link');
    link.id = 'air-quality-cards-fonts';
    link.rel = 'stylesheet';
    link.href = FONTS_URL;
    document.head.appendChild(link);
  }

  const esc = (value) =>
    String(value).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (value) => {
    if (value === '' || value == null || value === 'unknown' || value === 'unavailable') return NaN;
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  };

  const METRIC_ORDER = ['radon', 'co2', 'pm25', 'voc'];
  const METRIC_ACCENTS = { radon: 'pink', co2: 'blue', pm25: 'green', voc: 'amber' };
  const METRICS = {
    radon: {
      label: 'Radon',
      short: 'Rn',
      unit: 'Bq/m³',
      decimals: 0,
      thresholds: { good: 74, action: 148, max: 300 },
      labels: ['low', 'consider', 'action level'],
    },
    co2: {
      label: 'CO₂',
      short: 'CO₂',
      unit: 'ppm',
      decimals: 0,
      thresholds: { good: 800, action: 1000, max: 1800 },
      labels: ['fresh', 'elevated', 'ventilate'],
    },
    pm25: {
      label: 'PM2.5',
      short: 'PM₂.₅',
      unit: 'µg/m³',
      decimals: 0,
      thresholds: { good: 9, action: 35.5, max: 75 },
      labels: ['good', 'moderate', 'unhealthy'],
    },
    voc: {
      label: 'VOCs',
      short: 'VOC',
      unit: 'ppb',
      decimals: 0,
      thresholds: { good: 250, action: 500, max: 1000 },
      labels: ['low', 'elevated', 'high'],
    },
  };

  function mergeThresholds(config) {
    const input = config?.thresholds || {};
    const out = {};
    for (const key of METRIC_ORDER) {
      const base = METRICS[key].thresholds;
      const override = input[key] || {};
      const good = finite(override.good);
      const action = finite(override.action);
      const max = finite(override.max);
      out[key] = {
        good: Number.isFinite(good) ? good : base.good,
        action: Number.isFinite(action) ? action : base.action,
        max: Number.isFinite(max) ? max : base.max,
      };
      if (!(out[key].good < out[key].action && out[key].action <= out[key].max)) {
        throw new Error(`air-quality-cards: thresholds.${key} must satisfy good < action <= max`);
      }
    }
    return out;
  }

  function normalizeRoom(room, index) {
    if (!room || typeof room !== 'object') throw new Error(`air-quality-cards: rooms[${index}] must be an object`);
    return {
      name: room.name || `Room ${index + 1}`,
      radon: room.radon || null,
      radon_average: room.radon_average || room.radon_30d || null,
      co2: room.co2 || null,
      pm25: room.pm25 || room.pm2_5 || null,
      voc: room.voc || room.tvoc || null,
      temperature: room.temperature || null,
      humidity: room.humidity || null,
    };
  }

  function metricState(metric, value, thresholds) {
    if (!Number.isFinite(value)) return { severity: -1, key: 'missing', label: 'unavailable' };
    const cfg = METRICS[metric];
    const t = thresholds[metric];
    const severity = value <= t.good ? 0 : value < t.action ? 1 : 2;
    return { severity, key: severity === 0 ? 'good' : severity === 1 ? 'watch' : 'action', label: cfg.labels[severity] };
  }

  function stateFor(hass, entity, metric) {
    const state = entity ? hass?.states?.[entity] : null;
    const value = state ? finite(state.state) : NaN;
    const cfg = METRICS[metric];
    return {
      entity,
      value,
      available: Number.isFinite(value),
      unit: state?.attributes?.unit_of_measurement || cfg?.unit || '',
      updated: state?.last_updated || state?.last_changed || null,
    };
  }

  function auxiliaryState(hass, entity, fallbackUnit) {
    const state = entity ? hass?.states?.[entity] : null;
    const value = state ? finite(state.state) : NaN;
    return {
      entity,
      value,
      available: Number.isFinite(value),
      unit: state?.attributes?.unit_of_measurement || fallbackUnit,
      updated: state?.last_updated || state?.last_changed || null,
    };
  }

  function roomReadings(hass, room, thresholds) {
    const readings = METRIC_ORDER.map((metric) => {
      const current = stateFor(hass, room[metric], metric);
      const average = metric === 'radon' ? auxiliaryState(hass, room.radon_average, current.unit || METRICS.radon.unit) : null;
      const reading = average?.available ? average : current;
      return {
        metric,
        ...reading,
        current,
        average,
        basis: average?.available ? 'average' : 'current',
        displayLabel: average?.available ? 'Radon avg' : METRICS[metric].label,
        status: metricState(metric, reading.value, thresholds),
      };
    });
    const available = readings.filter((r) => r.available);
    const worst = available.sort((a, b) => {
      if (b.status.severity !== a.status.severity) return b.status.severity - a.status.severity;
      const ar = a.value / thresholds[a.metric].action;
      const br = b.value / thresholds[b.metric].action;
      return br - ar;
    })[0] || null;
    return {
      room,
      readings,
      worst,
      severity: worst ? worst.status.severity : -1,
      temperature: auxiliaryState(hass, room.temperature, '°'),
      humidity: auxiliaryState(hass, room.humidity, '%'),
    };
  }

  const severityCopy = (severity) => {
    if (severity === 0) return { title: 'Air looks good', short: 'GOOD', note: 'all configured readings are in range' };
    if (severity === 1) return { title: 'Worth a look', short: 'ELEVATED', note: 'one or more readings are elevated' };
    if (severity === 2) return { title: 'Action recommended', short: 'ACTION', note: 'one or more readings crossed an action threshold' };
    return { title: 'No readings', short: 'NO DATA', note: 'configured sensors are unavailable' };
  };

  function colorFor(C, severity) {
    return severity === 0 ? C.good : severity === 1 ? C.watch : severity === 2 ? C.action : C.faint;
  }

  function formatValue(metric, reading, includeUnit = true) {
    if (!reading?.available) return '—';
    const cfg = METRICS[metric];
    const value = reading.value.toLocaleString(undefined, {
      minimumFractionDigits: cfg.decimals,
      maximumFractionDigits: cfg.decimals,
    });
    return includeUnit ? `${value} ${reading.unit || cfg.unit}` : value;
  }

  function formatAux(reading, decimals = 0) {
    if (!reading?.available) return '—';
    return `${reading.value.toLocaleString(undefined, { maximumFractionDigits: decimals })}${reading.unit === '%' ? '%' : ` ${reading.unit}`}`;
  }

  function freshestAge(groups) {
    const times = groups
      .flatMap((group) => group.readings || [])
      .map((r) => (r.updated ? new Date(r.updated).getTime() : NaN))
      .filter(Number.isFinite);
    if (!times.length) return 'update unknown';
    const ms = Math.max(0, Date.now() - Math.max(...times));
    if (ms < 90000) return 'updated now';
    if (ms < 3600000) return `updated ${Math.round(ms / 60000)}m ago`;
    return `updated ${Math.round(ms / 3600000)}h ago`;
  }

  function polar(cx, cy, radius, degrees) {
    const a = ((degrees - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  }

  function arcPath(cx, cy, radius, start, end) {
    const a = polar(cx, cy, radius, start);
    const b = polar(cx, cy, radius, end);
    const large = end - start > 180 ? 1 : 0;
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  }

  function airDial(summary, thresholds, C) {
    const aggregate = METRIC_ORDER.map((metric) => {
      const candidates = summary.flatMap((room) => room.readings).filter((r) => r.metric === metric && r.available);
      const reading = candidates.sort((a, b) => b.value - a.value)[0] || { metric, available: false, value: NaN, status: metricState(metric, NaN, thresholds) };
      return reading;
    });
    const arcs = [
      { start: -80, end: -10 },
      { start: 10, end: 80 },
      { start: 100, end: 170 },
      { start: 190, end: 260 },
    ];
    const stroke = aggregate
      .map((r, i) => {
        const a = arcs[i];
        const fraction = r.available ? clamp(r.value / thresholds[r.metric].max, 0.04, 1) : 0;
        const liveEnd = a.start + (a.end - a.start) * fraction;
        const color = colorFor(C, r.status.severity);
        const mid = (a.start + a.end) / 2;
        const label = polar(120, 120, 102, mid);
        return `
          <path d="${arcPath(120, 120, 78, a.start, a.end)}" fill="none" stroke="${C.line}" stroke-opacity="0.09" stroke-width="13" stroke-linecap="round"></path>
          ${r.available ? `<path d="${arcPath(120, 120, 78, a.start, liveEnd)}" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round"></path>` : ''}
          <text x="${label.x.toFixed(1)}" y="${(label.y + 3).toFixed(1)}" text-anchor="middle" fill="${r.available ? C.dim : C.ghost}" font-family="${MONO_SVG}" font-size="10">${METRICS[r.metric].short}</text>`;
      })
      .join('');
    const worstSeverity = Math.max(-1, ...summary.map((r) => r.severity));
    const copy = severityCopy(worstSeverity);
    const centerColor = colorFor(C, worstSeverity);
    const aria = `${copy.title}. ${aggregate.map((r) => `${METRICS[r.metric].label} ${formatValue(r.metric, r)}`).join(', ')}`;
    return `<svg viewBox="0 0 240 240" role="img" aria-label="${esc(aria)}" style="display:block; width:100%; height:auto; overflow:visible;">
      ${stroke}
      <g fill="none" stroke="${centerColor}" stroke-width="2" stroke-linecap="round" opacity="0.75">
        <path d="M88 111 C101 96 112 96 124 111 S148 126 154 106"></path>
        <path d="M88 125 C101 110 112 110 124 125 S148 140 154 120" opacity="0.6"></path>
        <path d="M94 139 C105 128 115 128 126 139 S145 149 151 134" opacity="0.35"></path>
      </g>
      <text x="120" y="169" text-anchor="middle" fill="${centerColor}" font-family="${MONO_SVG}" font-size="11" letter-spacing="1.4">${copy.short}</text>
    </svg>`;
  }

  function contextChip(label, reading, entity, C) {
    const clickable = entity ? ` data-entity="${esc(entity)}" role="button" tabindex="0"` : '';
    return `<span${clickable} style="display:flex; align-items:center; gap:8px; min-width:0;${entity ? ' cursor:pointer;' : ''}">
      <span style="font-family:${MONO}; font-size:10px; color:${C.faint}; text-transform:uppercase; letter-spacing:0.08em;">${label}</span>
      <span style="font-size:14px; color:${C.ink}; white-space:nowrap;">${reading}</span>
    </span>`;
  }

  function durationLabel(milliseconds) {
    const hours = Math.round(milliseconds / 3600000);
    if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  function timeTick(timestamp, spanMs) {
    const date = new Date(timestamp);
    if (spanMs <= 48 * 3600000) {
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
    }
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  function statisticsPoints(rows, stat = 'mean', startTime = -Infinity, endTime = Infinity) {
    return (Array.isArray(rows) ? rows : [])
      .map((row) => ({ t: finite(row?.start), value: finite(row?.[stat]) }))
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.value) && point.t >= startTime && point.t <= endTime)
      .sort((a, b) => a.t - b.t);
  }

  function plotPoints(points, bounds) {
    const spanX = Math.max(1, bounds.end - bounds.start);
    const spanY = Math.max(0.0001, bounds.max - bounds.min);
    return points.map((point) => ({
      ...point,
      x: bounds.left + ((point.t - bounds.start) / spanX) * (bounds.right - bounds.left),
      y: bounds.bottom - ((point.value - bounds.min) / spanY) * (bounds.bottom - bounds.top),
    }));
  }

  function linePath(points) {
    return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  }

  function areaPath(points, bottom) {
    if (!points.length) return '';
    return `${linePath(points)} L ${points[points.length - 1].x.toFixed(2)} ${bottom.toFixed(2)} L ${points[0].x.toFixed(2)} ${bottom.toFixed(2)} Z`;
  }

  function metricForSeries(series) {
    if (METRICS[series.metric]) return series.metric;
    const haystack = `${series.entity || ''} ${series.name || ''}`.toLowerCase();
    if (haystack.includes('radon')) return 'radon';
    if (haystack.includes('carbon_dioxide') || haystack.includes('co2') || haystack.includes('co₂')) return 'co2';
    if (haystack.includes('pm2') || haystack.includes('pm25')) return 'pm25';
    if (haystack.includes('voc')) return 'voc';
    return null;
  }

  function currentSeriesReading(hass, series) {
    const metric = metricForSeries(series);
    const state = hass?.states?.[series.entity];
    const value = state ? finite(state.state) : NaN;
    return {
      entity: series.entity,
      value,
      available: Number.isFinite(value),
      unit: state?.attributes?.unit_of_measurement || (metric ? METRICS[metric].unit : ''),
      metric,
    };
  }

  class AirQualityCardsBase extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._signatureValue = null;
    }

    setConfig(config) {
      const cfg = { ...this.constructor.defaults, ...(config || {}) };
      const rawRooms = Array.isArray(cfg.rooms) && cfg.rooms.length ? cfg.rooms : cfg.room ? [cfg.room] : [];
      if (!Array.isArray(rawRooms)) throw new Error('air-quality-cards: "rooms" must be a list');
      cfg.rooms = rawRooms.map(normalizeRoom);
      cfg.thresholds = mergeThresholds(cfg);
      this._config = cfg;
      this._signatureValue = null;
      if (this._hass) this._render();
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      if (this._config.load_fonts !== false) loadFonts();
      const signature = this._signature();
      if (signature !== this._signatureValue) {
        this._signatureValue = signature;
        this._render();
      }
    }

    get hass() {
      return this._hass;
    }

    connectedCallback() {
      this._timer = setInterval(() => {
        if (this._hass && this._config) this._render();
      }, 60000);
      if (this._hass && this._config) this._render();
    }

    disconnectedCallback() {
      clearInterval(this._timer);
    }

    _entityIds() {
      return this._config.rooms.flatMap((room) =>
        ['radon', 'radon_average', 'co2', 'pm25', 'voc', 'temperature', 'humidity'].map((key) => room[key]).filter(Boolean)
      );
    }

    _signature() {
      return [
        this._hass?.themes?.darkMode,
        ...this._entityIds().map((id) => {
          const state = this._hass?.states?.[id];
          return `${id}:${state?.state || ''}:${state?.last_updated || state?.last_changed || ''}`;
        }),
      ].join('|');
    }

    _rooms() {
      return this._config.rooms.map((room) => roomReadings(this._hass, room, this._config.thresholds));
    }

    _pal() {
      return palette(this._hass?.themes?.darkMode !== false);
    }

    _card(inner) {
      const C = this._pal();
      return `<ha-card style="display:flex; flex-direction:column; box-sizing:border-box; height:100%; padding:24px 26px 22px; color:${C.text}; font-family:${SANS};">${inner}</ha-card>`;
    }

    _header(left, right, rightColor) {
      const C = this._pal();
      const meta = `<div style="font-family:${MONO}; font-size:11px; color:${rightColor || C.faint}; white-space:nowrap;">${esc(right)}</div>`;
      if (!left) return `<div style="display:flex; align-items:baseline;">${meta}</div>`;
      return `<div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px;">
        <div style="font-family:${MONO}; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${C.dim}; white-space:nowrap;">${esc(left)}</div>
        ${meta}
      </div>`;
    }

    _render() {
      let html;
      try {
        html = this._template();
      } catch (error) {
        html = `<ha-card style="display:block; padding:16px; font-family:${MONO}; font-size:12px;">air-quality-cards error: ${esc(error?.message || error)}</ha-card>`;
      }
      this.shadowRoot.innerHTML = html;
      this.shadowRoot.querySelectorAll('[data-entity]').forEach((el) => {
        const open = () => {
          this.dispatchEvent(
            new CustomEvent('hass-more-info', {
              bubbles: true,
              composed: true,
              detail: { entityId: el.dataset.entity },
            })
          );
        };
        el.addEventListener('click', open);
        el.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
      });
    }

    getCardSize() {
      return this.constructor.cardSize || 6;
    }

    getGridOptions() {
      return { columns: 12, rows: 6, min_columns: 6, min_rows: 4 };
    }

    static getStubConfig() {
      return {};
    }
  }

  class AirQualityCardsOverview extends AirQualityCardsBase {
    static defaults = { name: '', rooms: [], load_fonts: true };
    static cardSize = 7;

    getGridOptions() {
      return { columns: 'full', rows: 'auto', min_columns: 6 };
    }

    static getStubConfig() {
      return {
        rooms: [
          { name: 'Upstairs', co2: 'sensor.upstairs_co2', pm25: 'sensor.upstairs_pm2_5', voc: 'sensor.upstairs_voc' },
          { name: 'Basement', co2: 'sensor.basement_co2', pm25: 'sensor.basement_pm2_5', voc: 'sensor.basement_voc' },
        ],
      };
    }

    _template() {
      const C = this._pal();
      const groups = this._rooms();
      if (!groups.length) throw new Error('overview needs at least one room');
      const severity = Math.max(-1, ...groups.map((group) => group.severity));
      const copy = severityCopy(severity);
      const worstRoom = groups
        .filter((group) => group.worst)
        .sort((a, b) => {
          if (b.severity !== a.severity) return b.severity - a.severity;
          return b.worst.value / this._config.thresholds[b.worst.metric].action - a.worst.value / this._config.thresholds[a.worst.metric].action;
        })[0];
      const focus = worstRoom
        ? `${worstRoom.room.name} · ${worstRoom.worst.displayLabel} ${formatValue(worstRoom.worst.metric, worstRoom.worst)}`
        : 'No available sensors';
      const dial = airDial(groups, this._config.thresholds, C);

      const roomPanels = groups
        .map((group) => {
          const roomColor = colorFor(C, group.severity);
          const rows = group.readings
            .map((reading) => {
              const color = colorFor(C, reading.status.severity);
              const clickable = reading.entity ? ` data-entity="${esc(reading.entity)}" role="button" tabindex="0"` : '';
              return `<div${clickable} class="metric" style="${reading.entity ? 'cursor:pointer;' : ''}">
                <span class="dot" style="background:${color};${reading.status.severity < 0 ? ` border:1px solid ${C.faint}; background:transparent;` : ''}"></span>
                <span class="metric-name">${reading.displayLabel}</span>
                <span class="metric-value">${formatValue(reading.metric, reading)}</span>
              </div>`;
            })
            .join('');
          return `<section class="room">
            <div class="room-head">
              <span>${esc(group.room.name)}</span>
              <span class="room-state" style="color:${roomColor};">${severityCopy(group.severity).short.toLowerCase()}</span>
            </div>
            <div class="metrics">${rows}</div>
            <div class="context">
              ${contextChip('temp', formatAux(group.temperature, 1), group.temperature.entity, C)}
              ${contextChip('humidity', formatAux(group.humidity), group.humidity.entity, C)}
            </div>
          </section>`;
        })
        .join('');

      const style = `<style>
        .wrap { container-type:inline-size; display:flex; flex-direction:column; flex:1 1 auto; min-width:0; }
        .body { display:flex; gap:clamp(20px,4%,44px); align-items:center; padding-top:10px; }
        .hero { flex:0 0 min(28%,250px); min-width:210px; }
        .dial { width:100%; max-width:240px; margin:auto; }
        .copy { margin-top:-8px; }
        .title { font-size:28px; line-height:1.05; font-weight:600; letter-spacing:-0.02em; color:${C.text}; }
        .note { margin-top:7px; font-family:${MONO}; font-size:10px; line-height:1.45; color:${C.dim}; }
        .rooms { flex:1 1 auto; min-width:0; display:grid; grid-template-columns:repeat(${Math.min(groups.length, 3)},minmax(0,1fr)); gap:0; }
        .room { min-width:0; padding:4px 20px 2px; border-left:1px solid ${C.divider}; }
        .room-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:18px; font-size:17px; font-weight:600; }
        .room-state { font-family:${MONO}; font-size:9px; letter-spacing:0.08em; text-transform:uppercase; white-space:nowrap; }
        .metrics { display:flex; flex-direction:column; gap:13px; }
        .metric { display:grid; grid-template-columns:8px minmax(44px,1fr) auto; align-items:center; gap:9px; min-width:0; }
        .dot { width:7px; height:7px; border-radius:99px; box-sizing:border-box; }
        .metric-name { font-family:${MONO}; font-size:10px; color:${C.dim}; }
        .metric-value { font-size:14px; color:${C.ink}; white-space:nowrap; }
        .context { display:flex; flex-wrap:wrap; gap:14px; padding-top:18px; margin-top:18px; border-top:1px solid ${C.divider}; }
        .foot { display:flex; gap:18px; align-items:center; justify-content:space-between; padding-top:15px; margin-top:16px; border-top:1px solid ${C.divider}; font-family:${MONO}; font-size:10px; color:${C.faint}; }
        .focus { color:${colorFor(C, severity)}; }
        @container (max-width: 720px) {
          .body { align-items:flex-start; }
          .hero { flex-basis:190px; min-width:170px; }
          .rooms { grid-template-columns:1fr; }
          .room { padding:8px 0 18px 22px; }
        }
        @container (max-width: 500px) {
          .body { flex-direction:column; gap:12px; }
          .hero { display:grid; grid-template-columns:130px 1fr; gap:14px; align-items:center; width:100%; min-width:0; }
          .copy { margin-top:0; }
          .title { font-size:24px; }
          .rooms { width:100%; }
          .room { border-left:0; border-top:1px solid ${C.divider}; padding:20px 0; }
          .foot { align-items:flex-start; flex-direction:column; gap:6px; }
        }
      </style>`;

      return this._card(`${this._header(this._config.name, `whole home · ${groups.length} ${groups.length === 1 ? 'room' : 'rooms'}`)}
        ${style}
        <div class="wrap">
          <div class="body">
            <div class="hero">
              <div class="dial">${dial}</div>
              <div class="copy">
                <div class="title">${copy.title}</div>
                <div class="note">${copy.note}</div>
              </div>
            </div>
            <div class="rooms">${roomPanels}</div>
          </div>
          <div class="foot"><span class="focus">focus · ${esc(focus)}</span><span>${freshestAge(groups)}</span></div>
        </div>`);
    }
  }

  function rangeBar(reading, thresholds, C) {
    const metric = reading.metric;
    const t = thresholds[metric];
    const valuePos = reading.available ? clamp((reading.value / t.max) * 100, 0, 100) : 0;
    const goodPos = clamp((t.good / t.max) * 100, 0, 100);
    const actionPos = clamp((t.action / t.max) * 100, 0, 100);
    const color = colorFor(C, reading.status.severity);
    return `<div class="bar" aria-hidden="true">
      <div class="bar-fill" style="width:${valuePos.toFixed(1)}%; background:${color};"></div>
      <span class="tick" style="left:${goodPos.toFixed(1)}%;"></span>
      <span class="tick" style="left:${actionPos.toFixed(1)}%;"></span>
      ${reading.available ? `<span class="marker" style="left:${valuePos.toFixed(1)}%; border-color:${color}; background:${C.surface};"></span>` : ''}
    </div>`;
  }

  class AirQualityCardsRoom extends AirQualityCardsBase {
    static defaults = { name: '', room: null, rooms: [], load_fonts: true };
    static cardSize = 7;

    getGridOptions() {
      return { columns: 12, rows: 7, min_columns: 6, min_rows: 6 };
    }

    static getStubConfig() {
      return {
        room: {
          name: 'Upstairs',
          co2: 'sensor.upstairs_co2',
          pm25: 'sensor.upstairs_pm2_5',
          voc: 'sensor.upstairs_voc',
          temperature: 'sensor.upstairs_temperature',
          humidity: 'sensor.upstairs_humidity',
        },
      };
    }

    _template() {
      const C = this._pal();
      const group = this._rooms()[0];
      if (!group) throw new Error('room card needs a "room" object');
      const copy = severityCopy(group.severity);
      const statusColor = colorFor(C, group.severity);
      const focus = group.worst
        ? `${group.worst.displayLabel} · ${group.worst.status.label}`
        : 'waiting for sensors';
      const rows = group.readings
        .map((reading) => {
          const color = colorFor(C, reading.status.severity);
          const clickable = reading.entity ? ` data-entity="${esc(reading.entity)}" role="button" tabindex="0"` : '';
          return `<div${clickable} class="reading" style="${reading.entity ? 'cursor:pointer;' : ''}">
            <div class="reading-head">
              <span class="reading-name">${reading.displayLabel}</span>
              <span class="reading-state" style="color:${color};">${reading.status.label}</span>
              <span class="reading-value">${formatValue(reading.metric, reading)}</span>
            </div>
            ${rangeBar(reading, this._config.thresholds, C)}
          </div>`;
        })
        .join('');
      const style = `<style>
        .wrap { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; }
        .hero { display:flex; align-items:baseline; justify-content:space-between; gap:14px; padding:16px 0 17px; }
        .status { font-size:30px; line-height:1; font-weight:600; letter-spacing:-0.02em; color:${C.text}; }
        .focus { font-family:${MONO}; font-size:10px; color:${statusColor}; text-align:right; }
        .readings { display:flex; flex-direction:column; gap:15px; margin:auto 0; }
        .reading-head { display:grid; grid-template-columns:minmax(52px,1fr) minmax(62px,auto) auto; align-items:baseline; gap:10px; margin-bottom:8px; }
        .reading-name { font-family:${MONO}; font-size:10px; color:${C.dim}; }
        .reading-state { font-family:${MONO}; font-size:9px; text-transform:uppercase; letter-spacing:0.08em; text-align:right; }
        .reading-value { font-size:15px; color:${C.ink}; text-align:right; white-space:nowrap; }
        .bar { height:6px; position:relative; border-radius:99px; background:color-mix(in srgb, ${C.line} 8%, transparent); }
        .bar-fill { position:absolute; inset:0 auto 0 0; border-radius:99px; opacity:0.45; }
        .tick { position:absolute; top:-3px; bottom:-3px; width:1px; background:${C.line}; opacity:0.2; }
        .marker { position:absolute; top:50%; width:9px; height:9px; border:2px solid; border-radius:99px; transform:translate(-50%,-50%); box-sizing:border-box; }
        .foot { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; padding-top:14px; margin-top:17px; border-top:1px solid ${C.divider}; }
        .context { display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
        .age { font-family:${MONO}; font-size:10px; color:${C.faint}; }
      </style>`;
      return this._card(`${this._header(this._config.name || group.room.name, freshestAge([group]))}
        ${style}
        <div class="wrap">
          <div class="hero"><div class="status">${copy.title}</div><div class="focus">${esc(focus)}</div></div>
          <div class="readings">${rows}</div>
          <div class="foot">
            <div class="context">
              ${contextChip('temp', formatAux(group.temperature, 1), group.temperature.entity, C)}
              ${contextChip('humidity', formatAux(group.humidity), group.humidity.entity, C)}
            </div>
            <span class="age">bars · configured range</span>
          </div>
        </div>`);
    }
  }

  class AirQualityCardsRadon extends AirQualityCardsBase {
    static defaults = { name: '', rooms: [], load_fonts: true };
    static cardSize = 4;

    getGridOptions() {
      return { columns: 'full', rows: 'auto', min_columns: 6 };
    }

    static getStubConfig() {
      return {
        rooms: [
          { name: 'Basement', radon: 'sensor.basement_radon' },
          { name: 'Upstairs', radon: 'sensor.upstairs_radon' },
        ],
      };
    }

    _template() {
      const C = this._pal();
      const groups = this._rooms();
      if (!groups.length) throw new Error('radon card needs at least one room');
      const threshold = this._config.thresholds.radon;
      const cards = groups
        .map((group) => {
          const reading = stateFor(this._hass, group.room.radon, 'radon');
          const average = auxiliaryState(this._hass, group.room.radon_average, reading?.unit || METRICS.radon.unit);
          const status = metricState('radon', average.available ? average.value : reading.value, this._config.thresholds);
          const color = colorFor(C, status.severity);
          const markerPos = reading.available ? clamp((reading.value / threshold.max) * 100, 0, 100) : 0;
          const considerPos = clamp((threshold.good / threshold.max) * 100, 0, 100);
          const actionPos = clamp((threshold.action / threshold.max) * 100, 0, 100);
          return `<section class="radon-room">
            <div class="room-name">${esc(group.room.name)}</div>
            <div class="value-row"${reading.entity ? ` data-entity="${esc(reading.entity)}" role="button" tabindex="0" style="cursor:pointer;"` : ''}>
              <span class="value">${formatValue('radon', reading, false)}</span>
              <span class="unit">${esc(reading.unit || METRICS.radon.unit)}</span>
              <span class="state" style="color:${color};">${status.label}</span>
            </div>
            <div class="scale">
              <div class="zone low" style="width:${considerPos.toFixed(1)}%; background:${C.good};"></div>
              <div class="zone watch" style="left:${considerPos.toFixed(1)}%; width:${(actionPos - considerPos).toFixed(1)}%; background:${C.watch};"></div>
              <div class="zone action" style="left:${actionPos.toFixed(1)}%; right:0; background:${C.action};"></div>
              <span class="action-tick" style="left:${actionPos.toFixed(1)}%;"></span>
              ${reading.available ? `<span class="radon-marker" style="left:${markerPos.toFixed(1)}%; border-color:${color}; background:${C.surface};"></span>` : ''}
            </div>
            <div class="scale-labels"><span>0</span><span style="left:${actionPos.toFixed(1)}%;">${threshold.action} action</span><span>${threshold.max}+</span></div>
            ${group.room.radon_average ? `<div class="average" data-entity="${esc(group.room.radon_average)}" role="button" tabindex="0"><span>long-term average</span><strong>${average.available ? `${average.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${average.unit}` : '—'}</strong></div>` : ''}
          </section>`;
        })
        .join('');
      const style = `<style>
        .wrap { container-type:inline-size; display:flex; flex-direction:column; flex:1 1 auto; }
        .rooms { display:grid; grid-template-columns:repeat(${Math.min(groups.length, 3)},minmax(0,1fr)); gap:0; padding:22px 0 16px; }
        .radon-room { min-width:0; padding:0 24px; border-left:1px solid ${C.divider}; }
        .radon-room:first-child { padding-left:0; border-left:0; }
        .radon-room:last-child { padding-right:0; }
        .room-name { font-size:17px; font-weight:600; color:${C.text}; }
        .value-row { display:flex; align-items:baseline; gap:8px; margin:13px 0 18px; }
        .value { font-size:38px; line-height:1; font-weight:600; letter-spacing:-0.02em; }
        .unit { font-family:${MONO}; font-size:11px; color:${C.dim}; }
        .state { margin-left:auto; font-family:${MONO}; font-size:10px; text-transform:uppercase; letter-spacing:0.08em; }
        .scale { height:8px; position:relative; border-radius:99px; overflow:visible; background:color-mix(in srgb, ${C.line} 8%, transparent); }
        .zone { position:absolute; top:0; bottom:0; opacity:0.32; }
        .zone.low { left:0; border-radius:99px 0 0 99px; }
        .zone.action { border-radius:0 99px 99px 0; }
        .action-tick { position:absolute; top:-4px; bottom:-4px; width:1px; background:${C.action}; opacity:0.65; }
        .radon-marker { position:absolute; top:50%; width:12px; height:12px; border:2px solid; border-radius:99px; transform:translate(-50%,-50%); box-sizing:border-box; }
        .scale-labels { position:relative; display:flex; justify-content:space-between; margin-top:8px; font-family:${MONO}; font-size:9px; color:${C.faint}; }
        .scale-labels span:nth-child(2) { position:absolute; transform:translateX(-50%); color:${C.action}; }
        .average { display:flex; justify-content:space-between; gap:10px; margin-top:14px; padding-top:12px; border-top:1px solid ${C.divider}; font-family:${MONO}; font-size:10px; color:${C.dim}; cursor:pointer; }
        .average strong { color:${C.ink}; font-weight:400; }
        .foot { display:flex; justify-content:space-between; gap:18px; padding-top:15px; border-top:1px solid ${C.divider}; font-family:${MONO}; font-size:10px; line-height:1.45; color:${C.faint}; }
        .foot strong { color:${C.action}; font-weight:400; }
        @container (max-width: 600px) {
          .rooms { grid-template-columns:1fr; padding-bottom:4px; }
          .radon-room, .radon-room:first-child, .radon-room:last-child { padding:18px 0; border-left:0; border-top:1px solid ${C.divider}; }
          .radon-room:first-child { border-top:0; padding-top:8px; }
          .foot { flex-direction:column; gap:6px; }
        }
      </style>`;
      return this._card(`${this._header(this._config.name, `radon · ${groups.length} ${groups.length === 1 ? 'room' : 'rooms'}`)}
        ${style}
        <div class="wrap">
          <div class="rooms">${cards}</div>
          <div class="foot">
            <span><strong>${threshold.action} Bq/m³</strong> · EPA action level</span>
            <span>judge radon by a long-term average, not a single reading</span>
          </div>
        </div>`);
    }
  }

  class AirQualityCardsTrendBase extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._data = {};
      this._loading = false;
      this._error = null;
      this._requestToken = 0;
    }

    setConfig(config) {
      this._config = this._normalizeConfig(config || {});
      this._data = {};
      this._error = null;
      this._lastFetch = 0;
      if (this._hass) {
        this._render();
        this._maybeLoad();
      }
    }

    set hass(hass) {
      const connectionChanged = this._hass?.connection !== hass?.connection;
      this._hass = hass;
      if (!this._config) return;
      if (this._config.load_fonts !== false) loadFonts();
      if (connectionChanged) this._lastFetch = 0;
      this._render();
      this._maybeLoad();
    }

    get hass() {
      return this._hass;
    }

    connectedCallback() {
      this._connected = true;
      this._maybeLoad();
      this._refreshTimer = setInterval(() => this._maybeLoad(true), (this._config?.refresh_interval || 300) * 1000);
    }

    disconnectedCallback() {
      this._connected = false;
      clearInterval(this._refreshTimer);
    }

    async _maybeLoad(force = false) {
      if (!this._config || !this._hass?.callWS || this._loading) return;
      const refreshMs = (this._config.refresh_interval || 300) * 1000;
      if (!force && this._lastFetch && Date.now() - this._lastFetch < refreshMs) return;
      const token = ++this._requestToken;
      this._loading = true;
      this._error = null;
      this._render();
      try {
        const data = await this._hass.callWS(this._request());
        if (token !== this._requestToken) return;
        this._data = data || {};
        this._lastFetch = Date.now();
      } catch (error) {
        if (token !== this._requestToken) return;
        this._error = error?.message || String(error);
      } finally {
        if (token === this._requestToken) {
          this._loading = false;
          this._render();
        }
      }
    }

    _pal() {
      return palette(this._hass?.themes?.darkMode !== false);
    }

    _card(inner) {
      const C = this._pal();
      return `<ha-card style="display:flex; flex-direction:column; box-sizing:border-box; height:100%; padding:24px 26px 22px; color:${C.text}; font-family:${SANS};">${inner}</ha-card>`;
    }

    _header(left, right, rightColor) {
      const C = this._pal();
      return `<div class="trend-header">
        <div class="trend-kicker">${esc(left)}</div>
        <div class="trend-meta" style="color:${rightColor || C.faint};">${esc(right)}</div>
      </div>`;
    }

    _render() {
      if (!this._config || !this.shadowRoot) return;
      let html;
      try {
        html = this._template();
      } catch (error) {
        html = `<ha-card style="display:block; padding:16px; font-family:${MONO}; font-size:12px;">air-quality-cards error: ${esc(error?.message || error)}</ha-card>`;
      }
      this.shadowRoot.innerHTML = html;
      this.shadowRoot.querySelectorAll('[data-entity]').forEach((el) => {
        const open = () => {
          this.dispatchEvent(
            new CustomEvent('hass-more-info', {
              bubbles: true,
              composed: true,
              detail: { entityId: el.dataset.entity },
            })
          );
        };
        el.addEventListener('click', open);
        el.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
      });
    }

    getCardSize() {
      return this.constructor.cardSize || 6;
    }

    getGridOptions() {
      return { columns: 'full', rows: 'auto', min_columns: 6 };
    }
  }

  class AirQualityCardsTrend extends AirQualityCardsTrendBase {
    static cardSize = 6;

    static getStubConfig() {
      return {
        name: 'Upstairs trend',
        room: {
          name: 'Upstairs',
          co2: 'sensor.upstairs_co2',
          pm25: 'sensor.upstairs_pm2_5',
          voc: 'sensor.upstairs_voc',
        },
      };
    }

    _normalizeConfig(config) {
      const cfg = {
        name: '',
        hours_to_show: 24,
        period: '5minute',
        metrics: ['co2', 'pm25', 'voc'],
        refresh_interval: 300,
        load_fonts: true,
        ...config,
      };
      cfg.thresholds = mergeThresholds(cfg);
      const room = normalizeRoom(cfg.room || {}, 0);
      cfg.room = room;
      const rawSeries = Array.isArray(cfg.series) && cfg.series.length
        ? cfg.series
        : (Array.isArray(cfg.metrics) ? cfg.metrics : []).map((metric) => ({ metric, entity: room[metric] }));
      cfg.series = rawSeries
        .map((series) => {
          const item = typeof series === 'string' ? { entity: series } : { ...series };
          const metric = metricForSeries(item);
          if (!metric) throw new Error(`trend series ${item.entity || ''} needs metric: radon, co2, pm25, or voc`);
          return {
            entity: item.entity || room[metric],
            metric,
            name: item.name || METRICS[metric].label,
          };
        })
        .filter((series) => series.entity);
      if (!cfg.series.length) throw new Error('trend card needs at least one configured series');
      cfg.hours_to_show = Math.max(1, finite(cfg.hours_to_show) || 24);
      if (!['5minute', 'hour', 'day'].includes(cfg.period)) throw new Error('trend period must be 5minute, hour, or day');
      return cfg;
    }

    _request() {
      const end = new Date();
      const start = new Date(end.getTime() - this._config.hours_to_show * 3600000);
      return {
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: this._config.series.map((series) => series.entity),
        period: this._config.period,
        types: ['mean'],
      };
    }

    _template() {
      const C = this._pal();
      const spanMs = this._config.hours_to_show * 3600000;
      const end = Date.now();
      const start = end - spanMs;
      const periodCopy = this._config.period === '5minute' ? '5 min mean' : `${this._config.period} mean`;
      const meta = this._error
        ? 'history unavailable'
        : this._loading && !Object.keys(this._data).length
          ? 'loading history…'
          : `${durationLabel(spanMs)} · ${periodCopy}`;
      const rows = this._config.series
        .map((series) => {
          const metric = series.metric;
          const metricCfg = METRICS[metric];
          const threshold = this._config.thresholds[metric];
          const current = currentSeriesReading(this._hass, series);
          const status = metricState(metric, current.value, this._config.thresholds);
          const statusColor = colorFor(C, status.severity);
          const lineColor = C[METRIC_ACCENTS[metric]];
          const points = statisticsPoints(this._data?.[series.entity], 'mean', start, end);
          const values = points.map((point) => point.value);
          const dataMax = values.length ? Math.max(...values) : 0;
          const yMax = Math.max(threshold.action * 1.12, dataMax * 1.08, 1);
          const bounds = { left: 2, right: 718, top: 8, bottom: 76, start, end, min: 0, max: yMax };
          const plotted = plotPoints(points, bounds);
          const path = linePath(plotted);
          const fill = areaPath(plotted, bounds.bottom);
          const goodY = bounds.bottom - (threshold.good / yMax) * (bounds.bottom - bounds.top);
          const actionY = bounds.bottom - (threshold.action / yMax) * (bounds.bottom - bounds.top);
          const last = plotted[plotted.length - 1];
          const delta = points.length > 1 ? points[points.length - 1].value - points[0].value : NaN;
          const deltaText = Number.isFinite(delta)
            ? `${delta > 0 ? '+' : ''}${delta.toLocaleString(undefined, { maximumFractionDigits: metricCfg.decimals || 0 })}`
            : '—';
          const valueText = current.available
            ? `${current.value.toLocaleString(undefined, { maximumFractionDigits: metricCfg.decimals })} ${current.unit || metricCfg.unit}`
            : '—';
          const chart = plotted.length
            ? `<svg viewBox="0 0 720 84" preserveAspectRatio="none" role="img" aria-label="${esc(`${series.name} ${durationLabel(spanMs)} history`)}">
                <defs>
                  <linearGradient id="fill-${metric}" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stop-color="${lineColor}" stop-opacity="0.22"></stop>
                    <stop offset="1" stop-color="${lineColor}" stop-opacity="0"></stop>
                  </linearGradient>
                </defs>
                <line x1="2" x2="718" y1="${goodY.toFixed(2)}" y2="${goodY.toFixed(2)}" stroke="${C.good}" stroke-opacity="0.18" stroke-dasharray="4 6"></line>
                <line x1="2" x2="718" y1="${actionY.toFixed(2)}" y2="${actionY.toFixed(2)}" stroke="${C.action}" stroke-opacity="0.28" stroke-dasharray="4 6"></line>
                <path d="${fill}" fill="url(#fill-${metric})"></path>
                <path d="${path}" fill="none" stroke="${lineColor}" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></path>
                ${last ? `<circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="3.5" fill="${C.surface}" stroke="${lineColor}" stroke-width="2" vector-effect="non-scaling-stroke"><title>${esc(`${last.value} ${current.unit || metricCfg.unit}`)}</title></circle>` : ''}
              </svg>`
            : `<div class="empty-line">${this._loading ? 'loading recorder data…' : 'no recorder statistics in this range'}</div>`;
          return `<section class="trend-row" data-entity="${esc(series.entity)}" role="button" tabindex="0">
            <div class="series-head">
              <div class="series-name"><span class="series-dot" style="background:${lineColor};"></span>${esc(series.name)}</div>
              <div class="series-status" style="color:${statusColor};">${esc(status.label)}</div>
              <div class="series-delta">Δ ${deltaText}</div>
              <div class="series-value">${esc(valueText)}</div>
            </div>
            <div class="sparkline">${chart}</div>
          </section>`;
        })
        .join('');
      const style = `<style>
        .trend-header { display:flex; align-items:baseline; justify-content:space-between; gap:14px; }
        .trend-kicker { font-family:${MONO}; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${C.dim}; }
        .trend-meta { font-family:${MONO}; font-size:10px; white-space:nowrap; }
        .trend-body { display:flex; flex-direction:column; padding-top:10px; }
        .trend-row { display:block; padding:14px 0 12px; border-top:1px solid ${C.divider}; cursor:pointer; outline:none; }
        .trend-row:first-child { border-top:0; }
        .trend-row:focus-visible { border-radius:8px; box-shadow:0 0 0 2px ${C.blue}; }
        .series-head { display:grid; grid-template-columns:minmax(80px,1fr) auto auto auto; gap:12px; align-items:baseline; margin-bottom:7px; }
        .series-name { display:flex; align-items:center; gap:9px; font-size:15px; font-weight:600; min-width:0; }
        .series-dot { width:7px; height:7px; border-radius:99px; flex:none; }
        .series-status, .series-delta { font-family:${MONO}; font-size:9px; text-transform:uppercase; letter-spacing:0.06em; white-space:nowrap; }
        .series-delta { color:${C.faint}; }
        .series-value { font-size:14px; color:${C.ink}; text-align:right; white-space:nowrap; }
        .sparkline { height:84px; }
        .sparkline svg { display:block; width:100%; height:100%; overflow:visible; }
        .empty-line { height:100%; display:flex; align-items:center; justify-content:center; border-radius:8px; background:color-mix(in srgb, ${C.line} 3%, transparent); font-family:${MONO}; font-size:10px; color:${C.faint}; }
        .time-axis { display:grid; grid-template-columns:1fr 1fr 1fr; padding-top:10px; border-top:1px solid ${C.divider}; font-family:${MONO}; font-size:9px; color:${C.faint}; }
        .time-axis span:nth-child(2) { text-align:center; }
        .time-axis span:last-child { text-align:right; }
        @media (max-width: 460px) {
          ha-card { padding-left:18px !important; padding-right:18px !important; }
          .series-head { grid-template-columns:1fr auto; gap:5px 10px; }
          .series-status { grid-column:1; }
          .series-delta { display:none; }
          .series-value { grid-column:2; grid-row:1 / span 2; }
        }
      </style>`;
      return this._card(`${this._header(this._config.name || `${this._config.room.name} trend`, meta, this._error ? C.action : null)}
        ${style}
        <div class="trend-body">${rows}</div>
        <div class="time-axis"><span>${esc(timeTick(start, spanMs))}</span><span>${esc(timeTick(start + spanMs / 2, spanMs))}</span><span>now</span></div>`);
    }
  }

  class AirQualityCardsRadonTrend extends AirQualityCardsTrendBase {
    static cardSize = 6;

    static getStubConfig() {
      return {
        rooms: [
          { name: 'Basement', radon: 'sensor.basement_radon' },
          { name: 'Upstairs', radon: 'sensor.upstairs_radon' },
        ],
      };
    }

    _normalizeConfig(config) {
      const cfg = {
        name: 'Radon history',
        days_to_show: 30,
        period: 'day',
        show_max: true,
        refresh_interval: 900,
        load_fonts: true,
        ...config,
      };
      cfg.thresholds = mergeThresholds(cfg);
      cfg.rooms = (Array.isArray(cfg.rooms) ? cfg.rooms : []).map(normalizeRoom).filter((room) => room.radon);
      if (!cfg.rooms.length) throw new Error('radon trend card needs at least one room with a radon entity');
      cfg.days_to_show = Math.max(2, finite(cfg.days_to_show) || 30);
      if (!['hour', 'day', 'week', 'month'].includes(cfg.period)) throw new Error('radon trend period must be hour, day, week, or month');
      return cfg;
    }

    _request() {
      const end = new Date();
      const start = new Date(end.getTime() - this._config.days_to_show * 86400000);
      return {
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: this._config.rooms.map((room) => room.radon),
        period: this._config.period,
        types: this._config.show_max ? ['mean', 'max'] : ['mean'],
      };
    }

    _template() {
      const C = this._pal();
      const spanMs = this._config.days_to_show * 86400000;
      const end = Date.now();
      const start = end - spanMs;
      const threshold = this._config.thresholds.radon;
      const colors = [C.blue, C.amber, C.green, C.pink];
      const series = this._config.rooms.map((room, index) => {
        const rows = this._data?.[room.radon] || [];
        return {
          room,
          color: colors[index % colors.length],
          mean: statisticsPoints(rows, 'mean', start, end),
          max: this._config.show_max ? statisticsPoints(rows, 'max', start, end) : [],
        };
      });
      const values = series.flatMap((item) => [...item.mean, ...item.max]).map((point) => point.value);
      const dataMax = values.length ? Math.max(...values) : 0;
      const yMax = Math.max(threshold.action * 1.16, dataMax * 1.08, 10);
      const bounds = { left: 6, right: 906, top: 14, bottom: 220, start, end, min: 0, max: yMax };
      const yFor = (value) => bounds.bottom - (value / yMax) * (bounds.bottom - bounds.top);
      const gridValues = [...new Set([0, threshold.good, threshold.action, Math.round(yMax)])].sort((a, b) => a - b);
      const grid = gridValues
        .map((value) => {
          const isAction = value === threshold.action;
          const isGood = value === threshold.good;
          const color = isAction ? C.action : isGood ? C.good : C.line;
          const opacity = isAction ? 0.55 : isGood ? 0.22 : 0.1;
          return `<line x1="${bounds.left}" x2="${bounds.right}" y1="${yFor(value).toFixed(2)}" y2="${yFor(value).toFixed(2)}" stroke="${color}" stroke-opacity="${opacity}" stroke-dasharray="${isAction || isGood ? '5 7' : '2 8'}"></line>
            <text x="922" y="${(yFor(value) + 3).toFixed(2)}" fill="${isAction ? C.action : C.faint}" font-family="${MONO_SVG}" font-size="9">${isAction ? `${value} action` : value}</text>`;
        })
        .join('');
      const paths = series
        .map((item) => {
          const mean = plotPoints(item.mean, bounds);
          const max = plotPoints(item.max, bounds);
          const last = mean[mean.length - 1];
          return `${max.length ? `<path d="${linePath(max)}" fill="none" stroke="${item.color}" stroke-width="1.2" stroke-opacity="0.38" stroke-dasharray="4 6" vector-effect="non-scaling-stroke"></path>` : ''}
            ${mean.length ? `<path d="${linePath(mean)}" fill="none" stroke="${item.color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>` : ''}
            ${last ? `<circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="4" fill="${C.surface}" stroke="${item.color}" stroke-width="2.2" vector-effect="non-scaling-stroke"><title>${esc(`${item.room.name}: ${last.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} Bq/m³ mean`)}</title></circle>` : ''}`;
        })
        .join('');
      const ticks = [0, 1 / 3, 2 / 3, 1]
        .map((fraction) => {
          const x = bounds.left + fraction * (bounds.right - bounds.left);
          const timestamp = start + fraction * spanMs;
          return `<text x="${x.toFixed(2)}" y="244" text-anchor="${fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">${esc(fraction === 1 ? 'now' : timeTick(timestamp, spanMs))}</text>`;
        })
        .join('');
      const legends = series
        .map((item) => {
          const latest = item.mean[item.mean.length - 1];
          const latestMax = item.max[item.max.length - 1];
          const live = stateFor(this._hass, item.room.radon, 'radon');
          const status = metricState('radon', latest?.value ?? live.value, this._config.thresholds);
          return `<div class="radon-legend" data-entity="${esc(item.room.radon)}" role="button" tabindex="0">
            <span class="legend-line" style="background:${item.color};"></span>
            <span class="legend-name">${esc(item.room.name)}</span>
            <span class="legend-status" style="color:${colorFor(C, status.severity)};">${esc(status.label)}</span>
            <strong>${latest ? latest.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'} <small>Bq/m³ mean</small></strong>
            ${this._config.show_max ? `<span class="legend-max">${latestMax ? latestMax.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'} max</span>` : ''}
          </div>`;
        })
        .join('');
      const hasData = series.some((item) => item.mean.length);
      const chart = hasData
        ? `<svg viewBox="0 0 960 252" preserveAspectRatio="none" role="img" aria-label="${esc(`${this._config.days_to_show} day radon history`)}">${grid}${paths}${ticks}</svg>`
        : `<div class="radon-empty">${this._loading ? 'loading recorder data…' : this._error ? esc(this._error) : 'no recorder statistics in this range'}</div>`;
      const meta = this._error
        ? 'history unavailable'
        : this._loading && !hasData
          ? 'loading history…'
          : `${this._config.days_to_show} days · ${this._config.period} mean${this._config.show_max ? ' + max' : ''}`;
      const style = `<style>
        .trend-header { display:flex; align-items:baseline; justify-content:space-between; gap:14px; }
        .trend-kicker { font-family:${MONO}; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${C.dim}; }
        .trend-meta { font-family:${MONO}; font-size:10px; white-space:nowrap; }
        .radon-legends { display:grid; grid-template-columns:repeat(${Math.min(series.length, 3)},minmax(0,1fr)); gap:0; padding:18px 0 14px; }
        .radon-legend { display:grid; grid-template-columns:auto 1fr auto; gap:4px 9px; align-items:baseline; padding:0 20px; border-left:1px solid ${C.divider}; cursor:pointer; outline:none; }
        .radon-legend:first-child { border-left:0; padding-left:0; }
        .radon-legend:last-child { padding-right:0; }
        .radon-legend:focus-visible { border-radius:8px; box-shadow:0 0 0 2px ${C.blue}; }
        .legend-line { width:17px; height:3px; border-radius:99px; }
        .legend-name { font-size:15px; font-weight:600; }
        .legend-status { font-family:${MONO}; font-size:9px; text-transform:uppercase; letter-spacing:0.06em; }
        .radon-legend strong { grid-column:2 / 4; font-size:20px; font-weight:600; color:${C.ink}; }
        .radon-legend small { font-family:${MONO}; font-size:9px; font-weight:400; color:${C.faint}; }
        .legend-max { grid-column:2 / 4; font-family:${MONO}; font-size:9px; color:${C.faint}; }
        .radon-chart { min-height:252px; padding-top:6px; border-top:1px solid ${C.divider}; }
        .radon-chart svg { display:block; width:100%; height:252px; overflow:visible; }
        .radon-empty { min-height:220px; display:flex; align-items:center; justify-content:center; font-family:${MONO}; font-size:10px; color:${C.faint}; }
        .radon-foot { display:flex; justify-content:space-between; gap:18px; padding-top:13px; margin-top:4px; border-top:1px solid ${C.divider}; font-family:${MONO}; font-size:9px; color:${C.faint}; }
        .radon-foot strong { color:${C.action}; font-weight:400; }
        @media (max-width: 600px) {
          ha-card { padding-left:18px !important; padding-right:18px !important; }
          .radon-legends { grid-template-columns:1fr; padding-bottom:6px; }
          .radon-legend, .radon-legend:first-child, .radon-legend:last-child { padding:12px 0; border-left:0; border-top:1px solid ${C.divider}; }
          .radon-legend:first-child { border-top:0; }
          .radon-chart svg { height:220px; }
          .radon-foot { flex-direction:column; gap:5px; }
        }
      </style>`;
      return this._card(`${this._header(this._config.name, meta, this._error ? C.action : null)}
        ${style}
        <div class="radon-legends">${legends}</div>
        <div class="radon-chart">${chart}</div>
        <div class="radon-foot"><span><strong>${threshold.action} Bq/m³</strong> · EPA action level</span><span>solid = mean · dashed = daily max</span></div>`);
    }
  }

  customElements.define('air-quality-cards-overview', AirQualityCardsOverview);
  customElements.define('air-quality-cards-room', AirQualityCardsRoom);
  customElements.define('air-quality-cards-radon', AirQualityCardsRadon);
  customElements.define('air-quality-cards-trend', AirQualityCardsTrend);
  customElements.define('air-quality-cards-radon-trend', AirQualityCardsRadonTrend);

  window.customCards = window.customCards || [];
  window.customCards.push(
    {
      type: 'air-quality-cards-overview',
      name: 'Air Quality Cards · Overview',
      preview: true,
      description: 'Whole-home status, pollutant dial, and side-by-side room comparison.',
      documentationURL: REPO,
    },
    {
      type: 'air-quality-cards-room',
      name: 'Air Quality Cards · Room',
      preview: true,
      description: 'One room with CO₂, PM2.5, VOC, and optional radon ranges.',
      documentationURL: REPO,
    },
    {
      type: 'air-quality-cards-radon',
      name: 'Air Quality Cards · Radon',
      preview: true,
      description: 'Multi-room radon comparison with the EPA action level and optional long-term averages.',
      documentationURL: REPO,
    },
    {
      type: 'air-quality-cards-trend',
      name: 'Air Quality Cards · Trend',
      preview: true,
      description: 'Recorder-backed, normalized small-multiple trends for one room.',
      documentationURL: REPO,
    },
    {
      type: 'air-quality-cards-radon-trend',
      name: 'Air Quality Cards · Radon Trend',
      preview: true,
      description: 'Multi-room long-term radon mean and max trends with the EPA action line.',
      documentationURL: REPO,
    }
  );

  window.__AIR_QUALITY_CARDS__ = {
    VERSION,
    METRICS,
    metricState,
    mergeThresholds,
    statisticsPoints,
    plotPoints,
    linePath,
    areaPath,
  };

  console.info(
    `%c AIR-QUALITY-CARDS %c v${VERSION} `,
    'background:#a8d98f;color:#131318;border-radius:4px 0 0 4px;padding:2px 6px;font-weight:600;',
    'background:#16171d;color:#a8d98f;border-radius:0 4px 4px 0;padding:2px 6px;'
  );
})();
