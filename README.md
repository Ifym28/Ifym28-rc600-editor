# RC-600 Editor

A macOS desktop editor for the BOSS RC-600 Loop Station. It reads and writes the
looper storage directly over USB: memories, loops, rhythm settings, system
settings, setlists and backups, in one window.

The interface uses the colours of the looper itself (black chassis, red
indicators, amber warnings) in a Japanese mecha cockpit style.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```sh
npm install
npm start          # opens the app
```

To build a normal macOS app (`dist/RC-600 Editor-*.dmg`, Apple Silicon and Intel):

```sh
npm run dist
```

The app has no Apple developer certificate (it is signed ad hoc). The first time,
macOS blocks it: open System Settings > Privacy & Security and press **Open Anyway**.

The repository also has a GitHub Actions workflow, "RC-600 Editor (macOS build)".
It builds the `.dmg` on a macOS runner and attaches it to the run as an artifact.

To look at the interface without the looper, run `npm run demo` and open
http://localhost:5600. That is a demo volume in memory, and nothing is written to disk.

## Connect the looper

1. Connect the RC-600 to the Mac by USB.
2. On the looper: MENU > USB > STORAGE > CONNECT.
3. The volume appears under **RC-600 STORAGE**. Press **Connect volume**.
   **Browse** opens a copy of the `ROLAND` folder instead, for example a backup.
4. When you are done, press **Eject**, then leave storage mode on the looper.

USB MIDI is optional. With it linked, selecting a memory in the app sends a
Program Change so the looper follows, and the Overview has Start and Stop.

## What it does

| View | Function |
| --- | --- |
| Overview | All 99 memories in one matrix, with name, loops per track and tempo. |
| Memory Editor | Track settings (level, pan, reverse, 1-shot, FX, start, stop and dub mode, sync, inputs), Rec and Play, rhythm, assigns, input, output, mixer, EQ, pedals. |
| Input FX / Track FX | Banks A to D, four slots each, with the stored parameters of each effect type. |
| Rhythm | Rhythm settings of the memory, and a step pattern composer with preview and `.mid` export. |
| System | Global settings from `SYSTEM1/2.RC0`. |
| Audio | Per track: waveform, play, import, export, copy, paste, delete. Play all with track levels. Bounce selected tracks to a file or to a track. |
| Setlists | Ordered lists of memories with notes, stored in the app. |
| Manager | Copy or swap memories, with or without loops. Backup and restore. |

Edits stay in the app until you press **Write** (or Cmd+S). Changed values turn amber, and
Memory Editor > Info lists every pending change.

## How it writes, and how it keeps your data safe

- The looper keeps two copies of each memory (`MEMORY001A.RC0`, `MEMORY001B.RC0`)
  and loads the one with the higher save count. **Write** puts the new version in
  the older copy and raises the count, the same way the looper saves. The previous
  version stays on disk in the other file.
- A write replaces only the characters of the values that changed. All other
  bytes of the file stay the same.
- A deleted or replaced loop is first copied to the app trash folder
  (`~/Library/Application Support/RC-600 Editor/trash`).
- **Save backup** copies the settings, or the settings and all loops, to
  `~/Documents/RC-600 Backups`.
- Imported audio is converted to the looper format: 44.1 kHz, stereo, 32-bit float.

## Limits you should know

Roland does not document the storage format. This app follows the RC-600
Parameter Guide and the mapping work of the community.

- **Not yet tested on a real RC-600.** The file reader and writer are tested
  against memory and system files saved by real units, and the whole app is
  tested against a folder on disk. Make a full backup before the first write.
- Parameters with a known meaning have names. All others show their tag letter
  and raw number, so nothing is hidden. Every control shows its tag letter.
- Assign sources and targets, and effect parameters, are raw numbers in the
  order of the Parameter Guide.
- The step composer exports a Standard MIDI File. The looper loads user rhythms
  through the BOSS RC Rhythm Converter, which reads that file.
- BOSS Tone Studio stays the official way to import audio. The direct import
  here writes the WAV and the track length tags itself.

## Development

```sh
npm test           # unit tests: file format, WAV, MIDI file, device operations
```

| Path | Content |
| --- | --- |
| `electron/` | Main process. File access is limited to folders the user connected. |
| `app/js/rc0.js` | Reader and writer for `.RC0` files. |
| `app/js/device.js` | Scan, A/B save, loops, copy and swap. |
| `app/js/params.js` | Names for the lettered tags. |
| `app/js/view-*.js`, `app.js` | The interface. |
| `app/css/mecha.css` | The theme. |

Fonts: Chakra Petch and Share Tech Mono, SIL Open Font License (see `app/fonts`).

BOSS and RC-600 are trademarks of Roland Corporation. This project is not
affiliated with Roland.
