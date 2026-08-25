// EL BUILD DEL SDK — el paso que lo hace publicable.
//
// `tsc` solo no basta para un paquete que se publica: deja los `import` a
// `@bmail/core/types` tal cual, en el JS y en los `.d.ts`. Quien instalara
// esto desde npm se traería @bmail/core entero —y con él better-sqlite3, que
// es código NATIVO, imapflow, mailparser y nodemailer— para usar un cliente
// HTTP de 700 líneas. En un navegador o en un Electron eso no es una
// dependencia pesada: es una que no compila.
//
// Así que el SDK se empaqueta: el JS con esbuild y los tipos con
// rollup-plugin-dts, los dos INLINEANDO lo que toma del contrato. Resultado:
// un paquete con CERO dependencias de runtime, que es lo que un SDK de
// cliente tiene que ser. `@bmail/core` queda como devDependency — sigue
// siendo la fuente de los tipos, pero se copia al construir en vez de
// arrastrarse al instalar.
import { build } from 'esbuild'
import { rollup } from 'rollup'
import dts from 'rollup-plugin-dts'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const ENTRADA = 'src/index.ts'
const SALIDA = 'dist'

await rm(SALIDA, { recursive: true, force: true })

// ── El JavaScript ─────────────────────────────────────
// ESM, sin minificar y con sourcemap: esto se lee cuando algo falla en el
// navegador de otra persona, y un bundle minificado ahí no ayuda a nadie.
await build({
  entryPoints: [ENTRADA],
  outfile: `${SALIDA}/index.js`,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  sourcemap: true,
  // Nada externo: si algún día el SDK toma una dependencia de verdad, esta
  // línea la convierte en un error en vez de en una sorpresa del consumidor.
  external: [],
})

// ── Los tipos ─────────────────────────────────────────
// Dos piezas, y las dos hacen falta. `respectExternal` le dice a
// rollup-plugin-dts que INLINEE lo que venga de fuera en vez de dejar el
// import; y el resolvedor de abajo es quien le dice dónde está ese fuera —
// sin él, `@bmail/core/types` es un especificador que rollup no sabe resolver
// (no hace resolución de node por su cuenta) y la línea sobrevive en el
// .d.ts publicado, que es justo lo que rompe al consumidor.
const CONTRATO = fileURLToPath(new URL('../core/dist/types/index.d.ts', import.meta.url))

const resolverElContrato = {
  name: 'resolver-el-contrato-de-bmail',
  resolveId(id) {
    return id === '@bmail/core/types' ? CONTRATO : null
  },
}

const paquete = await rollup({
  input: 'dist-tsc/index.d.ts',
  plugins: [resolverElContrato, dts({ respectExternal: true })],
  // Un aviso de rollup aquí significa un import que se queda en el paquete:
  // se convierte en un fallo del build, no en una línea del log.
  onwarn(aviso) {
    throw new Error(`build del sdk: ${aviso.message}`)
  },
})
await paquete.write({ file: `${SALIDA}/index.d.ts`, format: 'es' })
await paquete.close()

await rm('dist-tsc', { recursive: true, force: true })

console.log('sdk: dist/index.js + dist/index.d.ts, sin dependencias')
