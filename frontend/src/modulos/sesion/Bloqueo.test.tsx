import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../api/cliente';
import { mostrar, sesionDe, simularApi } from '../../pruebas-api';
import { mensajeDeBloqueo, mensajeDeIngresoAcademia } from './mensajes';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const MENSAJE_API = 'La cuenta está bloqueada por varios intentos fallidos. Intenta de nuevo en 27 minutos.';
const AYUDA = 'Si no puedes esperar, pide en recepción que restablezcan tu contraseña.';
const BLOQUEADA = { estado: 423, cuerpo: { codigo: 'CUENTA_BLOQUEADA', mensaje: MENSAJE_API } };

describe('mensaje del 423 de la academia (criterio 19)', () => {
  it('muestra el mensaje de la API con los minutos que faltan y cómo pedir ayuda', () => {
    const error = new ErrorDeApi(423, { codigo: 'CUENTA_BLOQUEADA', mensaje: MENSAJE_API });
    expect(mensajeDeBloqueo(error)).toBe(`${MENSAJE_API} ${AYUDA}`);
    expect(mensajeDeIngresoAcademia(error)).toBe(`${MENSAJE_API} ${AYUDA}`);
  });

  it('no repite ningún número fijo de minutos: sale del mensaje de la API', () => {
    const error = new ErrorDeApi(423, {
      codigo: 'CUENTA_BLOQUEADA',
      mensaje: 'La cuenta está bloqueada. Intenta de nuevo en 1 minuto.',
    });
    const mensaje = mensajeDeBloqueo(error);
    expect(mensaje).toContain('1 minuto');
    expect(mensaje).not.toContain('15 minutos');
  });

  it('agrega el punto final si la API no lo trae', () => {
    const error = new ErrorDeApi(423, { codigo: 'CUENTA_BLOQUEADA', mensaje: 'Cuenta bloqueada por 5 minutos' });
    expect(mensajeDeBloqueo(error)).toBe(`Cuenta bloqueada por 5 minutos. ${AYUDA}`);
  });

  it('el ingreso lo muestra y no dice "15 minutos" fijo', async () => {
    simularApi({
      'GET /api/a/delfines': () => ({ estado: 200, cuerpo: { nombreCorto: 'delfines', nombre: 'Los Delfines' } }),
      'POST /api/a/delfines/sesion': () => BLOQUEADA,
    });
    mostrar('/a/delfines/ingresar');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('DNI'), '10000004');
    await usuario.type(screen.getByLabelText('Contraseña'), 'una-clave-larga-1');
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Intenta de nuevo en 27 minutos.');
    expect(alerta).toHaveTextContent(AYUDA);
    expect(alerta).not.toHaveTextContent('15 minutos');
  });

  it('el cambio de contraseña lo muestra igual', async () => {
    simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('SECRETARIA', { debeCambiarClave: true }) }),
      'POST /api/sesion/clave': () => BLOQUEADA,
    });
    mostrar('/cambiar-clave');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Contraseña actual'), 'equivocada');
    await usuario.type(screen.getByLabelText('Contraseña nueva'), 'Una clave nueva 1');
    await usuario.type(screen.getByLabelText('Confirma la contraseña nueva'), 'Una clave nueva 1');
    await usuario.click(screen.getByRole('button', { name: 'Guardar contraseña nueva' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Intenta de nuevo en 27 minutos.');
    expect(alerta).toHaveTextContent(AYUDA);
  });
});
