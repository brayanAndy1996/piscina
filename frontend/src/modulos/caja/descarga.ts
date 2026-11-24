/** Cuánto espera la web antes de soltar la dirección de objeto: el navegador necesita un instante para empezar a leerla. */
const MILISEGUNDOS_ANTES_DE_REVOCAR = 500;

/**
 * Le entrega un archivo al navegador con el nombre indicado (criterio 44, PQ12): crea una dirección de objeto, la abre con un enlace de
 * descarga y la revoca poco después. Nada se guarda en el almacenamiento local.
 */
export function entregarArchivo(contenido: Blob, nombre: string): void {
  const direccion = URL.createObjectURL(contenido);
  try {
    const enlace = document.createElement('a');
    enlace.href = direccion;
    enlace.download = nombre;
    enlace.rel = 'noopener';
    enlace.style.display = 'none';
    document.body.append(enlace);
    try {
      enlace.click();
    } finally {
      enlace.remove();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(direccion), MILISEGUNDOS_ANTES_DE_REVOCAR);
  }
}

/** El nombre del archivo del PDF de un cierre, igual al que pone la API (`cierre-caja-AAAA-MM-DD-N.pdf`, PQ7). */
export function nombreDelPdfDelCierre(fecha: string, numero: number): string {
  return `cierre-caja-${fecha}-${numero}.pdf`;
}
