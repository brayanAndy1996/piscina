import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { llamadas, type Manejador, mostrar, sesionDe, simularApi } from '../../pruebas-api';

// Spec 007b, criterio 53: los datos de pago de la academia (Yape y transferencia) en la pantalla de configuración. La API se simula.

const POR_DEFECTO = {
  toleranciaTardanzaMinutos: 10,
  diasPorVencer: 5,
  diasPrioridadRenovacion: 5,
  intentosInicioSesion: 5,
  minutosBloqueo: 15,
  telefono: null,
};
const MI_ACADEMIA = {
  academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null },
};
const GUARDAR = { name: 'Guardar cambios' };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function comoAdmin(extra: Record<string, Manejador> = {}, configuracion: Record<string, unknown> = POR_DEFECTO) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    'GET /api/configuracion': () => ({ estado: 200, cuerpo: { configuracion } }),
    ...extra,
  });
}

describe('datos de pago de la academia (criterio 53)', () => {
  it('muestra el grupo con los seis datos, vacíos si la API no trae ninguno', async () => {
    comoAdmin();
    mostrar('/panel/configuracion');
    expect(await screen.findByRole('heading', { level: 2, name: 'Datos de pago' })).toBeInTheDocument();
    for (const etiqueta of [
      'Número de Yape',
      'Titular del Yape',
      'Banco de la transferencia',
      'Número de cuenta',
      'CCI',
      'Titular de la cuenta',
    ]) {
      expect(screen.getByLabelText(etiqueta)).toHaveValue('');
    }
    expect(screen.getByRole('button', GUARDAR)).toBeDisabled();
  });

  it('se llena con lo que trae la API y guarda solo lo que cambió', async () => {
    const api = comoAdmin(
      {
        'PATCH /api/configuracion': (cuerpo) => ({
          estado: 200,
          cuerpo: {
            configuracion: {
              ...POR_DEFECTO,
              yapeNumero: '987654321',
              yapeTitular: 'Los Delfines SAC',
              ...(cuerpo as object),
            },
          },
        }),
      },
      { ...POR_DEFECTO, yapeNumero: '987654321', yapeTitular: 'Los Delfines SAC' },
    );
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    expect(await screen.findByLabelText('Número de Yape')).toHaveValue('987654321');
    expect(screen.getByLabelText('Titular del Yape')).toHaveValue('Los Delfines SAC');
    await usuario.type(screen.getByLabelText('Banco de la transferencia'), '  Banco Pichincha ');
    await usuario.type(screen.getByLabelText('CCI'), '00219100123456701234');
    await usuario.click(screen.getByRole('button', GUARDAR));
    expect(await screen.findByText('Configuración guardada.')).toBeInTheDocument();
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([
      { transferenciaBanco: 'Banco Pichincha', transferenciaCci: '00219100123456701234' },
    ]);
    expect(screen.getByRole('button', GUARDAR)).toBeDisabled();
  });

  it('«Quitar este dato» y vaciar el campo envían null', async () => {
    const api = comoAdmin(
      {
        'PATCH /api/configuracion': () => ({ estado: 200, cuerpo: { configuracion: POR_DEFECTO } }),
      },
      { ...POR_DEFECTO, yapeNumero: '987654321', yapeTitular: 'Los Delfines SAC' },
    );
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    await screen.findByLabelText('Número de Yape');
    await usuario.click(screen.getByRole('button', { name: /Quitar este dato de Número de Yape/ }));
    await usuario.clear(screen.getByLabelText('Titular del Yape'));
    await usuario.click(screen.getByRole('button', GUARDAR));
    await waitFor(() => expect(llamadas(api, 'PATCH /api/configuracion')).toHaveLength(1));
    expect(llamadas(api, 'PATCH /api/configuracion')[0]).toEqual({ yapeNumero: null, yapeTitular: null });
  });

  it('valida el celular con el esquema compartido antes de enviar', async () => {
    const api = comoAdmin();
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    const yape = await screen.findByLabelText('Número de Yape');
    await usuario.type(yape, '12345');
    await usuario.click(screen.getByRole('button', GUARDAR));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(yape).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(api, 'PATCH /api/configuracion')).toHaveLength(0);
  });
});
