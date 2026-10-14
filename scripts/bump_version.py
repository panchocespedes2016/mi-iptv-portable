#!/usr/bin/env python3
"""Sube el patch de la versión (0.1.0 -> 0.1.1) en todos los manifiestos.
Imprime la nueva versión a stdout. Lo corre el CI en cada compilación."""
import json
import re
import sys

FILES_JSON = ['src-tauri/tauri.conf.json', 'package.json', 'package-lock.json']


def main():
    p = 'src-tauri/tauri.conf.json'
    with open(p, encoding='utf-8') as f:
        conf = json.load(f)
    parts = conf['version'].split('.')
    parts[-1] = str(int(parts[-1]) + 1)
    nv = '.'.join(parts)
    conf['version'] = nv
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(conf, f, indent=2)
        f.write('\n')

    cargo = 'src-tauri/Cargo.toml'
    with open(cargo, encoding='utf-8') as f:
        t = f.read()
    t = re.sub(r'^version = "[^"]*"$', f'version = "{nv}"', t, count=1, flags=re.M)
    with open(cargo, 'w', encoding='utf-8') as f:
        f.write(t)

    for fp in ['package.json', 'package-lock.json']:
        with open(fp, encoding='utf-8') as f:
            d = json.load(f)
        d['version'] = nv
        pkgs = d.get('packages')
        if isinstance(pkgs, dict) and '' in pkgs:
            pkgs['']['version'] = nv
        with open(fp, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=2)
            f.write('\n')

    print(nv)


if __name__ == '__main__':
    sys.exit(main())
