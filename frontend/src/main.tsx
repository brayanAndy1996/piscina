import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Rutas } from './rutas/Rutas';
import './estilos.css';

const clienteConsultas = new QueryClient();

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('No se encontró el elemento #raiz en index.html.');

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={clienteConsultas}>
      <BrowserRouter>
        <Rutas />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
