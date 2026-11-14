#!/usr/bin/env python3
"""Embed the reviewed snapshot fix in the existing Ring-MQTT startup command.

Keeps deployment a single Compose file: no mutable remote downloads, bind mounts,
new images, or extra packages are required by the production service.
"""
from pathlib import Path


HERE = Path(__file__).resolve().parent
COMPOSE = HERE.parent / 'docker-compose.yml'
BEGIN = '        # BEGIN snapshot-jpeg:v1\n'
END = '        # END snapshot-jpeg:v1\n'


def render():
    text = COMPOSE.read_text()
    if BEGIN in text:
        start = text.index(BEGIN)
        finish = text.index(END, start) + len(END)
        text = text[:start] + text[finish:]
    anchor = "        umask 077\n        node <<'NODE'\n"
    if text.count(anchor) != 1:
        raise SystemExit('Expected exactly one Ring-MQTT configuration bootstrap')
    patcher = (HERE / 'apply-patch.cjs').read_text()
    code = patcher
    # Compose interpolation must not interpret JavaScript dollar signs.
    code = code.replace('$', '$$')
    block = BEGIN + "        node --input-type=commonjs - --apply <<'SNAPSHOT_PATCH'\n" + ''.join(('        ' + line if line else '') + '\n' for line in code.splitlines()) + '        SNAPSHOT_PATCH\n' + END
    text = text.replace(anchor, '        umask 077\n' + block + "        node <<'NODE'\n", 1)
    COMPOSE.write_text(text)
    print('Embedded settings-only overlay and pinned-source guard in Ring-MQTT startup')


if __name__ == '__main__':
    render()
