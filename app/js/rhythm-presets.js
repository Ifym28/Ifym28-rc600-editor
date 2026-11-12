// Built-in trap rhythms that can be added to the user rhythms of the looper.
// One measure = 384 ticks (96 per quarter note). 16th = 24, 32nd = 12, 16th triplet = 16.
export const KICK = 36, RIM = 37, SNARE = 38, CLAP = 39, HAT = 42, OPEN = 46, CRASH = 49, TOM = 45;

// k / s / c: 16 characters, one per 16th. "x" hit, "X" accent, "g" ghost, "." rest.
function steps(pattern, note, base) {
  const out = [];
  [...pattern].forEach((ch, i) => {
    if (ch === '.') return;
    out.push({ tick: i * 24, note, velocity: ch === 'X' ? Math.min(127, base + 12) : ch === 'g' ? base - 45 : base });
  });
  return out;
}

// h: 8 tokens, one per 8th note.
//  "-" rest, "x" one hit, "o" open hat, "xx" two 16ths, "xxx" 16th triplet,
//  "xxxx" four 32nds, "6" six 32nd triplets (a fast roll that rises in volume).
function hats(tokens) {
  const out = [];
  tokens.forEach((tok, i) => {
    const t = i * 48;
    const strong = i % 2 === 0;
    if (tok === '-') return;
    if (tok === 'o') return void out.push({ tick: t, note: OPEN, velocity: 90 });
    const n = tok === '6' ? 6 : tok.length;
    for (let j = 0; j < n; j++) {
      const velocity = n === 1 ? (strong ? 92 : 76) : n === 2 ? (j === 0 ? (strong ? 92 : 78) : 62) : Math.round(58 + (36 * j) / (n - 1));
      out.push({ tick: t + Math.round((48 * j) / n), note: HAT, velocity });
    }
  });
  return out;
}

function bar({ k = '', s = '', c = '', r = '', h = [], crash = false, tom = '' }) {
  const snare = steps(s, SNARE, 108);
  return [
    ...steps(k, KICK, 112),
    ...snare,
    // The clap doubles the snare, so the backbeat still sounds on a kit without a clap.
    ...steps(c, CLAP, 100),
    ...steps(r, RIM, 84),
    ...steps(tom, TOM, 96),
    ...hats(h),
    ...(crash ? [{ tick: 0, note: CRASH, velocity: 100 }] : []),
  ];
}

const E8 = ['x', 'x', 'x', 'x', 'x', 'x', 'x', 'x'];

const intro = (h = E8) => [bar({ h, crash: true })];
const ending = () => [bar({ k: 'X...............', c: '........x.......', s: '........x.......', crash: true, h: ['x', '-', '-', '-', '-', '-', '-', '-'] })];
const snareRoll = (k = 'x.......x.......') => bar({ k, s: '........x.x.xxxx', c: '........x.......', h: ['x', 'x', 'x', 'x', '-', '-', '-', '-'] });
const tomFill = (k = 'x..x....x.......') => bar({ k, s: '........x.....x.', c: '........x.......', tom: '..........x.xx.x', h: ['x', 'xx', 'x', 'xxxx', '-', '-', '-', '-'] });
const hatFill = (k = 'x.....x.........') => bar({ k, s: '........x.......', c: '........x.......', h: ['x', 'xx', 'xxx', 'xxxx', 'x', 'xxxx', '6', '6'] });
const stopFill = (k = 'x..x..x.........') => bar({ k, s: '............x.xx', c: '............x...', h: ['x', 'x', 'x', '-', '-', '-', '-', '-'] });

// Parts in file order: Intro, A, Fill A, B, Fill B, C, Fill C, D, Fill D, Ending.
export const PRESETS = [
  {
    name: 'TRAP ATLANTA', tempo: 140, kit: 15,
    about: 'Classic half-time trap. Snare and clap on beat 3, rolling hats.',
    parts: [
      intro(),
      [bar({ k: 'x.....x...x.....', s: '........x.......', c: '........x.......', h: ['x', 'x', 'x', 'xx', 'x', 'x', 'x', 'xxxx'] }),
       bar({ k: 'x..x......x..x..', s: '........x.......', c: '........x.......', h: ['x', 'x', 'xxx', 'x', 'x', 'x', 'xx', 'o'] })],
      [snareRoll()],
      [bar({ k: 'x..x..x...x.x...', s: '........x.......', c: '........x.......', h: ['x', 'xx', 'x', 'xxxx', 'x', 'xx', 'x', 'xxx'] }),
       bar({ k: 'x.....x..xx...x.', s: '........x.....g.', c: '........x.......', h: ['x', 'xx', 'x', 'xx', 'x', 'xxxx', 'x', 'o'] })],
      [hatFill()],
      [bar({ k: 'x.........x.....', s: '........x.......', c: '........x.......', h: ['x', 'o', 'x', 'o', 'x', 'o', 'x', 'xxxx'] }),
       bar({ k: 'x..x......x..x..', s: '........x.......', c: '........x.......', h: ['x', 'o', 'x', 'xxx', 'x', 'o', 'xx', '6'] })],
      [tomFill()],
      [bar({ k: 'x...............', c: '........x.......', h: ['x', '-', 'x', '-', 'x', '-', 'x', '-'] }),
       bar({ k: 'x.........x.....', c: '........x.......', h: ['x', '-', 'x', '-', 'x', '-', 'xx', 'xxxx'] })],
      [stopFill()],
      ending(),
    ],
  },
  {
    name: 'TRAP DRILL', tempo: 142, kit: 15,
    about: 'UK drill feel. Triplet hats, snare on beat 3 then late on beat 4.',
    parts: [
      intro(['x', 'x', 'xxx', 'x', 'x', 'x', 'xxx', 'x']),
      [bar({ k: 'x..x......x.....', s: '........x.......', c: '........x.......', h: ['x', 'x', 'xxx', 'x', 'x', 'xx', 'x', 'xxx'] }),
       bar({ k: 'x.....x..x......', s: '............x...', c: '............x...', r: '......x.........', h: ['x', 'x', 'xxx', 'x', 'x', 'x', 'xxx', 'x'] })],
      [snareRoll('x..x......x.....')],
      [bar({ k: 'x..x..x...x..x..', s: '........x.......', c: '........x.......', h: ['x', 'xxx', 'x', 'x', 'xxx', 'x', 'x', 'xxx'] }),
       bar({ k: 'x.....x..x..x...', s: '............x..g', c: '............x...', r: '....x...........', h: ['x', 'x', 'xxx', 'x', 'xx', 'x', 'xxx', 'o'] })],
      [hatFill('x..x............')],
      [bar({ k: 'x..x......x.....', s: '........x.......', c: '........x.......', r: '..x...x.......x.', h: ['x', 'x', 'xxx', 'o', 'x', 'xx', 'x', 'xxx'] }),
       bar({ k: 'x.....x..x......', s: '............x...', c: '............x...', r: '..x.......x.....', h: ['x', 'o', 'xxx', 'x', 'x', 'x', '6', 'o'] })],
      [tomFill('x..x......x.....')],
      [bar({ k: 'x..x............', c: '........x.......', r: '..x...x...x...x.' }),
       bar({ k: 'x.....x.........', c: '............x...', r: '..x...x...x.....', h: ['-', '-', '-', '-', '-', '-', 'xxx', 'xxxx'] })],
      [stopFill('x..x......x.....')],
      ending(),
    ],
  },
  {
    name: 'TRAP DARK', tempo: 130, kit: 15,
    about: 'Sparse and heavy. Few kicks, steady 16th hats, room for long bass notes.',
    parts: [
      intro(['xx', 'xx', 'xx', 'xx', 'xx', 'xx', 'xx', 'xx']),
      [bar({ k: 'x.........x.....', s: '........x.......', c: '........x.......', h: ['xx', 'xx', 'xx', 'xx', 'xx', 'xx', 'xx', 'xxxx'] }),
       bar({ k: 'x......x........', s: '........x.......', c: '........x.......', h: ['xx', 'xx', 'xx', 'xxx', 'xx', 'xx', 'xx', 'xx'] })],
      [snareRoll('x...............')],
      [bar({ k: 'x.........x..x..', s: '........x.......', c: '........x.......', h: ['xx', 'xx', 'xxxx', 'xx', 'xx', 'xx', 'xx', 'xxxx'] }),
       bar({ k: 'x......x..x.....', s: '........x......g', c: '........x.......', h: ['xx', 'xx', 'xx', 'xx', 'xx', 'xxxx', 'xx', 'o'] })],
      [hatFill('x...............')],
      [bar({ k: 'x.........x.....', s: '........x.......', c: '........x.......', h: ['xx', 'o', 'xx', 'xx', 'xx', 'o', 'xx', '6'] }),
       bar({ k: 'x......x.....x..', s: '........x.......', c: '........x.......', h: ['xx', 'xx', 'xx', 'o', 'xx', 'xxxx', '6', 'o'] })],
      [tomFill('x.........x.....')],
      [bar({ k: 'x...............', c: '........x.......' }),
       bar({ k: 'x......x........', c: '........x.......', h: ['-', '-', '-', '-', '-', '-', 'xx', 'xxxx'] })],
      [stopFill('x......x........')],
      ending(),
    ],
  },
  {
    name: 'TRAP BOUNCE', tempo: 150, kit: 15,
    about: 'Up-tempo and bouncy. Clap on beats 2 and 4, busy syncopated kick.',
    parts: [
      intro(),
      [bar({ k: 'x..x..x.....x.x.', s: '....x.......x...', c: '....x.......x...', h: ['x', 'x', 'x', 'xx', 'x', 'x', 'x', 'xx'] }),
       bar({ k: 'x..x..x...x...x.', s: '....x.......x...', c: '....x.......x...', h: ['x', 'x', 'xx', 'x', 'x', 'xxx', 'x', 'o'] })],
      [bar({ k: 'x..x..x.........', s: '....x...x.x.xxxx', c: '....x...........', h: ['x', 'x', 'x', 'x', '-', '-', '-', '-'] })],
      [bar({ k: 'x.xx..x..x..x.x.', s: '....x.......x...', c: '....x.......x...', h: ['x', 'xx', 'x', 'xx', 'x', 'xx', 'x', 'xxxx'] }),
       bar({ k: 'x..x..x.x.x...x.', s: '....x.......x..g', c: '....x.......x...', h: ['x', 'xx', 'xxx', 'x', 'x', 'xx', 'xxxx', 'o'] })],
      [hatFill('x..x..x.........')],
      [bar({ k: 'x..x..x.....x.x.', s: '....x.......x...', c: '....x.......x...', h: ['x', 'o', 'x', 'o', 'x', 'o', 'x', 'o'] }),
       bar({ k: 'x..x..x...x...x.', s: '....x.......x...', c: '....x.......x...', h: ['x', 'o', 'x', 'o', 'x', 'o', 'xx', '6'] })],
      [tomFill('x..x..x.........')],
      [bar({ k: 'x.....x.........', c: '....x.......x...', h: ['x', '-', 'x', '-', 'x', '-', 'x', '-'] }),
       bar({ k: 'x.....x...x.....', c: '....x.......x...', h: ['x', '-', 'x', '-', 'x', 'xx', 'xxx', 'xxxx'] })],
      [stopFill('x..x..x...x.....')],
      ending(),
    ],
  },
  {
    name: 'TRAP ROLLS', tempo: 145, kit: 15,
    about: 'Hat showcase. Constant 16ths with triplet and 32nd rolls in every bar.',
    parts: [
      intro(['xx', 'xx', 'xxx', 'xx', 'xx', 'xxxx', 'xx', '6']),
      [bar({ k: 'x......x..x.....', s: '........x.......', c: '........x.......', h: ['xx', 'xxxx', 'xx', 'xxx', 'xx', 'xx', 'xx', '6'] }),
       bar({ k: 'x..x......x...x.', s: '........x.......', c: '........x.......', h: ['xx', 'xx', 'xxx', 'xxxx', 'xx', 'xxx', 'xx', 'xxxx'] })],
      [snareRoll('x......x........')],
      [bar({ k: 'x..x...x..x..x..', s: '........x.......', c: '........x.......', h: ['xxx', 'xx', 'xxxx', 'xx', 'xxx', 'xx', '6', 'xx'] }),
       bar({ k: 'x......x.xx.....', s: '........x.....g.', c: '........x.......', h: ['xx', '6', 'xx', 'xxx', 'xx', 'xxxx', 'xxx', 'o'] })],
      [hatFill('x......x........')],
      [bar({ k: 'x......x..x.....', s: '........x.......', c: '........x.......', h: ['xx', 'o', 'xxx', 'xx', 'xx', 'o', 'xxxx', '6'] }),
       bar({ k: 'x..x......x...x.', s: '........x.......', c: '........x.......', h: ['xxxx', 'xx', 'o', 'xxx', 'xx', '6', 'xx', 'o'] })],
      [tomFill('x......x........')],
      [bar({ k: 'x...............', c: '........x.......', h: ['xx', 'xx', 'xx', 'xx', 'xx', 'xx', 'xx', 'xx'] }),
       bar({ k: 'x......x........', c: '........x.......', h: ['xx', 'xx', 'xx', 'xx', 'xxx', 'xxx', 'xxxx', '6'] })],
      [stopFill('x......x..x.....')],
      ending(),
    ],
  },
  {
    name: 'TRAP SOUL', tempo: 90, kit: 14,
    about: 'Slow and laid back for guitar and synth loops. Rim clicks, soft ghost snares.',
    parts: [
      intro(['x', 'x', 'x', 'x', 'x', 'x', 'x', 'xx']),
      [bar({ k: 'x......x..x.....', s: '....x.......x...', c: '....x.......x...', r: '..x...........x.', h: ['x', 'x', 'x', 'xx', 'x', 'x', 'x', 'xxx'] }),
       bar({ k: 'x.x....x..x.....', s: '....x.......x..g', c: '....x.......x...', r: '......x.........', h: ['x', 'x', 'xx', 'x', 'x', 'x', 'xxxx', 'o'] })],
      [bar({ k: 'x......x........', s: '....x.....x.xxxx', c: '....x...........', h: ['x', 'x', 'x', 'x', 'x', '-', '-', '-'] })],
      [bar({ k: 'x..x...x..x..x..', s: '....x.......x...', c: '....x.......x...', r: '..x.......x.....', h: ['x', 'xx', 'x', 'xx', 'x', 'xx', 'x', 'xxxx'] }),
       bar({ k: 'x.x....x.xx.....', s: '....x..g....x...', c: '....x.......x...', h: ['x', 'xx', 'xxx', 'x', 'x', 'xx', '6', 'o'] })],
      [hatFill('x......x........')],
      [bar({ k: 'x......x..x.....', s: '....x.......x...', c: '....x.......x...', h: ['x', 'o', 'x', 'x', 'x', 'o', 'x', 'xx'] }),
       bar({ k: 'x.x....x..x.....', s: '....x.......x...', c: '....x.......x...', h: ['x', 'o', 'x', 'xxx', 'x', 'o', 'xxxx', '6'] })],
      [tomFill('x......x........')],
      [bar({ k: 'x...............', r: '....x.......x...', h: ['x', '-', 'x', '-', 'x', '-', 'x', '-'] }),
       bar({ k: 'x......x........', r: '....x.......x...', h: ['x', '-', 'x', '-', 'x', '-', 'xx', 'xxx'] })],
      [stopFill('x......x........')],
      ending(),
    ],
  },
];
