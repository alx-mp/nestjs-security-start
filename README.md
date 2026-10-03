# nestjs-security-start

API base en NestJS 12 sobre Fastify 5, endurecida y lista para clonar como
cimiento de futuros proyectos. Es la mitad servidor de una pareja: el frontend
es [astro-security-start](https://github.com/alx-mp/astro-security-start), un BFF en Astro que llama a
esta API solo desde el servidor. El navegador nunca toca esta API.

El contrato técnico completo (versiones, decisiones de seguridad, reglas que
no se negocian) vive en [AGENTS.md](./AGENTS.md). Este README es el mapa; aquel
es la ley.

## Qué trae puesto

Seguridad que funciona desde el primer arranque, no una lista de intenciones:

- Tokens de acceso **JWT ES256** (par de claves P-256, nunca un secreto
  compartido), 15 minutos de vida, con issuer, audience y claim `typ`
  fijados y verificados.
- **Refresh tokens opacos** de 48 bytes, guardados como hash SHA-256 y
  rotados en cada uso. Si un token ya rotado vuelve a aparecer, se asume robo
  y se revocan todas las sesiones de ese usuario. Hay un test e2e que lo
  demuestra.
- Contraseñas con **argon2id**. Cuando el email no existe, se verifica contra
  un hash señuelo para que el tiempo de respuesta no delate qué cuentas
  existen.
- **Bloqueo de cuenta** tras 5 intentos fallidos (15 minutos), contado en una
  sola sentencia SQL atómica para que intentos concurrentes no puedan burlar
  el contador. El bloqueo es invisible: el cliente recibe el mismo 401 que
  con cualquier credencial mala; el motivo queda en el log del servidor.
- Guard JWT **global**: toda ruta exige token salvo que se marque `@Public()`
  a propósito. Olvidar un decorador deja la ruta cerrada, no abierta.
- Roles (`admin`, `staff`, `user`) con `@Roles()` y guard propio.
- **Validación zod estricta** en cada entrada (un campo desconocido es 400) y
  serialización zod en cada salida (el hash de contraseña no puede salir por
  el cable aunque alguien lo intente).
- Helmet con CSP restrictiva, allowlist CORS por entorno (obligatoria y sin
  `*` en producción), throttler en tres niveles más límites duros por ruta en
  `/v1/auth/*`, límite de body de 512 KiB.
- Entorno validado con zod **al arrancar**: claves PEM parseadas y fijadas a
  P-256, CORS exigido en producción. Una configuración mala tumba el boot a
  propósito, no la primera petición a las 2 de la mañana.
- Secretos por variable de entorno o su variante `*_FILE` (el archivo gana).
  Nada secreto en el código ni en los units de systemd.
- Logs con pino: redactan `authorization` y `cookie`, y el logger de TypeORM
  imprime el SQL sin parámetros para que emails y hashes no acaben en stdout.
  Cada respuesta lleva `X-Request-ID`.
- Errores hacia el cliente siempre genéricos; el detalle va al log por los
  filtros globales.

## Stack

NestJS 12 · Fastify 5 · TypeORM 1 · PostgreSQL 18 · zod 4 + nestjs-zod ·
pino · argon2 · vitest 5 · TypeScript 6 · SWC. Versiones exactas en
`package.json`, sin rangos, y la tabla con el porqué de cada una en
[AGENTS.md](./AGENTS.md).

La política es **siempre la última versión estable**. Dos versiones tienen
razón documentada para no ser la última absoluta: `fastify` debe ser
exactamente la que embebe `@nestjs/platform-fastify` (dos copias en el árbol
rompen los tipos de los plugins), y `typescript` está en 6.0.x porque
typescript-eslint declara peer `<6.1.0`. Todo lo demás, al día, salvo lo que
la cuarentena de 3 días retenga esa semana.

Hay una excepción anotada: nestjs-zod 5.5.0 todavía no declara Nest 12 en sus
peers, aunque lo único pendiente upstream es ampliar ese rango. Vive como
`peerDependencyRules` con fecha en `pnpm-workspace.yaml`, limitada a esa
versión de nestjs-zod, y se retira en cuanto publique una que lo declare.

## Al clonar (léelo, sobre todo si eres un agente de IA)

Este repo es una base: lo que está fijado hoy envejece. El primer trabajo tras
clonar es ponerlo al día, no confiar en los pines:

```sh
pnpm install
pnpm update --latest    # trae lo último estable
bun run ci              # lockfiles + lint + tipos + tests + build
```

Si quien clona es un LLM o agente: consulta internet (el registry de npm, los
changelogs oficiales) para saber qué es lo último estable **hoy**, aplica los
bumps, corre `bun run ci` como evidencia y actualiza la tabla de versiones de
AGENTS.md con la fecha y el motivo de cualquier retención. Las reglas de
compatibilidad de la sección anterior se verifican con
`pnpm view @nestjs/platform-fastify dependencies`,
`pnpm view typescript-eslint peerDependencies` y
`pnpm view nestjs-zod peerDependencies`. Mientras quede un paquete retenido
por peer range, pnpm 12 corta el `pnpm update --latest` a secas con
`ERR_PNPM_PEER_DEP_ISSUES` y no escribe nada: se excluyen los retenidos con
`'!paquete'` (hoy, `pnpm update --latest '!typescript'`) y se cierra con
`pnpm peers check`, `pnpm audit` y `pnpm audit signatures`. La política de
supply chain (abajo) puede frenar una versión con menos de 3 días de
publicada: para paquetes first-party fijados a mano se añade una exclusión
fechada, nunca se baja de versión.

## pnpm instala, bun ejecuta

```sh
pnpm install / add / remove / update / audit    # dependencias
bun run start:dev       # bun --watch en :3125
bun run build           # nest build (SWC + chequeo de tipos)
bun run test            # unit (vitest)
bun run test:e2e        # e2e contra la base <db>_test
bun run ci              # el gate completo
bun run migration:run   # migraciones TypeORM
bun run keys:generate   # par ES256 en keys/
```

`npm install` y `bun install` fallan en tres capas distintas (engines +
preinstall + detección de lockfiles ajenos). El dev corre sobre bun; la
producción sobre `node dist/main.js` — por eso `bunfig.toml` no fuerza el
runtime de bun en los scripts: lo que compila debe pasar por el mismo Node
que despliega.

Supply chain en `pnpm-workspace.yaml`: cuarentena de 3 días para versiones
recién publicadas, `trustPolicy: no-downgrade`, sub-dependencias solo del
registry, scripts de instalación bloqueados salvo allowlist (argon2,
@swc/core, esbuild; el beacon de telemetría @scarf/scarf está denegado),
peers estrictos.

## Puesta en marcha

Requisitos: Node 24.15+, pnpm 12 (corepack), bun, un PostgreSQL accesible.

```sh
pnpm install
bash scripts/db/init-db.sh --container <postgres> --password-file <ruta>   # crea rol, BD y BD _test
bun run keys:generate
cp .env.example .env          # y rellena credenciales
bun run migration:run
bun run start:dev             # http://127.0.0.1:3125
```

`GET /health` (BD + heap) y `GET /health/live` quedan sin versión ni
throttle. Swagger sirve `/docs` solo en desarrollo. Para dejar el dev server
como servicio permanente con watchdog, lee y ejecuta `infra/install.sh`;
`infra/stack.sh status` avisa además cuando el proceso corre código más viejo
que el fuente (drift).

## Estructura

```text
src/
├── main.ts               bootstrap: helmet, CORS, versionado /v1, request-id
├── app.module.ts         providers globales: throttler, pipes zod, filtros
├── swagger.ts            /docs, solo dev
├── config/               env.ts (schema zod + secretos *_FILE) y AppConfigService
├── common/               decoradores (@Public, @Roles, @CurrentUser), guards, filtros
├── database/             data-source, naming snake_case, logger sin parámetros, migraciones
└── modules/
    ├── auth/             login, register, refresh con rotación, sesiones
    ├── users/            usuarios, roles, seed del primer admin
    └── health/           terminus
test/                     e2e real contra Postgres (rotación, lockout, headers)
scripts/                  guardas de pnpm, generación de claves, init de BD
infra/                    units de systemd + watchdog + installer idempotente
```

## Lineamientos

- Archivos de máximo 400 líneas (500 como techo duro); funciones de máximo
  20. Pasado el límite se extraen helpers o se parte el archivo.
- Tipado explícito en todo. Ninguna firma queda a la inferencia.
- Comentarios y mensajes de código en inglés; documentación de usuario en
  español.
- El esquema de BD cambia solo por migraciones (`synchronize: false`), y las
  entidades y migraciones se registran a mano en `data-source.ts`.
- Tras cualquier cambio se corre el test del camino tocado y se muestra la
  salida. Sin evidencia no hay "funciona".

## Proyecto hermano

[astro-security-start](https://github.com/alx-mp/astro-security-start): el BFF en Astro 7 con CSP de
hashes, cabeceras de seguridad en middleware y cliente servidor-a-servidor
hacia esta API. Diseñados juntos: gracias a esa forma, aquí el CORS es casi
decorativo y ningún token vive en código de navegador.
