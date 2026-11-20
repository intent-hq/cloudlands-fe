import { describe, expect, it } from 'vitest';

import { saveDefaults } from './in-app-file-dialog-host';

describe('saveDefaults', () => {
  it('keeps a bare default name in the starting folder', () => {
    expect(saveDefaults('report.zip')).toEqual({ fileName: 'report.zip' });
    expect(saveDefaults(undefined)).toEqual({ fileName: '' });
  });

  it('splits a full default path into folder and name', () => {
    expect(saveDefaults('/home/me/Downloads/report.zip')).toEqual({
      directory: '/home/me/Downloads',
      fileName: 'report.zip',
    });
    expect(saveDefaults('/report.zip')).toEqual({ directory: '/', fileName: 'report.zip' });
  });
});
