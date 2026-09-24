/** Ce que l'interface affiche : lecture d'une sauvegarde, formats, avancement. */
import { afterAll, describe, expect, test } from 'bun:test';

import { inspectBackup } from '../src/backup-info';
import * as fmt from '../src/format';
import { createBunHost } from '../src/platform/sqlite-bun';
import { overallRatio } from '../src/progress';
import { ipadBackup } from './fixtures/backups';

const host = createBunHost();
afterAll(() => host.dispose());

describe('inspectBackup', () => {
  test('lit le manifeste et compte ce qu’affiche la carte fichier', async () => {
    const name = 'UserdataBackup_2026-04-02_iPad.jwlibrary';
    const info = await inspectBackup(name, ipadBackup(), host);

    expect(info.name).toBe(name);
    expect(info.deviceName).toBe('iPad');
    expect(info.size).toBeGreaterThan(0);
    expect(info.backup).not.toBeNull();
    expect(info.counts).not.toBeNull();
    for (const n of Object.values(info.counts!)) {
      expect(n).toBeGreaterThan(0);
    }
  }, 120_000);

  test('refuse un fichier qui n’est pas une sauvegarde', async () => {
    const notAZip = new Uint8Array([1, 2, 3, 4]);
    await expect(inspectBackup('bidon.txt', notAZip, host)).rejects.toThrow();
  });
});

describe('format', () => {
  test('nombres et tailles suivent la maquette', () => {
    expect(fmt.count(1043)).toBe('1\u202F043');
    expect(fmt.count(612)).toBe('612');
    expect(fmt.size(7_340_032)).toBe('7,0\u00A0Mo');
    expect(fmt.size(512 * 1024)).toBe('512\u00A0Ko');
    expect(fmt.percent(0.425)).toBe('43\u202F%');
  });

  test('le nom affiché après enregistrement reste lisible', () => {
    const asked = 'Fusion_2026-09-18.jwlibrary';

    // Google Drive : identifiant de document opaque, rien à en tirer.
    expect(fmt.savedName('acc%3D1%3Bdoc%3DencodedZ0h4aWdRWE5r', asked)).toBe(asked);
    // Stockage de l'appareil : un chemin encodé, dont le nom se lit.
    expect(fmt.savedName('primary%3ADownload%2FFusion_2026-09-18.jwlibrary', asked)).toBe(asked);
    // Renommé par le système pour éviter une collision : on garde son nom.
    expect(fmt.savedName('primary%3ADownload%2FFusion_2026-09-18%20(1).jwlibrary', asked))
      .toBe('Fusion_2026-09-18 (1).jwlibrary');
    // Dossier ordinaire, nom déjà lisible.
    expect(fmt.savedName(asked, asked)).toBe(asked);
    // Segment au percent-encodage invalide : on ne lève pas, on se rabat.
    expect(fmt.savedName('100%', asked)).toBe(asked);
  });

  test('dates relatives', () => {
    const now = new Date(2026, 8, 6);
    expect(fmt.relativeDate(new Date(2026, 8, 6, 9, 41).toISOString(), now)).toBe("Aujourd'hui");
    expect(fmt.relativeDate(new Date(2026, 8, 5).toISOString(), now)).toBe('Hier');
    expect(fmt.relativeDate(new Date(2026, 5, 21).toISOString(), now)).toBe('21 juin');
    expect(fmt.relativeDate(new Date(2025, 11, 30).toISOString(), now)).toBe('30 déc. 2025');
  });
});

describe('avancement', () => {
  test('la barre ne recule jamais d’une étape à l’autre', () => {
    const timeline: [string, number, number][] = [
      ['lecture', 0, 2], ['lecture', 1, 2], ['lecture', 2, 2],
      ['lieux', 0, 10], ['lieux', 10, 10],
      ['surlignages', 0, 100], ['surlignages', 50, 100], ['surlignages', 100, 100],
      ['notes', 0, 20], ['notes', 20, 20],
      ['signets', 5, 5],
      ['vérification', 0, 1], ['vérification', 1, 1],
      ['archive', 0, 1], ['archive', 1, 1],
    ];
    let previous = -1;
    for (const [step, done, total] of timeline) {
      const ratio = overallRatio(step, done, total);
      expect(ratio).toBeGreaterThanOrEqual(previous);
      previous = ratio;
    }
    expect(previous).toBe(1);
  });

  test('une étape inconnue ne casse pas la barre', () => {
    expect(overallRatio('préparation', 0, 0)).toBe(0);
  });
});
