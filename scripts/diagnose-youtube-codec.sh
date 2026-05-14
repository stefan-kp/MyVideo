#!/bin/bash
# Diagnose YouTube-Download-Codec on the local machine.
#
# Downloads ONE video from a YouTube URL using the EXACT same yt-dlp
# format selector our downloader.js uses, then runs ffprobe and shows
# whether the file would qualify for direct-play (no FFmpeg re-encode).
#
# Usage:
#   ./scripts/diagnose-youtube-codec.sh <YouTube-Video-URL-or-ID>
#
# Example:
#   ./scripts/diagnose-youtube-codec.sh https://www.youtube.com/watch?v=7N68NjL9cMA

set -e

VID="${1:?USAGE: $0 <YouTube URL or video ID>}"

# Same default as lib/youtube/downloader.js
FORMAT_SELECTOR='bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]'

OUTDIR="$(mktemp -d -t yt-diag-XXXXXX)"
echo "==> Download dir: $OUTDIR"
echo "==> Format selector: $FORMAT_SELECTOR"
echo

# Same args our downloader.js builds (buildDownloadArgs in lib/youtube/downloader.js)
yt-dlp \
  -f "$FORMAT_SELECTOR" \
  --merge-output-format mp4 \
  --no-playlist \
  --no-warnings \
  --restrict-filenames \
  -o "$OUTDIR/%(id)s-%(title).80s.%(ext)s" \
  "$VID"

FILE=$(ls "$OUTDIR"/*.mp4 2>/dev/null | head -1)
if [ -z "$FILE" ]; then
  echo "ERROR: no mp4 produced"
  ls -la "$OUTDIR"
  exit 1
fi

echo
echo "==> File: $FILE"
echo "==> Size: $(ls -lh "$FILE" | awk '{print $5}')"
echo

echo "==> ffprobe streams (JSON, what our codecProbe.js parses):"
echo
ffprobe -v error -print_format json -show_streams -i "$FILE" | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
for s in d['streams']:
    t = s.get('codec_type')
    if t == 'video':
        print(f\"  video:  codec={s.get('codec_name')}  profile={s.get('profile')}  level={s.get('level')}  {s.get('width')}x{s.get('height')}  pix_fmt={s.get('pix_fmt')}\")
    elif t == 'audio':
        print(f\"  audio:  codec={s.get('codec_name')}  profile={s.get('profile')}  rate={s.get('sample_rate')}Hz  channels={s.get('channels')}\")
    else:
        print(f\"  {t}: codec={s.get('codec_name')}\")
"

echo
echo "==> Direct-play decision (mimics lib/content/codecProbe.js decidePlayMode):"
echo "    Requires: .mp4/.m4v ext, video=h264, audio=aac, level<=41 (4.1)"
echo

ffprobe -v error -print_format json -show_streams -i "$FILE" | \
  python3 -c "
import json, sys, os
d = json.load(sys.stdin)
v = next((s for s in d['streams'] if s.get('codec_type')=='video'), None)
a = next((s for s in d['streams'] if s.get('codec_type')=='audio'), None)
ext = os.path.splitext('$FILE')[1].lower()

checks = {
  'ext .mp4 or .m4v': ext in ('.mp4', '.m4v'),
  'video is h264':    v and v.get('codec_name') == 'h264',
  'audio is aac':     a and a.get('codec_name') == 'aac',
  'level <= 4.1':     v is None or v.get('level') is None or v.get('level') <= 41,
}
direct = all(checks.values())
for k, ok in checks.items():
    print(f\"    [{'✓' if ok else '✗'}] {k}\")
print()
if direct:
    print('==> RESULT: direct-play \033[32mYES\033[0m — Pi serves the .mp4 directly, 0% CPU')
else:
    print('==> RESULT: direct-play \033[31mNO\033[0m — Pi has to transcode (libx264 + scale), 60-80% CPU')
"

echo
echo "==> File preserved at: $FILE"
echo "    (delete with: rm -rf $OUTDIR)"
