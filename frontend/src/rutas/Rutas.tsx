import { Navigate, Route, Routes } from 'react-router';
import { DetalleCaja } from '../modulos/caja/DetalleCaja';
import { PaginaCarnetAlumno } from '../modulos/alumnos/PaginaCarnetAlumno';
import { PaginaAlumnos } from '../modulos/alumnos/PaginaAlumnos';
import { PaginaAsistencia } from '../modulos/asistencia/PaginaAsistencia';
import { PaginaCaja } from '../modulos/caja/PaginaCaja';
import { PaginaHistorialCajas } from '../modulos/caja/PaginaHistorialCajas';
import { PaginaMiCarnet } from '../modulos/carnet/PaginaMiCarnet';
import { PaginaClases } from '../modulos/clases/PaginaClases';
import { PaginaConfiguracion } from '../modulos/configuracion/PaginaConfiguracion';
import { Inicio } from '../modulos/inicio/Inicio';
import { PaginaMensualidades } from '../modulos/mensualidades/PaginaMensualidades';
import { PaginaInscripcion } from '../modulos/inscripcion/PaginaInscripcion';
import { PaginaPanel } from '../modulos/panel/PaginaPanel';
import { PaginaPagos } from '../modulos/pagos/PaginaPagos';
import { PaginaTicket } from '../modulos/pagos/PaginaTicket';
import { PaginaPlanes } from '../modulos/planes/PaginaPlanes';
import { PaginaAcademias } from '../modulos/plataforma/PaginaAcademias';
import { PaginaIngresar } from '../modulos/plataforma/PaginaIngresar';
import { PaginaConsultaSolicitud } from '../modulos/seguimiento/PaginaConsultaSolicitud';
import { PaginaSeguimiento } from '../modulos/seguimiento/PaginaSeguimiento';
import { PaginaSolicitudes } from '../modulos/solicitudes/PaginaSolicitudes';
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
      <Route path="/a/:nombreCorto/inscripcion" element={<PaginaInscripcion />} />
      <Route path="/a/:nombreCorto/solicitud" element={<PaginaConsultaSolicitud />} />
      <Route path="/a/:nombreCorto/solicitud/:token" element={<PaginaSeguimiento />} />
      <Route element={<RutaConSesion />}>
        <Route path="/cambiar-clave" element={<PaginaCambiarClave />} />
        <Route path="/panel" element={<PaginaPanel />} />
        <Route path="/panel/usuarios" element={<PaginaUsuarios />} />
        <Route path="/panel/restablecer" element={<PaginaRestablecer />} />
        <Route path="/panel/configuracion" element={<PaginaConfiguracion />} />
        <Route path="/panel/planes" element={<PaginaPlanes />} />
        <Route path="/panel/clases" element={<PaginaClases />} />
        <Route path="/panel/solicitudes" element={<PaginaSolicitudes />} />
        <Route path="/panel/pagos" element={<PaginaPagos />} />
        <Route path="/panel/pagos/:id/ticket" element={<PaginaTicket />} />
        <Route path="/panel/caja" element={<PaginaCaja />} />
        <Route path="/panel/cajas" element={<PaginaHistorialCajas />} />
        <Route path="/panel/cajas/:id" element={<DetalleCaja />} />
        <Route path="/panel/alumnos" element={<PaginaAlumnos />} />
        <Route path="/panel/alumnos/:id" element={<PaginaCarnetAlumno />} />
        <Route path="/panel/mensualidades" element={<PaginaMensualidades />} />
        <Route path="/panel/asistencia" element={<PaginaAsistencia />} />
        <Route path="/panel/mi-carnet" element={<PaginaMiCarnet />} />
      </Route>
      <Route path="*" element={<PaginaNoEncontrada />} />
    </Routes>
  );
}
