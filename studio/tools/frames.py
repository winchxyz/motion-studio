"""Tile frames pulled from a rendered video into one contact sheet (checks the real encode).

    python studio/tools/frames.py <video> 5.30:5.70:0.05 <out.jpg> [cols] [width] [clean]
    python studio/tools/frames.py <video> 1.0,2.9,5.2 <out.jpg> 3 640 clean

Times are seconds; frames are picked by number at the video's own frame rate. 'clean' drops the
timestamps (for styleframe sheets).
"""
import os
import subprocess
import sys

src, spec, dst = sys.argv[1], sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
w = int(sys.argv[5]) if len(sys.argv) > 5 else 480
clean = len(sys.argv) > 6 and sys.argv[6] == 'clean'
if ',' in spec or ':' not in spec:
    times = [float(v) for v in spec.split(',')]
else:
    a, b, s = (float(v) for v in spec.split(':'))
    times, t = [], a
    while t <= b + 1e-6:
        times.append(round(t, 4))
        t += s
r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', src], capture_output=True, text=True).stdout.strip()
num, den = r.split('/')
fps = float(num) / float(den)
rows = (len(times) + cols - 1) // cols
sel = '+'.join(f'eq(n\\,{round(x * fps)})' for x in times)
font = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'fonts', 'GeistMono-VariableFont_wght.ttf').replace('\\', '/').replace(':', '\\:')
label = '' if clean else f"drawtext=fontfile='{font}':text='%{{pts\\:hms}}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6,"
pad = 12 if clean else 4
vf = (f"select='{sel}',scale={w}:-1:flags=lanczos,{label}"
      f"tile={cols}x{rows}:padding={pad}:margin={pad if clean else 0}:color=0x0a0a0a")
cmd = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-vf', vf, '-frames:v', '1', '-fps_mode', 'passthrough', dst]
p = subprocess.run(cmd, capture_output=True, text=True)
print(p.stderr or f'{len(times)} frames -> {dst}')
