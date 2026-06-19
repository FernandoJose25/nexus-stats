import { useState, useRef } from 'react'
import { Code2, Play, Save, FolderOpen, HelpCircle, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { sintaxisEjecutar, sintaxisAyuda } from '../services/pythonApi'

const EJEMPLO = `* Ejemplo de sintaxis Nexus Stats (compatible SPSS)
* Las líneas que empiezan con * son comentarios.

* 1. Calcular una nueva variable
COMPUTE imc = peso_kg / (altura_cm / 100) ** 2.

* 2. Recodificar una variable
RECODE imc (0 thru 18.5=1)(18.5 thru 25=2)(25 thru 30=3)(30 thru 999=4) INTO categoria_imc.

* 3. Filtrar casos
SELECT IF (edad >= 18).

* 4. Ordenar datos
SORT CASES BY edad (A).

* 5. Estadísticos descriptivos
DESCRIPTIVES VARIABLES=edad peso_kg altura_cm.
`

export default function Sintaxis() {
  const { metadata, setMetadata } = useDataStore()
  const [codigo,    setCodigo]  = useState(EJEMPLO)
  const [salida,    setSalida]  = useState(null)
  const [cargando,  setCarg]    = useState(false)
  const [ayuda,     setAyuda]   = useState(null)
  const textareaRef = useRef(null)

  async function ejecutar() {
    setCarg(true); setSalida(null)
    try {
      const res = await sintaxisEjecutar({ codigo, detener_en_error: false })
      setSalida(res)
      if (res.metadata_actual) setMetadata(res.metadata_actual)
    } catch (e) {
      setSalida({ error: e.message, n_comandos: 0, n_exitosos: 0, n_errores: 1, resultados: [] })
    } finally {
      setCarg(false) }
  }

  async function cargarAyuda() {
    if (ayuda) { setAyuda(null); return }
    const res = await sintaxisAyuda()
    setAyuda(res.comandos)
  }

  function insertarComando(cmd) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const nuevo = codigo.slice(0, start) + '\n' + cmd + '\n' + codigo.slice(end)
    setCodigo(nuevo)
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + cmd.length + 2 }, 0)
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ── Editor ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2"
          style={{ background: 'var(--color-surface)' }}>
          <Code2 size={15} className="text-slate-400"/>
          <span className="text-sm font-semibold text-slate-200">Editor de Sintaxis</span>
          <span className="text-[11px] text-slate-500 ml-1">Compatible con comandos SPSS</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={cargarAyuda} className="btn-ghost text-xs flex items-center gap-1.5">
              <HelpCircle size={13}/> Ayuda
            </button>
            <button onClick={() => setCodigo('')} className="btn-ghost text-xs flex items-center gap-1.5">
              <RotateCcw size={12}/> Limpiar
            </button>
            <button onClick={ejecutar} disabled={!codigo.trim() || cargando || !metadata}
              className="btn-primary text-xs flex items-center gap-1.5">
              <Play size={13}/> {cargando ? 'Ejecutando…' : 'Ejecutar ▶'}
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <textarea
            ref={textareaRef}
            value={codigo}
            onChange={e => setCodigo(e.target.value)}
            spellCheck={false}
            className="flex-1 p-4 font-mono text-xs text-slate-200 bg-[#0d1117] resize-none outline-none border-b border-[var(--color-border)] leading-relaxed"
            placeholder="Escribe comandos aquí…"
          />

          {/* Panel de salida */}
          {salida && (
            <div className="h-56 overflow-y-auto border-t border-[var(--color-border)]"
              style={{ background: 'var(--color-surface)' }}>
              <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-3 text-xs">
                <span className={`font-medium ${salida.n_errores > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {salida.n_errores > 0 ? `⚠ ${salida.n_errores} error(es)` : '✓ Ejecutado sin errores'}
                </span>
                <span className="text-slate-500">{salida.n_exitosos}/{salida.n_comandos} comandos OK</span>
              </div>
              <div className="p-3 space-y-1.5">
                {salida.resultados?.map((r, i) => (
                  <div key={i} className={`text-xs font-mono rounded px-3 py-1.5
                    ${r.ok ? 'bg-slate-800/50 text-slate-300' : 'bg-red-500/10 text-red-400'}`}>
                    <span className="text-slate-500 mr-2">[{r.cmd}]</span>
                    <span className="text-[11px]">{r.linea}</span>
                    {r.error && <div className="text-red-400 mt-0.5 text-[10px]">✕ {r.error}</div>}
                    {r.ok && r.resultado && (
                      <div className="text-emerald-600 text-[10px] mt-0.5">
                        {r.resultado.ok ? '✓ OK' : ''}
                        {r.resultado.filas_despues !== undefined && ` → ${r.resultado.filas_despues} filas`}
                        {r.resultado.n !== undefined && ` N=${r.resultado.n}`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Ayuda ──────────────────────────────────────────────────── */}
      {ayuda && (
        <aside className="w-72 flex-shrink-0 border-l border-[var(--color-border)] flex flex-col overflow-y-auto"
          style={{ background: 'var(--color-surface)' }}>
          <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
            <p className="text-xs font-semibold text-slate-300">Comandos disponibles</p>
          </div>
          <div className="p-3 space-y-2">
            {ayuda.map((cmd, i) => (
              <div key={i} className="border border-[var(--color-border)] rounded p-2 cursor-pointer hover:border-blue-500/40 transition-colors"
                onClick={() => insertarComando(cmd.cmd)}>
                <p className="font-mono text-[11px] text-blue-300">{cmd.cmd}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{cmd.desc}</p>
              </div>
            ))}
            <p className="text-[10px] text-slate-600 mt-2">Haz clic en un comando para insertarlo en el editor.</p>
          </div>
        </aside>
      )}
    </div>
  )
}
