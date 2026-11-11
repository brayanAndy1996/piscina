import { describe, expect, it } from 'vitest';

describe('zona horaria de las pruebas', () => {
  it('es UTC, sin importar la del sistema operativo', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });
});
