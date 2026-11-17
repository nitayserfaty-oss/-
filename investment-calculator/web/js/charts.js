/* Lightweight SVG charts (no dependencies). Line chart with crosshair tooltip + bar chart. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) {
      const v = attrs[k];
      // CSS custom properties are applied through style so they resolve in every browser
      if ((k === 'fill' || k === 'stroke') && String(v).indexOf('var(') === 0) e.style[k] = v;
      else e.setAttribute(k, v);
    }
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step0 = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return String(Math.round(v * 10) / 10);
  }

  function legend(container, items) {
    const lg = document.createElement('div');
    lg.className = 'chart-legend';
    items.forEach(function (it) {
      const k = document.createElement('span'); k.className = 'key';
      const sw = document.createElement('span');
      sw.className = it.rect ? 'swatch-rect' : ('swatch-line' + (it.dashed ? ' dashed' : ''));
      if (it.rect) sw.style.background = it.color; else sw.style.borderTopColor = it.color;
      const t = document.createElement('span'); t.textContent = it.name;
      k.appendChild(sw); k.appendChild(t); lg.appendChild(k);
    });
    container.appendChild(lg);
  }

  function tooltipEl(wrap) {
    const tt = document.createElement('div');
    tt.className = 'tooltip';
    wrap.appendChild(tt);
    return tt;
  }

  function fillTooltip(tt, title, rows) {
    tt.textContent = '';
    const h = document.createElement('div'); h.className = 'tt-title'; h.textContent = title; tt.appendChild(h);
    rows.forEach(function (r) {
      const row = document.createElement('div'); row.className = 'tt-row';
      const name = document.createElement('span'); name.className = 'tt-name';
      if (r.color) { const key = document.createElement('span'); key.className = 'tt-key'; key.style.borderTopColor = r.color; name.appendChild(key); }
      name.appendChild(document.createTextNode(r.name));
      const val = document.createElement('span'); val.className = 'tt-val'; val.textContent = r.value;
      row.appendChild(name); row.appendChild(val); tt.appendChild(row);
    });
  }

  function positionTooltip(tt, wrap, px, py) {
    tt.style.display = 'block';
    const w = tt.offsetWidth, W = wrap.clientWidth;
    let left = px + 12;
    if (left + w > W) left = px - w - 12;
    if (left < 0) left = 0;
    tt.style.left = left + 'px';
    tt.style.top = Math.max(0, py - 10) + 'px';
  }

  /**
   * opts: { x: [labels], series: [{name, color, values, dashed}], band: {lo, hi, color, name},
   *         format: fn(value) -> string, height, xFormat }
   */
  function lineChart(container, opts) {
    container.textContent = '';
    const items = opts.series.map(function (s) { return { name: s.name, color: s.color, dashed: s.dashed }; });
    if (opts.band) items.push({ name: opts.band.name, color: opts.band.color, rect: true });
    if (opts.series.length + (opts.band ? 1 : 0) > 1) legend(container, items);
    const wrap = document.createElement('div'); wrap.className = 'chart'; wrap.style.direction = 'ltr';
    container.appendChild(wrap);
    const W = Math.max(280, container.clientWidth || 340), H = opts.height || 220;
    const m = { t: 10, r: 10, b: 24, l: 44 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label || 'chart' }, wrap);

    let all = [];
    opts.series.forEach(function (s) { all = all.concat(s.values); });
    if (opts.band) all = all.concat(opts.band.lo, opts.band.hi);
    all = all.filter(function (v) { return isFinite(v); });
    let min = Math.min(0, Math.min.apply(null, all)), max = Math.max.apply(null, all);
    const ticks = niceTicks(min, max, 4);
    min = ticks[0]; max = ticks[ticks.length - 1];
    const n = opts.x.length;
    const xs = function (i) { return m.l + (n <= 1 ? iw / 2 : i * iw / (n - 1)); };
    const ys = function (v) { return m.t + ih - (v - min) / (max - min || 1) * ih; };

    const gAxis = el('g', { class: 'axis' }, svg);
    ticks.forEach(function (t) {
      el('line', { x1: m.l, x2: W - m.r, y1: ys(t), y2: ys(t), class: t === 0 ? 'baseline' : 'gridline' }, gAxis);
      const tx = el('text', { x: m.l - 6, y: ys(t) + 4, 'text-anchor': 'end' }, gAxis);
      tx.textContent = (opts.axisFormat || compact)(t);
    });
    const step = Math.max(1, Math.ceil(n / 7));
    for (let i = 0; i < n; i += step) {
      const tx = el('text', { x: xs(i), y: H - 6, 'text-anchor': 'middle' }, gAxis);
      tx.textContent = opts.x[i];
    }

    if (opts.band) {
      let d = '';
      for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + xs(i) + ',' + ys(opts.band.hi[i]);
      for (let i = n - 1; i >= 0; i--) d += 'L' + xs(i) + ',' + ys(opts.band.lo[i]);
      el('path', { d: d + 'Z', fill: opts.band.color, 'fill-opacity': 0.16, stroke: 'none' }, svg);
    }
    opts.series.forEach(function (s) {
      let d = '';
      s.values.forEach(function (v, i) { d += (i ? 'L' : 'M') + xs(i).toFixed(1) + ',' + ys(v).toFixed(1); });
      const attrs = { d: d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
      if (s.dashed) attrs['stroke-dasharray'] = '5 4';
      el('path', attrs, svg);
      // direct label at end of line when few series
      if (opts.series.length <= 3 && !opts.noEndDots) {
        const last = s.values.length - 1;
        el('circle', { cx: xs(last), cy: ys(s.values[last]), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
      }
    });

    // hover layer
    const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' }, svg);
    const dots = opts.series.map(function (s) {
      return el('circle', { r: 4.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg);
    });
    const tt = tooltipEl(wrap);
    const hit = el('rect', { x: m.l, y: 0, width: iw, height: H, fill: 'transparent' }, svg);
    const fmt = opts.format || compact;
    function move(evt) {
      const rect = svg.getBoundingClientRect();
      const scale = W / rect.width;
      const px = (evt.clientX - rect.left) * scale;
      let i = Math.round((px - m.l) / (iw / Math.max(1, n - 1)));
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', xs(i)); cross.setAttribute('x2', xs(i)); cross.setAttribute('visibility', 'visible');
      opts.series.forEach(function (s, k) {
        dots[k].setAttribute('cx', xs(i)); dots[k].setAttribute('cy', ys(s.values[i])); dots[k].setAttribute('visibility', 'visible');
      });
      const rows = opts.series.map(function (s) { return { name: s.name, color: s.color, value: fmt(s.values[i]) }; });
      if (opts.band) {
        rows.push({ name: opts.band.hiName || 'עליון', value: fmt(opts.band.hi[i]) });
        rows.push({ name: opts.band.loName || 'תחתון', value: fmt(opts.band.lo[i]) });
      }
      fillTooltip(tt, (opts.xTitle || '') + opts.x[i], rows);
      positionTooltip(tt, wrap, xs(i) / scale, m.t / scale);
    }
    function leave() {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
      tt.style.display = 'none';
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  /**
   * Bar chart for yearly % series. opts: { x: [labels], values: [...], format, posColor, negColor, height }
   */
  function barChart(container, opts) {
    container.textContent = '';
    const wrap = document.createElement('div'); wrap.className = 'chart'; wrap.style.direction = 'ltr';
    container.appendChild(wrap);
    const W = Math.max(280, container.clientWidth || 340), H = opts.height || 200;
    const m = { t: 10, r: 8, b: 24, l: 36 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label || 'chart' }, wrap);
    const vals = opts.values;
    const ticks = niceTicks(Math.min(0, Math.min.apply(null, vals)), Math.max(0, Math.max.apply(null, vals)), 4);
    const min = ticks[0], max = ticks[ticks.length - 1];
    const ys = function (v) { return m.t + ih - (v - min) / (max - min || 1) * ih; };
    const n = vals.length, bw = iw / n;
    const gAxis = el('g', { class: 'axis' }, svg);
    ticks.forEach(function (t) {
      el('line', { x1: m.l, x2: W - m.r, y1: ys(t), y2: ys(t), class: t === 0 ? 'baseline' : 'gridline' }, gAxis);
      const tx = el('text', { x: m.l - 5, y: ys(t) + 4, 'text-anchor': 'end' }, gAxis);
      tx.textContent = (opts.axisFormat || function (v) { return v + '%'; })(t);
    });
    const step = Math.max(1, Math.ceil(n / 7));
    for (let i = 0; i < n; i += step) {
      const tx = el('text', { x: m.l + bw * (i + 0.5), y: H - 6, 'text-anchor': 'middle' }, gAxis);
      tx.textContent = opts.x[i];
    }
    const tt = tooltipEl(wrap);
    const gap = bw > 6 ? 2 : (bw > 3 ? 1 : 0);
    vals.forEach(function (v, i) {
      const y0 = ys(0), y1 = ys(v);
      const x = m.l + bw * i + gap / 2;
      const h = Math.max(1, Math.abs(y1 - y0));
      const r = Math.min(4, (bw - gap) / 2);
      // rounded data-end, square at the baseline
      const w = Math.max(1, bw - gap);
      let d;
      if (v >= 0) d = 'M' + x + ',' + y0 + 'V' + (y0 - h + r) + 'Q' + x + ',' + (y0 - h) + ' ' + (x + r) + ',' + (y0 - h) + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + (y0 - h) + ' ' + (x + w) + ',' + (y0 - h + r) + 'V' + y0 + 'Z';
      else d = 'M' + x + ',' + y0 + 'V' + (y0 + h - r) + 'Q' + x + ',' + (y0 + h) + ' ' + (x + r) + ',' + (y0 + h) + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + (y0 + h) + ' ' + (x + w) + ',' + (y0 + h - r) + 'V' + y0 + 'Z';
      const color = v >= 0 ? (opts.posColor || 'var(--pos)') : (opts.negColor || 'var(--neg)');
      const bar = el('path', { d: d, fill: color }, svg);
      const hitR = el('rect', { x: m.l + bw * i, y: m.t, width: bw, height: ih, fill: 'transparent' }, svg);
      const show = function () {
        bar.setAttribute('fill-opacity', '0.75');
        const rect = svg.getBoundingClientRect(); const scale = W / rect.width;
        fillTooltip(tt, String(opts.x[i]), [{ name: opts.name || '', value: (opts.format || function (q) { return q.toFixed(1) + '%'; })(v) }]);
        positionTooltip(tt, wrap, (m.l + bw * (i + 0.5)) / scale, m.t / scale);
      };
      const hide = function () { bar.setAttribute('fill-opacity', '1'); tt.style.display = 'none'; };
      hitR.addEventListener('pointerenter', show);
      hitR.addEventListener('pointerdown', show);
      hitR.addEventListener('pointerleave', hide);
    });
  }

  root.Charts = { lineChart: lineChart, barChart: barChart, compact: compact };
})(window);
