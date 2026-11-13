import { Navigate, Route, Routes } from 'react-router';
import { Inicio } from '../modulos/inicio/Inicio';
import { PaginaPanel } from '../modulos/panel/PaginaPanel';
import { PaginaAcademias } from '../modulos/plataforma/PaginaAcademias';
import { PaginaIngresar } from '../modulos/plataforma/PaginaIngresar';
import { PaginaCambiarClave } from '../modulos/sesion/PaginaCambiarClave';
import { PaginaIngresarAcademia } from '../modulos/sesion/PaginaIngresarAcademia';
import { RutaConSesion } from '../modulos/sesion/RutaConSesion';
import { PaginaRestablecer } from '../modulos/usuarios/PaginaRestablecer';
import { PaginaUsuarios } from '../modulos/usuarios/PaginaUsuarios';
import { PaginaNoEncontrada } from './PaginaNoEncontrada';

export function Rutas() {
  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
      <Route path="/plataforma" element={<Navigate to="/plataforma/academias" replace />} />
      <Route path="/plataforma/ingresar" element={<PaginaIngresar />} />
      <Route path="/plataforma/academias" element={<PaginaAcademias />} />
      <Route path="/a/:nombreCorto/ingresar" element={<PaginaIngresarAcademia />} />
      <Route element={<RutaConSesion />}>
        <Route path="/cambiar-clave" element={<PaginaCambiarClave />} />
        <Route path="/panel" element={<PaginaPanel />} />
        <Route path="/panel/usuarios" element={<PaginaUsuarios />} />
        <Route path="/panel/restablecer" element={<PaginaRestablecer />} />
      </Route>
      <Route path="*" element={<PaginaNoEncontrada />} />
    </Routes>
  );
}
