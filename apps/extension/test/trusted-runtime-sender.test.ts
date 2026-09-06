import { describe, expect, it } from 'vitest';

import { isTrustedExtensionPageSender } from '../lib/trusted-runtime-sender';

const EXTENSION_ID = 'ioohkeenbbokbpcmcbghiogedgcclogj';
const OPTIONS_URL = `chrome-extension://${EXTENSION_ID}/options.html`;

describe('trusted extension runtime sender', () => {
  it.each([`${OPTIONS_URL}#/products`, `${OPTIONS_URL}?source=notification#/products`])(
    'accepts the extension options page regardless of route: %s',
    (url) => {
      expect(isTrustedExtensionPageSender({ id: EXTENSION_ID, url }, EXTENSION_ID, OPTIONS_URL)).toBe(true);
    }
  );

  it.each([
    { id: EXTENSION_ID, url: 'https://i.alibaba.com/products/list-manage' },
    { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/popup.html` },
    { id: 'another-extension', url: OPTIONS_URL },
    { id: EXTENSION_ID, url: 'not a URL' },
    { id: EXTENSION_ID }
  ])('rejects an untrusted sender: %#', (sender) => {
    expect(isTrustedExtensionPageSender(sender, EXTENSION_ID, OPTIONS_URL)).toBe(false);
  });
});
