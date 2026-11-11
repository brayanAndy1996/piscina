// Datos inventados de las pruebas E2E. El superadmin se crea en la base de pruebas antes de correrlas (globalSetup);
// nunca coincide con el de desarrollo del .env.example.
export const SUPERADMIN_E2E = {
  correo: 'superadmin-e2e@aquagestion.test',
  nombre: 'Superadmin de pruebas E2E',
  clave: 'clave-e2e-solo-pruebas-123',
} as const;
