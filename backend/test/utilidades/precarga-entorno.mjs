// spec: 001-academias-aislamiento (pruebas protegidas)
// Modulo que `entorno-proceso.test.ts` precarga (`node --import`) en el proceso hijo que ejecuta el punto de entrada real de la
// API (criterio 99). Al recibir el mensaje `'variables'` por IPC responde con los NOMBRES de las variables de `process.env` en
// ese momento (nunca los valores).
process.on('message', (mensaje) => {
  if (mensaje === 'variables' && typeof process.send === 'function') {
    process.send({ variables: Object.keys(process.env) });
  }
});
