// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomBytes, randomUUID } from 'node:crypto';
import { ejecutarComo } from './base-datos';

export interface AcademiaDePrueba {
  id: string;
  nombre: string;
  nombreCorto: string;
}

/**
 * Crea una academia con una conexión del dueño y el contexto de plataforma (sirve con un dueño superusuario y con
 * uno que no lo es). Sin datos, usa un nombre corto único y válido (`prueba-1a2b3c4d`).
 */
export async function crearAcademiaDePrueba(
  datos: { nombre?: string; nombreCorto?: string; estado?: 'ACTIVA' | 'SUSPENDIDA' } = {},
): Promise<AcademiaDePrueba> {
  const sufijo = randomBytes(4).toString('hex');
  const id = randomUUID();
  const nombre = datos.nombre ?? `Academia de prueba ${sufijo}`;
  const nombreCorto = datos.nombreCorto ?? `prueba-${sufijo}`;
  const estado = datos.estado ?? 'ACTIVA';
  const suspendida = estado === 'SUSPENDIDA';
  const ahora = new Date();
  await ejecutarComo(
    'propietario',
    `INSERT INTO academias (id, nombre, nombre_corto, estado, motivo_suspension, suspendida_en, creada_en, actualizada_en)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $7)`,
    [
      id,
      nombre,
      nombreCorto,
      estado,
      suspendida ? 'Suspendida para la prueba' : null,
      suspendida ? ahora : null,
      ahora,
    ],
    { plataforma: true },
  );
  return { id, nombre, nombreCorto };
}
