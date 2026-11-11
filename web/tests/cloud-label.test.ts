/** Le nom du navigateur affiché sous un emplacement déposé depuis le site. */
import { expect, test } from 'bun:test';

import { browserLabel } from '../lib/cloud';

test('navigateur et système reconnus', () => {
  const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const edgeWin = `${chromeWin} Edg/141.0`;
  const safariIphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const firefoxMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0';
  const chromeAndroid = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';

  expect(browserLabel(chromeWin)).toBe('Chrome sur Windows');
  expect(browserLabel(edgeWin)).toBe('Edge sur Windows');
  expect(browserLabel(safariIphone)).toBe('Safari sur iPhone');
  expect(browserLabel(firefoxMac)).toBe('Firefox sur Mac');
  expect(browserLabel(chromeAndroid)).toBe('Chrome sur Android');
  expect(browserLabel('')).toBe('un navigateur');
});
