import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { FiltroErrores } from './comun/filtros/filtro-errores';
import { AlmacenArchivosModule } from './infraestructura/almacen-archivos';
import { type Entorno, EntornoModule } from './infraestructura/entorno';
import { CorreoModule } from './infraestructura/correo';
import { PrismaModule } from './infraestructura/prisma';
import { crearOpcionesRegistro } from './infraestructura/registro';
import { RelojModule } from './infraestructura/reloj';
import { AcademiasModule } from './modulos/academias';
import { AlumnosModule } from './modulos/alumnos';
import { AsistenciaModule, TareasAsistenciaModule } from './modulos/asistencia';
import { AuditoriaModule } from './modulos/auditoria';
import { AutenticacionModule } from './modulos/autenticacion';
import { CajaModule } from './modulos/caja';
import { ClasesModule } from './modulos/clases';
import { ConfiguracionModule } from './modulos/configuracion';
import { InscripcionesModule } from './modulos/inscripciones';
import { MensualidadesModule, TareasMensualidadesModule } from './modulos/mensualidades';
import { PagosModule } from './modulos/pagos';
import { PlanesModule } from './modulos/planes';
import { SaludModule } from './modulos/salud/salud.module';
import { UsuariosModule } from './modulos/usuarios';

export interface OpcionesApp {
  /** Nivel de los registros (por defecto `silent` en pruebas e `info` en el resto). */
  readonly nivelRegistro?: string;
  /** Destino de los registros (por defecto, la salida estándar). Lo usan las pruebas. */
  readonly destinoRegistro?: DestinationStream;
}

@Module({})
export class AppModule {
  /** Arma la aplicación con el entorno ya validado. */
  static registrar(entorno: Entorno, opciones: OpcionesApp = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EntornoModule.paraRaiz(entorno),
        LoggerModule.forRoot(
          crearOpcionesRegistro({
            nodeEnv: entorno.NODE_ENV,
            nivel: opciones.nivelRegistro,
            destino: opciones.destinoRegistro,
          }),
        ),
        RelojModule,
        CorreoModule,
        AlmacenArchivosModule,
        PrismaModule,
        AuditoriaModule,
        AcademiasModule,
        AutenticacionModule,
        UsuariosModule,
        ConfiguracionModule,
        PlanesModule,
        ClasesModule,
        InscripcionesModule,
        CajaModule,
        PagosModule,
        AlumnosModule,
        AsistenciaModule,
        MensualidadesModule,
        SaludModule,
        // Las tareas programadas (las faltas de la 009b y el cierre de mes de la 010b) solo se cargan con `TAREAS_PROGRAMADAS=activas`; las pruebas las apagan (criterio 33).
        ...(entorno.TAREAS_PROGRAMADAS === 'activas'
          ? [ScheduleModule.forRoot(), TareasAsistenciaModule, TareasMensualidadesModule]
          : []),
      ],
      // El filtro también es un proveedor normal: el middleware de `/api/plataforma` lo reutiliza para sus respuestas.
      providers: [FiltroErrores, { provide: APP_FILTER, useExisting: FiltroErrores }],
    };
  }
}
