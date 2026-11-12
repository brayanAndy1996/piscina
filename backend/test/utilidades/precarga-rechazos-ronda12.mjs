// spec: 001-academias-aislamiento (pruebas protegidas)
// Modulo que `rechazos-proceso.test.ts` precarga (`node --import`) en el proceso hijo que ejecuta el punto de entrada real de la API
// (criterio 157). Responde por IPC a tres mensajes:
//   'estado'          -> cuantos manejadores de `uncaughtException` y de `unhandledRejection` se agregaron desde la precarga y el
//                        `process.exitCode` actual;
//   'rechazar-error'  -> deja una promesa rechazada con un `Error` sin que nadie la maneje;
//   'rechazar-cadena' -> lo mismo con la cadena 'dato-secreto-r12';
//   'rechazar-objeto' -> lo mismo con el objeto { dni: '12345678' }.
// Despues de provocar el rechazo espera un momento (para que el evento `unhandledRejection` ya se haya emitido) y responde
// `{ rechazado: true }`. Si el proceso termina por el rechazo, nunca responde y la prueba ve la salida del proceso.
const lineaBase = {
  uncaughtException: process.listenerCount('uncaughtException'),
  unhandledRejection: process.listenerCount('unhandledRejection'),
};

function responderLuego(mensaje) {
  setTimeout(() => {
    if (typeof process.send === 'function') process.send(mensaje);
  }, 400);
}

process.on('message', (mensaje) => {
  if (typeof process.send !== 'function') return;
  if (mensaje === 'estado') {
    process.send({
      estado: {
        uncaughtException: process.listenerCount('uncaughtException') - lineaBase.uncaughtException,
        unhandledRejection: process.listenerCount('unhandledRejection') - lineaBase.unhandledRejection,
        exitCode: process.exitCode ?? null,
      },
    });
    return;
  }
  if (mensaje === 'rechazar-error') {
    void Promise.reject(new Error('rechazo-sin-manejar-r12'));
    responderLuego({ rechazado: true });
  } else if (mensaje === 'rechazar-cadena') {
    void Promise.reject('dato-secreto-r12');
    responderLuego({ rechazado: true });
  } else if (mensaje === 'rechazar-objeto') {
    void Promise.reject({ dni: '12345678' });
    responderLuego({ rechazado: true });
  }
});
