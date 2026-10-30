// Synthesises the built-in notification sounds into public/sounds/*.wav.
// Made from sine waves here, so they carry no third-party licence.
// Run after editing a sound: node scripts/sounds.mjs
import { writeFile } from 'node:fs/promises'

const RATE = 22050

// notes: [startSeconds, hz, decayPerSecond, gain, partials ([ratio, gain])]
function render(seconds, notes) {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (const [start, hz, decay, gain, partials = [[1, 1]]] of notes) {
    for (let i = Math.round(start * RATE); i < out.length; i++) {
      const t = i / RATE - start
      // 5 ms attack, so no click at the start of a note.
      const env = Math.min(1, t / 0.005) * Math.exp(-decay * t) * gain
      for (const [ratio, g] of partials) out[i] += env * g * Math.sin(2 * Math.PI * hz * ratio * t)
    }
  }
  return out
}

function wav(samples) {
  const peak = Math.max(...samples.map(Math.abs))
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(RATE, 24)
  buf.writeUInt32LE(RATE * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((s, i) => buf.writeInt16LE(Math.round((s / peak) * 0.7 * 32767), 44 + i * 2))
  return buf
}

const bellPartials = [[1, 1], [2.76, 0.4], [5.4, 0.15]]
const SOUNDS = {
  chime: render(0.9, [
    [0, 1318.5, 6, 1, [[1, 1], [2, 0.2]]],
    [0.12, 1760, 5, 1, [[1, 1], [2, 0.2]]],
  ]),
  ping: render(0.5, [[0, 1975.5, 10, 1, [[1, 1], [3, 0.08]]]]),
  pop: render(0.25, [[0, 520, 28, 1, [[1, 1], [1.5, 0.3]]]]),
  bell: render(1.4, [[0, 880, 3.5, 1, bellPartials]]),
}
for (const [name, samples] of Object.entries(SOUNDS)) {
  await writeFile(`public/sounds/${name}.wav`, wav(samples))
}
