import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The deployed source, run directly. A CloudFront Function has no exports, so the file is read
 * and the function pulled out of it — the alternative is a copy of the code in the test, which
 * would pass while the deployed version was wrong.
 */
const handler = new Function(
  `${readFileSync(path.join(__dirname, 'spa-rewrite.js'), 'utf-8')}; return handler;`,
)() as (event: { request: { uri: string } }) => { uri: string };

const uriFor = (uri: string): string => handler({ request: { uri } }).uri;

describe('spa-rewrite', () => {
  it('serves the app shell for in-app routes', () => {
    // Wrong here and every deep link and refresh breaks.
    expect(uriFor('/')).toBe('/index.html');
    expect(uriFor('/scholarships')).toBe('/index.html');
    expect(uriFor('/scholarships/sjsu-general/2026')).toBe('/index.html');
  });

  it('leaves a path that names a file alone', () => {
    // Wrong here and a missing hashed asset comes back as HTML with a 200, which the browser
    // then tries to run as JavaScript.
    expect(uriFor('/assets/index-a1b2c3.js')).toBe('/assets/index-a1b2c3.js');
    expect(uriFor('/index.html')).toBe('/index.html');
    expect(uriFor('/favicon.ico')).toBe('/favicon.ico');
  });
});
