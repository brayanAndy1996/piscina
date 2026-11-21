/** El número para `tel:`: solo `+` y dígitos. */
export function enlaceTelefono(telefono: string): string {
  return `tel:${telefono.replace(/[^+\d]/g, '')}`;
}

/** "Teléfono: 987 654 321" con un enlace para llamar desde el celular. No muestra nada si la academia no tiene teléfono (DR-4 de 003). */
export function TelefonoAcademia({ telefono }: { telefono: string | null | undefined }) {
  if (!telefono) return null;
  return (
    <p className="break-words text-sm text-slate-700">
      Teléfono:{' '}
      <a href={enlaceTelefono(telefono)} className="text-sky-800 underline">
        {telefono}
      </a>
    </p>
  );
}

/** " Llama a la academia al 987654321." o nada, para cerrar un mensaje de error con una salida humana. */
export function frasePorTelefono(telefono: string | null | undefined): string {
  return telefono
    ? ` Si necesitas ayuda, llama a la academia al ${telefono}.`
    : ' Si necesitas ayuda, acércate a recepción.';
}
