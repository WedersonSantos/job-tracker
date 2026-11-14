import { searchBrowserOptions } from './browser-search.service';

describe('hosted search browser', () => {
  it('preserves desktop Chrome by default and parses false without coercion', () => {
    expect(searchBrowserOptions({})).toMatchObject({
      channel: 'chrome',
      headless: false,
    });
    expect(
      searchBrowserOptions({ DISCOVERY_BROWSER_HEADLESS: 'false' }).headless,
    ).toBe(false);
  });
  it('uses the configured Chromium without a desktop session on the server', () => {
    const options = searchBrowserOptions({
      DISCOVERY_BROWSER_HEADLESS: 'true',
      DISCOVERY_BROWSER_EXECUTABLE: '/usr/bin/chromium',
    });
    expect(options).toMatchObject({
      executablePath: '/usr/bin/chromium',
      headless: true,
    });
    expect(options).not.toHaveProperty('channel');
  });
});
