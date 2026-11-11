<!--
Plantilla de pull request de AquaGestión (spec 000, criterio 51). Rellena cada sección y borra los comentarios.
Una historia por pull request. Las pruebas protegidas (`// spec: NNN-nombre (pruebas protegidas)`) solo cambian en sus
commits "Pruebas protegidas (NNN): …".
-->

## Historia

- **Historia:** NNN · nombre de la historia (por ejemplo, `000 · Esqueleto`)
- **Especificación:** [`specs/NNN-nombre/spec.md`](specs/NNN-nombre/spec.md)

## Qué cambia

<!-- Dos o tres frases: qué hace el sistema distinto después de este PR y por qué. Si hay una decisión nueva, cita su D-XX. -->

## Criterios cubiertos

<!-- Lista los criterios de spec.md que cubre este PR, con su número y la prueba que los verifica. -->

- [ ] Criterio NN: …, prueba: `ruta/de/la/prueba`

## Ruta crítica

<!-- Si la historia no tiene criterios de ruta crítica, marca solo la primera casilla y borra el resto de la sección. -->

- [ ] No aplica: la historia no tiene criterios de ruta crítica.
- [ ] Sí aplica (los criterios de ruta crítica están marcados en spec.md):
  - [ ] Commit de pruebas protegidas en rojo: `<hash>`, "Pruebas protegidas (NNN): … (en rojo)".
  - [ ] Pruebas protegidas en verde tras la implementación, sin modificarlas.
  - [ ] Ataque adversarial sin fallas abiertas: N rondas. Cada ronda con su commit "Pruebas protegidas (NNN), ataque ronda N: … (en rojo)".

## Cómo probarlo en Windows

<!-- Pasos en PowerShell, siguiendo docs/guia-local-windows.md. Indica qué debe verse en la web o en la consola. -->

1. Pasos para traer el PR y levantarlo (`git pull`, `npm ci`, `docker compose up -d`, `npm run db:migrar`, `npm run dev`).
2. Resultado esperado: <!-- qué debe verse en http://localhost:5173 o en la consola. -->

## Verificación

- [ ] `npm run format:check`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test` (con Docker encendido y `npm run db:preparar` hecho)
- [ ] `npm run e2e` (si el PR cambia la web o un flujo completo)
- [ ] `npm run build`
- [ ] CI en verde: Linux, Windows y Pruebas protegidas

## Lista de verificación

- [ ] Ningún commit fuera de los de pruebas protegidas cambia una prueba protegida (lo confirman `npm run verificar:pruebas-protegidas` y el `git diff` del orquestador).
- [ ] No hay secretos ni archivos `.env` en el PR (`npm run verificar:sin-secretos`).
- [ ] Las migraciones de los cambios en el esquema de Prisma están incluidas en `backend/prisma/migrations/`.
- [ ] `docs/guia-local-windows.md` está actualizada si cambió cómo levantar el sistema.
- [ ] Si se tocó la configuración de pruebas (`vitest.config.mts`), los hooks de git (`.husky/`), el hook de sesión (`.claude/hooks/`), la CI (`.github/workflows/`) o los scripts de verificación (`scripts/verificar-*`), la sección "Qué cambia" lo justifica.
- [ ] La documentación que cambió está al día (README, decisiones, `tasks.md` y `backlog.md` cuando corresponda).
