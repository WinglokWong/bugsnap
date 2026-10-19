#!/usr/bin/env python3
"""Build a deterministic unpacked-extension ZIP without development fixtures."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    if not re.fullmatch(r'\d+(?:\.\d+){1,3}', version):
        raise ValueError('Unexpected manifest version')

    names = {'manifest.json', 'sidepanel.html', 'styles.css', 'README.md', 'CHANGELOG.md', 'docs/simple-mode.jpg'}
    names.update(p.name for p in ROOT.glob('*.js') if not p.name.startswith('test-'))
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'icons').glob('*.png'))
    for name in names:
        source = ROOT / name
        if not source.is_file() or source.is_symlink():
            raise ValueError(f'Invalid package input: {name}')
        if name.endswith('.js'):
            for relative in re.findall(r"from ['\"](\.[^'\"]+)['\"]", source.read_text(encoding='utf-8')):
                dependency = (source.parent / relative).resolve().relative_to(ROOT).as_posix()
                if dependency not in names:
                    raise ValueError(f'Missing runtime dependency: {name} -> {dependency}')

    args.output_dir.mkdir(parents=True, exist_ok=True)
    archive = args.output_dir / f'BugSnap-v{version}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name in sorted(names):
            info = zipfile.ZipInfo(f'bugsnap/{name}', date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, (ROOT / name).read_bytes(), compresslevel=9)
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise ValueError('ZIP validation failed')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (args.output_dir / 'SHA256SUMS').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    print(f'Built {archive.name}: {len(names)} files, {archive.stat().st_size:,} bytes')
    print(f'SHA-256: {digest}')


if __name__ == '__main__':
    main()
