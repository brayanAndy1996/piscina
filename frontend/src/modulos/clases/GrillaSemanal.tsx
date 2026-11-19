import {
  BLOQUES,
  type Bloque,
  type Clase,
  DIAS_SEMANA,
  type DiaSemana,
  horaFinDe,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
} from '@aquagestion/contratos';
import { useState } from 'react';
import { Insignia } from '../../componentes/ui';
import { diaDeLaSemanaEnLima } from '../../lib/fechas';

const NOMBRE_CORTO_DIA: Readonly<Record<DiaSemana, string>> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom',
};

/** Nombre y primer apellido: cabe en una celda de la grilla. */
function nombreCorto(entrenador: { nombres: string; apellidos: string }): string {
  return `${entrenador.nombres.split(' ')[0] ?? ''} ${entrenador.apellidos.split(' ')[0] ?? ''}`.trim();
}

interface Propiedades {
  clases: readonly Clase[];
  alElegir: (clase: Clase) => void;
}

/**
 * La semana (HU-17, RN-09): los siete días por los bloques de 1 hora de 08:00 a 20:00, con cada clase en su bloque (nivel, entrenador y
 * aforo). En pantallas anchas se ven los siete días; en el celular, un día a la vez con un selector (RNF-01). Es la misma tabla: el
 * CSS solo oculta las columnas de los demás días.
 */
export function GrillaSemanal({ clases, alElegir }: Propiedades) {
  const [diaMovil, setDiaMovil] = useState<number>(() => diaDeLaSemanaEnLima());
  const columna = (dia: number) => (dia === diaMovil ? '' : 'hidden md:table-cell');

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Día de la semana" className="grid grid-cols-7 gap-1 md:hidden">
        {DIAS_SEMANA.map((dia) => (
          <button
            key={dia}
            type="button"
            onClick={() => setDiaMovil(dia)}
            aria-pressed={dia === diaMovil}
            aria-label={NOMBRE_DIA[dia]}
            className={`min-h-11 rounded-lg text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${
              dia === diaMovil ? 'bg-sky-700 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-300'
            }`}
          >
            {NOMBRE_CORTO_DIA[dia]}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-sky-100">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">Clases de la semana, por día y bloque de una hora</caption>
          <thead>
            <tr className="border-b border-sky-100 bg-sky-50 text-sm text-slate-800">
              <th scope="col" className="w-24 px-2 py-2 font-medium md:w-20">
                Hora
              </th>
              {DIAS_SEMANA.map((dia) => (
                <th key={dia} scope="col" className={`px-2 py-2 font-medium ${columna(dia)}`}>
                  {NOMBRE_DIA[dia]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BLOQUES.map((bloque) => (
              <tr key={bloque} className="border-b border-sky-100 align-top last:border-b-0">
                <th scope="row" className="px-2 py-2 text-xs font-medium text-slate-700 sm:text-sm">
                  {bloque} a {horaFinDe(bloque)}
                </th>
                {DIAS_SEMANA.map((dia) => (
                  <td key={dia} className={`min-w-0 space-y-1 p-1 ${columna(dia)}`}>
                    <CeldaDelBloque
                      clases={clases.filter((c) => c.diaSemana === dia && c.horaInicio === bloque)}
                      dia={dia}
                      bloque={bloque}
                      alElegir={alElegir}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CeldaDelBloque({
  clases,
  dia,
  bloque,
  alElegir,
}: {
  clases: readonly Clase[];
  dia: DiaSemana;
  bloque: Bloque;
  alElegir: (clase: Clase) => void;
}) {
  if (clases.length === 0) {
    return <span className="block px-1 py-2 text-sm text-slate-500 md:hidden">Sin clases</span>;
  }
  return (
    <>
      {clases.map((clase) => {
        const inactiva = !clase.activo;
        const entrenadorInactivo = !clase.entrenador.activo;
        const nombre = nombreCorto(clase.entrenador);
        const etiqueta = [
          `Editar la clase ${NOMBRE_NIVEL[clase.nivel]} del ${NOMBRE_DIA[dia].toLowerCase()} de ${bloque} a ${horaFinDe(bloque)}`,
          `entrenador ${nombre}`,
          `aforo ${clase.aforo}`,
          inactiva ? 'inactiva' : null,
          entrenadorInactivo ? 'entrenador inactivo' : null,
        ]
          .filter(Boolean)
          .join(', ');
        return (
          <button
            key={clase.id}
            type="button"
            onClick={() => alElegir(clase)}
            aria-label={etiqueta}
            className={`block min-h-11 w-full min-w-0 space-y-0.5 rounded-lg p-2 text-left text-xs ring-1 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-700 sm:text-sm ${
              inactiva ? 'bg-slate-50 text-slate-600 ring-slate-300' : 'bg-white text-slate-900 ring-sky-300'
            }`}
          >
            <span className="block font-semibold">{NOMBRE_NIVEL[clase.nivel]}</span>
            <span className="block break-words">{nombre}</span>
            <span className="block">Aforo {clase.aforo}</span>
            {inactiva || entrenadorInactivo ? (
              <span className="flex flex-wrap gap-1 pt-0.5">
                {inactiva ? <Insignia color="gris">Inactiva</Insignia> : null}
                {entrenadorInactivo ? <Insignia color="ambar">Entrenador inactivo</Insignia> : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}
