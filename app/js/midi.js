// Web MIDI link to the RC-600 (USB MIDI). The unit follows Program Change,
// Control Change (through its ASSIGN settings), clock and start/stop.

export const midi = {
  access: null,
  outputs: [],
  inputs: [],
  output: null,
  input: null,
  channel: 0,
  lastMessage: '',
  onChange: () => {},
  onMessage: () => {},
};

export async function refreshPorts() {
  if (!navigator.requestMIDIAccess) throw new Error('This system does not offer Web MIDI.');
  midi.access ||= await navigator.requestMIDIAccess({ sysex: false });
  midi.access.onstatechange = () => {
    listPorts();
    midi.onChange();
  };
  listPorts();
  return midi;
}

function listPorts() {
  midi.outputs = [...midi.access.outputs.values()];
  midi.inputs = [...midi.access.inputs.values()];
  if (midi.output && !midi.outputs.some((o) => o.id === midi.output.id && o.state === 'connected')) disconnect();
}

/** The port to offer first: one whose name looks like the looper. */
export function preferredOutput() {
  return midi.outputs.find((o) => /RC-?600/i.test(o.name)) || midi.outputs[0] || null;
}

export function connect(outputId) {
  disconnect();
  midi.output = midi.outputs.find((o) => o.id === outputId) || null;
  if (!midi.output) throw new Error('MIDI port not found.');
  midi.input = midi.inputs.find((i) => i.name === midi.output.name) || null;
  if (midi.input) {
    midi.input.onmidimessage = (e) => {
      const [status, d1, d2] = e.data;
      if (status >= 0xf8) return; // clock and active sensing
      const type = status & 0xf0;
      const ch = (status & 0x0f) + 1;
      if (type === 0xc0) midi.lastMessage = `PC ${d1 + 1} · CH ${ch}`;
      else if (type === 0xb0) midi.lastMessage = `CC ${d1} = ${d2} · CH ${ch}`;
      else midi.lastMessage = [...e.data].map((b) => b.toString(16).padStart(2, '0')).join(' ').toUpperCase();
      midi.onMessage(e.data);
    };
  }
  midi.onChange();
}

export function disconnect() {
  if (midi.input) midi.input.onmidimessage = null;
  midi.output = null;
  midi.input = null;
  midi.onChange();
}

const send = (bytes) => midi.output?.send(bytes);

/** Select a memory on the unit: memory 1..99 = program 0..98. */
export const programChange = (slot) => send([0xc0 | midi.channel, Math.max(0, Math.min(127, slot - 1))]);
export const controlChange = (cc, value) => send([0xb0 | midi.channel, cc & 127, value & 127]);
export const transportStart = () => send([0xfa]);
export const transportStop = () => send([0xfc]);
