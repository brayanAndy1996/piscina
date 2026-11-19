import type { UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

/**
 * Piezas de los formularios que editan algo que otra persona también puede cambiar (lo que la spec 003 tuvo que corregir tras sus
 * ataques y las 004 reutiliza): planes y clases.
 */

/**
 * Si la página puede mostrar la lista o el formulario: solo con la respuesta pedida al entrar, nunca con la caché sola (criterio 27 a de
 * 003). Una vez a la vista, sigue a la vista aunque un `GET` en segundo plano falle: no se pierden las ediciones (criterio 30 de 003).
 * La consulta debe pedirse siempre al entrar (`refetchOnMount: 'always'`).
 */
export function useRecienPedida<T>(consulta: UseQueryResult<T>): boolean {
  const recienPedida = consulta.isFetchedAfterMount && !consulta.isError && consulta.data !== undefined;
  const [yaMostrado, setYaMostrado] = useState(false);
  if (recienPedida && !yaMostrado) setYaMostrado(true);
  return recienPedida || (yaMostrado && consulta.data !== undefined);
}

interface OpcionesBase<Campos extends FieldValues, Base> {
  /** Lo último que llegó del servidor para lo que se edita. */
  base: Base;
  form: Pick<UseFormReturn<Campos>, 'getValues' | 'reset' | 'setValue'>;
  /** Los campos del formulario con los valores de una base. Función estable (de módulo). */
  aCampos: (base: Base) => Campos;
  /** Los nombres de los campos que la persona editó frente a esa base. Función estable (de módulo). */
  camposEditados: (campos: Campos, base: Base) => string[];
  /** Si dos bases valen lo mismo. Función estable (de módulo). */
  sonIguales: (a: Base, b: Base) => boolean;
}

/**
 * La base de llenado (criterio 27 de 003): el formulario se llena con lo que llega, pero compara siempre contra su propia base, la
 * última con la que se llenaron los campos. Así nunca envía como cambio un valor viejo que la persona no tocó.
 *
 * - Llega una base distinta sin ediciones: se recarga el formulario.
 * - Llega una base distinta con ediciones: se actualizan solo los campos que no se tocaron y se avisa (`avisoBaseNueva`).
 * - Tras guardar, la respuesta del servidor es la nueva base (`fijarBase`).
 */
export function useBaseDeLlenado<Campos extends FieldValues, Base>({
  base,
  form,
  aCampos,
  camposEditados,
  sonIguales,
}: OpcionesBase<Campos, Base>) {
  const [baseDeLlenado, setBaseDeLlenado] = useState(base);
  // La misma base en una referencia: el efecto que recibe una base nueva la lee sin depender de ella.
  const baseRef = useRef(base);
  const [avisoBaseNueva, setAvisoBaseNueva] = useState(false);
  const { getValues, reset, setValue } = form;

  const fijarBase = useCallback((nueva: Base) => {
    baseRef.current = nueva;
    setBaseDeLlenado(nueva);
    setAvisoBaseNueva(false);
  }, []);

  useEffect(() => {
    const anterior = baseRef.current;
    if (sonIguales(base, anterior)) return;
    const editados = camposEditados(getValues(), anterior);
    baseRef.current = base;
    setBaseDeLlenado(base);
    const nuevos = aCampos(base);
    if (editados.length === 0) {
      reset(nuevos);
      setAvisoBaseNueva(false);
      return;
    }
    for (const nombre of Object.keys(nuevos)) {
      if (!editados.includes(nombre)) setValue(nombre as Path<Campos>, nuevos[nombre] as never);
    }
    setAvisoBaseNueva(true);
  }, [base, aCampos, camposEditados, sonIguales, getValues, reset, setValue]);

  return { baseDeLlenado, fijarBase, avisoBaseNueva, quitarAvisoBaseNueva: () => setAvisoBaseNueva(false) };
}

/** El campo de un error de la API (`diasPermitidos.0` es `diasPermitidos`). */
export function campoRaiz(campo: string): string {
  return campo.split('.')[0] ?? campo;
}
