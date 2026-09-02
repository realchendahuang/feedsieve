import { describe, expect, it } from 'vitest';
import manifestJson from '../../../community/lists/manifest.json';
import officialJson from '../../../community/lists/official.json?raw';
import readableYaml from '../../../community/lists/blocklist.yaml?raw';
import { sha256Hex } from './hash';
import { parseManifest, parseSnapshotBody } from './validate';

describe('bundled public blocklist artifacts', () => {
  it('keeps readable YAML and machine JSON aligned with the checked-in manifest', async () => {
    const parsedManifest = parseManifest(manifestJson);
    expect(parsedManifest.ok).toBe(true);
    if (!parsedManifest.ok) return;

    expect(parsedManifest.value.files.map((file) => file.path).sort()).toEqual([
      'blocklist.yaml',
      'official.json',
    ]);
    for (const file of parsedManifest.value.files) {
      const body = file.path === 'official.json' ? officialJson : readableYaml;
      expect(await sha256Hex(body)).toBe(file.sha256);
      if (file.path === 'official.json') {
        const parsed = parseSnapshotBody(body);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.value.entries).toHaveLength(file.entries);
          expect(parsed.value.entries.every((entry) => entry.sources.length > 0)).toBe(true);
        }
      } else {
        expect(body).toContain("formula: 'block_votes - false_positive_votes'");
        expect(body).toContain(`accounts: ${file.entries}`);
      }
    }
  });
});
