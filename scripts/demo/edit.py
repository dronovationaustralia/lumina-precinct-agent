#!/usr/bin/env python3
"""
Cut the raw demo recording to the submission length.

  python scripts/demo/edit.py [--in data/derived/demo/walkthrough.webm] [--events .../events.json]
                              [--out data/derived/demo/lumina-demo.mp4] [--target 175]

Uses the marks written by record.mjs: typing (type:start/end) plays 3x, waiting for a model
(wait:start/end) plays 6x with a "6x" badge so nothing is hidden, a failed scene is cut, and the
rest is sped up evenly (at most 1.3x) only if needed to land under --target seconds. Black frames
before the first page paint are trimmed. Writes a silent H.264 MP4 plus a .cuts.json that maps
every scene to its time in the cut (for the narration script and voice-over).
Needs ffmpeg and ffprobe on PATH.
"""
import argparse, json, subprocess, sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--in', dest='src', default='data/derived/demo/walkthrough.webm')
ap.add_argument('--events', default='data/derived/demo/events.json')
ap.add_argument('--out', default='data/derived/demo/lumina-demo.mp4')
ap.add_argument('--target', type=float, default=175.0)
ap.add_argument('--font', default='')
a = ap.parse_args()

ev = json.loads(Path(a.events).read_text())['events']
# Playwright's WebM has no seek index, so seeking into it lands in the wrong place; remux once (no re-encode).
indexed = Path(a.out).with_suffix('.src.mkv')
Path(a.out).parent.mkdir(parents=True, exist_ok=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', a.src, '-c', 'copy', str(indexed)], check=True)
a.src = str(indexed)
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', a.src]).decode().strip())

# Leading blank frames (the page before first paint): flat dark grey with no bright pixels.
st = subprocess.run(['ffmpeg', '-hide_banner', '-t', '15', '-i', a.src, '-vf', 'fps=10,signalstats,metadata=print:key=lavfi.signalstats.YMAX',
                     '-an', '-f', 'null', '-'], capture_output=True, text=True).stderr
lead, t = 0.0, None
for line in st.splitlines():
    if 'pts_time:' in line:
        t = float(line.split('pts_time:')[1].split()[0])
    elif 'YMAX=' in line and t is not None:
        if float(line.split('YMAX=')[1]) > 200:
            lead = t + 0.15
            break

# Scene spans and failed scenes.
starts = {e['name'][:-6]: e['t'] for e in ev if e['name'].endswith(':start') and e['name'][:-6] not in ('type', 'wait')}
ends = {e['name'][:-4]: e['t'] for e in ev if e['name'].endswith(':end') and e['name'][:-4] not in ('type', 'wait')}
failed = [e['name'][:-7] for e in ev if e['name'].endswith(':failed')]
cuts = []
for name in failed:
    nxt = min([t for t in starts.values() if t > starts[name]] + [dur])
    cuts.append((starts[name], nxt))

# Fast spans: typing 3x, waits 6x.
fast = []
open_ = {}
for e in ev:
    for kind, speed in (('type', 3.0), ('wait', 6.0)):
        if e['name'] == f'{kind}:start':
            open_[kind] = e['t']
        elif e['name'] == f'{kind}:end' and kind in open_:
            fast.append((open_.pop(kind), e['t'], speed, kind == 'wait'))

def inside(t, spans):
    return any(s <= t < e for s, e in spans)

# Build segments over [lead, dur], skipping cuts.
points = sorted({lead, dur, *[p for s, e in cuts for p in (s, e)], *[p for s, e, *_ in fast for p in (s, e)]})
points = [p for p in points if lead <= p <= dur]
segs = []
for s, e in zip(points, points[1:]):
    if e - s < 0.05 or inside((s + e) / 2, cuts):
        continue
    f = next(((sp, badge) for fs, fe, sp, badge in fast if fs <= s and e <= fe), None)
    segs.append({'s': s, 'e': e, 'speed': f[0] if f else 1.0, 'badge': bool(f and f[1]), 'fast': bool(f)})

# Even speed-up of the normal spans if still over target.
fixed = sum((g['e'] - g['s']) / g['speed'] for g in segs if g['fast'])
normal = sum(g['e'] - g['s'] for g in segs if not g['fast'])
k = min(1.3, max(1.0, normal / max(1.0, a.target - fixed)))
for g in segs:
    if not g['fast']:
        g['speed'] = k
total = sum((g['e'] - g['s']) / g['speed'] for g in segs)

# Map scene starts into the cut timeline.
def cut_time(t):
    out = 0.0
    for g in segs:
        if t >= g['e']:
            out += (g['e'] - g['s']) / g['speed']
        elif t > g['s']:
            out += (t - g['s']) / g['speed']
    return round(out, 2)

scenes = [{'scene': n, 'raw': starts[n], 'cut': cut_time(starts[n]), 'cut_end': cut_time(ends.get(n, starts[n]))}
          for n in sorted(starts, key=starts.get) if n not in failed]

font = f":fontfile='{a.font}'" if a.font else ''
Path(a.out).parent.mkdir(parents=True, exist_ok=True)
tmp = Path(a.out).with_suffix('.parts')
tmp.mkdir(exist_ok=True)
names = []
for i, g in enumerate(segs):
    pre = max(0.0, g['s'] - 2)
    vf = f"trim=start={g['s'] - pre:.3f}:duration={g['e'] - g['s']:.3f},setpts=(PTS-STARTPTS)/{g['speed']:.4f},fps=30,format=yuv420p"
    if g['badge']:
        vf += (f",drawtext=text='{g['speed']:g}x  waiting for the model'{font}:fontsize=26:fontcolor=white:"
               "box=1:boxcolor=0x1f5fad@0.9:boxborderw=12:x=w-tw-40:y=60")
    part = tmp / f'p{i:03d}.mp4'
    # Seek before the input (fast), trim exactly after it; one segment at a time keeps memory low.
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{pre:.3f}', '-i', a.src,
                    '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', str(part)], check=True)
    names.append(part)
(tmp / 'list.txt').write_text(''.join(f"file '{n.name}'\n" for n in names))
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(tmp / 'list.txt'), '-c', 'copy', '-movflags', '+faststart', a.out], check=True)
for n in names:
    n.unlink()
(tmp / 'list.txt').unlink()
tmp.rmdir()
indexed.unlink()
Path(a.out).with_suffix('.cuts.json').write_text(json.dumps({'total': round(total, 2), 'lead_trimmed': lead, 'normal_speed': round(k, 3),
                                                          'cut_scenes': failed, 'scenes': scenes}, indent=2))
print(f'Wrote {a.out}: {total:.1f} s (normal parts at {k:.2f}x, cut: {failed or "none"})')
for sc in scenes:
    print(f"  {sc['cut']:6.1f}–{sc['cut_end']:6.1f}  {sc['scene']}")
if total > 180:
    print('Warning: over 3:00', file=sys.stderr)
