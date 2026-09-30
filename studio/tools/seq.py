"""Turn a clip (a generated video, a Blender render, any mp4) into an image sequence the engine can
draw frame by frame (studio/engine/sequence.js).

    python studio/tools/seq.py <clip.mp4> <film>/assets/seq/<name> [--fps 30] [--width 1920]
                               [--from 0.5 --to 4.2] [--quality 90] [--loop] [--sheet]

Writes 00001.webp ... and index.json { fps, count, w, h, ext, source }. --fps resamples (a 24 fps
generation drawn in a 60 fps film is fine at 24 or 30: the engine holds each frame). --sheet also
writes <dir>/sheet.jpg, a contact sheet of the clip, to look at it before using it.
"""
import argparse
import json
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('clip')
    ap.add_argument('out')
    ap.add_argument('--fps', type=float, default=30)
    ap.add_argument('--width', type=int, default=1920)
    ap.add_argument('--from', dest='t0', type=float)
    ap.add_argument('--to', dest='t1', type=float)
    ap.add_argument('--quality', type=int, default=90)
    ap.add_argument('--loop', action='store_true')
    ap.add_argument('--sheet', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for f in os.listdir(a.out):
        if f.endswith('.webp'):
            os.remove(os.path.join(a.out, f))
    cmd = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error']
    if a.t0:
        cmd += ['-ss', str(a.t0)]
    cmd += ['-i', a.clip]
    if a.t1:
        cmd += ['-t', str(a.t1 - (a.t0 or 0))]
    cmd += ['-vf', f'fps={a.fps},scale={a.width}:-2:flags=lanczos', '-c:v', 'libwebp', '-quality', str(a.quality), '-compression_level', '4', os.path.join(a.out, '%05d.webp')]
    subprocess.run(cmd, check=True)
    frames = sorted(f for f in os.listdir(a.out) if f.endswith('.webp'))
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
                            os.path.join(a.out, frames[0])], capture_output=True, text=True).stdout.strip().split(',')
    idx = {'fps': a.fps, 'count': len(frames), 'w': int(probe[0]), 'h': int(probe[1]), 'ext': 'webp', 'loop': a.loop,
           'source': os.path.basename(a.clip), 'range': [a.t0 or 0, a.t1]}
    json.dump(idx, open(os.path.join(a.out, 'index.json'), 'w'), indent=1)
    size = sum(os.path.getsize(os.path.join(a.out, f)) for f in frames) / 1048576
    print(f"{len(frames)} frames {idx['w']}x{idx['h']} at {a.fps:g} fps ({len(frames) / a.fps:.2f} s, {size:.1f} MB) -> {a.out}")
    if a.sheet:
        n = len(frames)
        pick = [frames[int(i * (n - 1) / 11)] for i in range(12)] if n >= 12 else frames
        lst = os.path.join(a.out, '_sheet.txt')
        with open(lst, 'w') as fh:
            for f in pick:
                fh.write(f"file '{os.path.abspath(os.path.join(a.out, f)).replace(os.sep, '/')}'\n")
        subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst,
                        '-vf', 'scale=480:-2,tile=4x3:padding=4:color=0x111111', '-frames:v', '1', os.path.join(a.out, 'sheet.jpg')], check=True)
        os.remove(lst)
        print('sheet ->', os.path.join(a.out, 'sheet.jpg'))


if __name__ == '__main__':
    main()
