import { Navigate, Route, Routes } from 'react-router';
import { Inicio } from '../modulos/inicio/Inicio';
import { PaginaAcademias } from '../modulos/plataforma/PaginaAcademias';
import { PaginaIngresar } from '../modulos/plataforma/PaginaIngresar';
import { PaginaNoEncontrada } from './PaginaNoEncontrada';

export function Rutas() {
  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
      <Route path="/plataforma" element={<Navigate to="/plataforma/academias" replace />} />
      <Route path="/plataforma/ingresar" element={<PaginaIngresar />} />
      <Route path="/plataforma/academias" element={<PaginaAcademias />} />
      <Route path="*" element={<PaginaNoEncontrada />} />
    </Routes>
  );
}
