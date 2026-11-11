import { Route, Routes } from 'react-router';
import { Inicio } from '../modulos/inicio/Inicio';
import { PaginaNoEncontrada } from './PaginaNoEncontrada';

export function Rutas() {
  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
      <Route path="*" element={<PaginaNoEncontrada />} />
    </Routes>
  );
}
