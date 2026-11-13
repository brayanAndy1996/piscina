import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { esTipoJson, traeCuerpo } from './cuerpos';

describe('esTipoJson (criterio 74)', () => {
  it.each([
    'application/json',
    'APPLICATION/JSON',
    'application/json; charset=utf-8',
    'application/json;charset=UTF-8',
    'application/json ; charset=utf-8',
    'application/json; CHARSET=utf-8',
  ])('acepta %s', (tipo) => {
    expect(esTipoJson(tipo)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'application/json; charset=latin1',
    'application/json; charset=utf8',
    'application/json; charset=utf-16',
    'application/json; boundary=x',
    'application/vnd.api+json',
    'application/json-patch+json',
    'application/jsonx',
  ])('rechaza %s', (tipo) => {
    expect(esTipoJson(tipo)).toBe(false);
  });
});

describe('traeCuerpo (criterio 74)', () => {
  const peticion = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

  it('es verdadero con Content-Length mayor que 0 o con Transfer-Encoding', () => {
    expect(traeCuerpo(peticion({ 'content-length': '12' }))).toBe(true);
    expect(traeCuerpo(peticion({ 'transfer-encoding': 'chunked' }))).toBe(true);
  });

  it('es falso sin cuerpo declarado', () => {
    expect(traeCuerpo(peticion({}))).toBe(false);
    expect(traeCuerpo(peticion({ 'content-length': '0' }))).toBe(false);
    expect(traeCuerpo(peticion({ 'content-length': 'abc' }))).toBe(false);
  });
});
