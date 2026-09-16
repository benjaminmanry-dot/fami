"""Restore an owner JSON export into a NEW private SQLite database for recovery QA.

The export arrives on stdin. No source content or credential hashes are printed.
Never overwrites a file and never connects to the live Site. Use the current
schema migrations, then verify exact rows and foreign-key/integrity checks.
"""
import argparse
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
TABLES = ('accounts', 'credentials', 'entries', 'replies', 'follows', 'events',
          'mutations', 'reports', 'settings', 'host_cycles', 'introductions')

def restore(data, destination):
    destination = Path(destination).resolve()
    private = (ROOT / '.private').resolve()
    if not destination.is_relative_to(private):
        raise ValueError('Recovery output must be inside this project .private directory.')
    if destination.exists():
        raise ValueError('Refusing to overwrite an existing recovery database.')
    if data.get('format') != 'rookery-export-v1' or set(data.get('tables', {})) != set(TABLES):
        raise ValueError('Unsupported export format or table set.')
    if any(not isinstance(data['tables'][t], list) or len(data['tables'][t]) > 10000 for t in TABLES):
        raise ValueError('Invalid or oversized exported table.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation also closes the gap between the existence check and use.
    with destination.open('xb'):
        pass
    connection = sqlite3.connect(destination)
    try:
        connection.execute('PRAGMA foreign_keys=ON')
        for migration in sorted((ROOT / 'drizzle').glob('*.sql')):
            connection.executescript(migration.read_text(encoding='utf-8-sig'))
        with connection:
            for table in TABLES:
                columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
                sql = f'INSERT INTO "{table}" ({",".join(chr(34)+c+chr(34) for c in columns)}) VALUES ({",".join("?" for _ in columns)})'
                for row in data['tables'][table]:
                    if not isinstance(row, dict) or set(row) != set(columns):
                        raise ValueError(f'Column mismatch in {table}.')
                    if any(value is not None and type(value) not in (str, int, float) for value in row.values()):
                        raise ValueError(f'Unsupported value in {table}.')
                    connection.execute(sql, [row[column] for column in columns])
        if connection.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Restored foreign keys do not agree.')
        if connection.execute('PRAGMA integrity_check').fetchone() != ('ok',):
            raise ValueError('SQLite integrity check failed.')
        connection.row_factory = sqlite3.Row
        for table in TABLES:
            restored = [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"')]
            canonical = lambda rows: sorted(json.dumps(row, sort_keys=True, ensure_ascii=False) for row in rows)
            if canonical(restored) != canonical(data['tables'][table]):
                raise ValueError(f'Restored rows differ in {table}.')
        return {table: len(data['tables'][table]) for table in TABLES}
    except Exception:
        connection.close()
        # This file was exclusively created above, is within .private, and is not
        # a predecessor or user-supplied database. Never remove anything else.
        destination.unlink(missing_ok=True)
        raise
    finally:
        connection.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        raw = sys.stdin.read(25_000_001)
        if len(raw) > 25_000_000:
            raise ValueError('Export exceeds the local recovery size limit.')
        counts = restore(json.loads(raw), args.output)
        print(json.dumps({'restored': True, 'rows': counts, 'live_site_changed': False}))
    except (ValueError, KeyError, sqlite3.Error, OSError) as error:
        print(f'Recovery refused: {type(error).__name__}. Check the export format and target path.', file=sys.stderr)
        sys.exit(1)
