// Pruebas de las funciones puras que el hook de sesión usa para comprobar el rol de la API (spec 001, criterio 81).
import { describe, expect, it } from 'vitest';
import { filaDeAtributosRol, sentenciaAtributosRol } from '../../.claude/hooks/preparar-sesion.mjs';
import { problemasDelRolApp } from '../lib/rol-app.mjs';

describe('filaDeAtributosRol (criterio 81)', () => {
  it('convierte la línea de psql -tA en la fila que evalúa problemasDelRolApp', () => {
    const fila = filaDeAtributosRol('aquagestion_app', 'f|f|t|f|f|t|pg_read_all_data,pg_monitor\n');

    expect(fila).toEqual({
      rolname: 'aquagestion_app',
      rolsuper: false,
      rolbypassrls: false,
      rolreplication: true,
      rolcreaterole: false,
      rolcreatedb: false,
      es_miembro: true,
      roles: ['pg_read_all_data', 'pg_monitor'],
    });
    const problemas = problemasDelRolApp(fila).join('\n');
    expect(problemas).toContain('ALTER ROLE aquagestion_app NOREPLICATION;');
    expect(problemas).toContain('REVOKE pg_read_all_data FROM aquagestion_app;');
  });

  it('un rol seguro no produce problemas', () => {
    expect(problemasDelRolApp(filaDeAtributosRol('aquagestion_app', 'f|f|f|f|f|f|'))).toEqual([]);
  });

  it('devuelve null si no hay línea con la forma esperada (el rol no existe o la salida es otra)', () => {
    expect(filaDeAtributosRol('aquagestion_app', '')).toBeNull();
    expect(filaDeAtributosRol('aquagestion_app', 'ERROR: algo\n')).toBeNull();
  });
});

describe('sentenciaAtributosRol (criterio 81)', () => {
  it('consulta los cinco atributos y las membresías del rol', async () => {
    const { cargarUtilidadesEntorno } = await import('../../.claude/hooks/preparar-sesion.mjs');
    await cargarUtilidadesEntorno();

    const sql = sentenciaAtributosRol('aquagestion_app');

    for (const columna of [
      'rolsuper',
      'rolbypassrls',
      'rolreplication',
      'rolcreaterole',
      'rolcreatedb',
      'pg_auth_members',
    ]) {
      expect(sql).toContain(columna);
    }
    expect(sql).toContain("rolname = 'aquagestion_app'");
  });

  it('rechaza un nombre de rol inválido', async () => {
    const { cargarUtilidadesEntorno } = await import('../../.claude/hooks/preparar-sesion.mjs');
    await cargarUtilidadesEntorno();

    expect(() => sentenciaAtributosRol("x'; DROP ROLE y; --")).toThrow();
  });
});
