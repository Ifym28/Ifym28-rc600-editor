// Small DOM helpers shared by the views.

import * as rc from './rc0.js';
import { defsFor, formatValue } from './params.js';
import { PATTERNS } from './rhythm-data.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const label = (jp, text, plain) => h('div', { class: `label${plain ? ' plain' : ''}` }, jp && h('span', { class: 'jp' }, jp), text);

export const panel = (cls, ...children) => h('div', { class: `panel ${cls || ''}` }, ...children);

export const btn = (text, onclick, cls = '', props = {}) => h('button', { class: `btn ${cls}`, onclick, ...props }, text);

export function toast(message, error = false) {
  const el = h('div', { class: `toast${error ? ' error' : ''}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), error ? 7000 : 3200);
}

/** Dialog with buttons. Resolves with the value of the chosen button, or null. */
export function dialog({ title, jp = '警告', body, buttons }) {
  return new Promise((resolve) => {
    const close = (value) => {
      back.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => e.key === 'Escape' && close(null);
    const back = h('div', { class: 'modal-back', onclick: (e) => e.target === back && close(null) },
      panel('hot modal',
        h('div', { class: 'hazard', style: { height: '5px', marginBottom: '10px' } }),
        label(jp, 'CONFIRM'),
        h('div', { class: 'title' }, title),
        h('div', { class: 'sub', style: { marginTop: '8px', whiteSpace: 'pre-line' } }, body),
        h('div', { class: 'actions' },
          btn('Cancel', () => close(null), 'ghost'),
          buttons.map((b) => btn(b.text, () => close(b.value), b.cls || 'primary')))));
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    back.querySelector('.actions .btn:last-child').focus();
  });
}

export const confirm = (title, body, okText = 'Proceed', cls = 'primary') =>
  dialog({ title, body, buttons: [{ text: okText, value: true, cls }] });

function setRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  input.style.setProperty('--p', `${((Number(input.value) - min) / (max - min || 1)) * 100}%`);
}

/**
 * Control for one field of a section. Unknown tags get a plain number box.
 * ctx: { onChange(), fxTypes?: string[], genre?: () => number }
 */
export function paramControl(sec, tag, ctx, defOverride) {
  const field = sec.byTag.get(tag);
  if (!field) return null;
  const def = defOverride || defsFor(sec.name)[tag];
  const value = () => rc.getNum(sec, tag);
  const changed = () => field.value !== field.orig;
  const name = def?.name || `Param ${tag}`;
  const readout = h('b', {}, '');
  const wrap = h('div', { class: 'field' });
  const refresh = () => {
    readout.textContent = def?.kind === 'int' ? formatValue(def, value()) : '';
    wrap.classList.toggle('changed', changed());
  };
  const commit = (v) => {
    rc.setNum(sec, tag, v);
    refresh();
    ctx.onChange?.(sec, tag);
  };
  const head = h('div', { class: 'k' }, h('span', {}, name, ' ', h('span', { class: 'tag' }, `·${tag}`)), readout);
  let body;
  const options = def?.kind === 'pattern'
    ? (PATTERNS[ctx.genre?.() ?? 0] || []).map((label, v) => ({ value: v, label }))
    : def?.kind === 'fxtype'
      ? (ctx.fxTypes || []).map((label, v) => ({ value: v, label: `${String(v).padStart(2, '0')} ${label.replace(/_/g, ' ')}` }))
      : def?.options;

  if (def?.kind === 'bool') {
    body = h('button', { class: `chip${value() ? ' on' : ''}`, onclick: () => {
      commit(value() ? 0 : 1);
      body.classList.toggle('on', !!value());
      body.textContent = value() ? 'ON' : 'OFF';
    } }, value() ? 'ON' : 'OFF');
  } else if (options?.length) {
    const opts = options.some((o) => o.value === value()) ? options : [...options, { value: value(), label: `RAW ${value()}` }];
    body = h('select', { onchange: (e) => commit(Number(e.target.value)) },
      opts.map((o) => h('option', { value: o.value, selected: o.value === value() }, o.label)));
  } else if (def?.kind === 'bits') {
    body = h('div', { class: 'chips' }, def.bits.map((bitName, bit) => {
      const chip = h('button', { class: `chip${(value() >> bit) & 1 ? ' on' : ''}`, onclick: () => {
        commit(value() ^ (1 << bit));
        chip.classList.toggle('on', !!((value() >> bit) & 1));
      } }, bitName);
      return chip;
    }));
  } else if (def?.kind === 'int' && def.max - def.min <= 400) {
    body = h('input', { type: 'range', min: def.min, max: Math.max(def.max, value()), value: value(), oninput: (e) => {
      commit(Number(e.target.value));
      setRangeFill(e.target);
    } });
    setRangeFill(body);
  } else {
    body = h('input', { type: 'number', step: 1, min: def?.min, max: def?.max, value: value(), onchange: (e) => {
      const n = Math.round(Number(e.target.value));
      if (!Number.isFinite(n)) return void (e.target.value = value());
      commit(def?.max != null ? Math.max(def.min, Math.min(def.max, n)) : n);
      e.target.value = value();
    } });
  }
  wrap.append(head, body);
  refresh();
  return wrap;
}

/** All fields of a section as a panel of controls. */
export function sectionPanel(sec, ctx, title, jp) {
  if (!sec) return null;
  return panel('flat', label(jp || 'データ', title || sec.name),
    h('div', { class: 'fields' }, sec.fields.map((f) => paramControl(sec, f.tag, ctx))));
}

export const pips = (tracks) => h('span', { class: 'pips' }, (tracks || Array(6).fill(false)).map((on) => h('i', { class: on ? 'on' : '' })));

export function drawWave(canvas, pk, progress) {
  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.width = Math.max(10, canvas.clientWidth * dpr));
  const hgt = (canvas.height = Math.max(10, canvas.clientHeight * dpr));
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, hgt);
  g.fillStyle = '#1c1c21';
  g.fillRect(0, hgt / 2, w, 1);
  if (!pk) return;
  const n = pk.length / 2;
  const bar = w / n;
  for (let i = 0; i < n; i++) {
    const played = progress != null && i / n <= progress;
    g.fillStyle = played ? '#ffb224' : '#ff2a2a';
    const top = (0.5 - pk[i * 2 + 1] * 0.48) * hgt;
    const bottom = (0.5 - pk[i * 2] * 0.48) * hgt;
    g.fillRect(i * bar, top, Math.max(1, bar - dpr), Math.max(1, bottom - top));
  }
}
