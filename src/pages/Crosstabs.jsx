import { useState } from 'react'
import { ChevronDown, ChevronRight, AlertCircle, Plus, Trash2, Sparkles, Grid3x3 } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { crosstabsTabla, crosstabsMultiples } from '../services/pythonApi'
import { useAnalysisStore } from '../store/analysisStore'
import { interpretarResultado } from '../services/groqService'

export default function Crosstabs() {
  const { metadata } = useDataStore()
  const { guardarResultado } = useAnalysisStore()
  const cols = metadata?.column_info ?? []

  const [varFila, setVarFila]   = useState('')
  const [varCol,  setVarCol]    = useState('')
  const [varCapa, setVarCapa]   = useState('')
  const [opciones, setOpciones] = useState({
    porcentaje_fila: true,
    porcentaje_columna: true,
    porcentaje_total: false,
    residuos: true,
    estadisticos: true,
    expected: false,
  })
  const [pares, setPares]             = useState([])
  const [modoMultiple, setModoMultiple] = useState(false)
  const [resultado, setResultado]     = useState(null)
  const [error, setError]             = useState(null)
  const [cargando, setCargando]       = useState(false)
  const [iaTexto, setIaTexto]         = useState('')
  const [iaLoading, setIaLoading]     = useState(false)

  function toggleOpcion(key) {
    setOpciones(o => ({ ...o, [key]: !o[key] }))
  }

  async function handleCalcular() {
    setError(null); setResultado(null); setCargando(true)
    try {
      const res = modoMultiple
        ? await crosstabsMultiples({ pares, estadisticos: opciones.estadisticos })
        : await crosstabsTabla({
            variable_fila: varFila,
            variable_columna: varCol,
            variable_capa: varCapa || null,
            ...opciones,
          })
      setResultado(res)
      guardarResultado('crosstabs', [varFila, varCol], res)
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  async function handleIA() {
    const apiKey = localStorage.getItem('groq-api-key')
    if (!apiKey || !resultado) return
    setIaLoading(true); setIaTexto('')
    try {
      const texto = await interpretarResultado(resultado, apiKey, 'Tabla de contingencia (crosstabs)', null)
      setIaTexto(texto)
    } catch (e) {
      setIaTexto('Error al conectar con IA: ' + e.message)
    } finally {
      setIaLoading(false)
    }
  }

  const sinDatos   = !metadata
  const canCalc    = !sinDatos && !cargando &&
    (modoMultiple ? pares.length > 0 : (varFila && varCol))

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── Panel izquierdo ────────────────────────────────────── */}
      <aside
        className="w-60 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-surface)' }}
      >
        <div className="px-4 pt-4 pb-2 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-slate-200">Tablas cruzadas</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Equivale a Crosstabs en SPSS</p>
        </div>

        <div className="p-3 space-y-3 flex-1">
          {/* Modo */}
          <div className="flex gap-1.5">
            {[['simple','Simple'],['multiple','Múltiples']].map(([v,l]) => (
              <button key={v}
                onClick={() => { setModoMultiple(v==='multiple'); setResultado(null); setError(null) }}
                className={`flex-1 py-1 rounded text-xs transition-colors border
                  ${(v==='multiple')===modoMultiple
                    ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                    : 'text-slate-400 border-slate-700 hover:text-slate-200'}`}
              >{l}</button>
            ))}
          </div>

          {!modoMultiple ? (
            <>
              <FieldSelect label="Variable de fila"     cols={cols} value={varFila}  onChange={setVarFila} />
              <FieldSelect label="Variable de columna"  cols={cols} value={varCol}   onChange={setVarCol} />
              <FieldSelect label="Capa (opcional)"       cols={cols} value={varCapa}  onChange={setVarCapa} optional />
            </>
          ) : (
            <ParesEditor pares={pares} setPares={setPares} cols={cols} />
          )}

          {/* Celdas */}
          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1.5">Contenido de celdas</p>
            <div className="space-y-1.5">
              {[
                ['porcentaje_fila',    '% de fila'],
                ['porcentaje_columna', '% de columna'],
                ['porcentaje_total',   '% del total'],
                ['expected',           'Frecuencias esperadas'],
                ['residuos',           'Residuos tipificados'],
              ].map(([k, lbl]) => (
                <Checkbox key={k} checked={opciones[k]} onChange={() => toggleOpcion(k)} label={lbl} />
              ))}
            </div>
          </div>

          {/* Estadísticos */}
          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1.5">Estadísticos</p>
            <Checkbox
              checked={opciones.estadisticos}
              onChange={() => toggleOpcion('estadisticos')}
              label="Chi², V de Cramér, Lambda, Gamma…"
            />
          </div>

          <button
            disabled={!canCalc}
            onClick={handleCalcular}
            className="btn-primary w-full mt-1"
          >
            {cargando ? 'Calculando…' : 'Calcular'}
          </button>
        </div>
      </aside>

      {/* ── Panel central ───────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-5">
        {sinDatos && <Empty msg="Carga un dataset primero desde el Editor de datos" />}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-4">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {resultado && !modoMultiple && (
          <TablaResultado resultado={resultado} opciones={opciones} />
        )}
        {resultado && modoMultiple && resultado.resultados?.map((r, i) => (
          <div key={i} className="mb-8">
            <TablaResultado resultado={r} opciones={opciones} />
          </div>
        ))}

        {resultado && (
          <div className="mt-4 flex gap-2">
            <button onClick={handleIA} disabled={iaLoading}
              className="btn-ghost text-xs flex items-center gap-1.5">
              <Sparkles size={13} />
              {iaLoading ? 'Interpretando…' : 'Interpretar con IA'}
            </button>
          </div>
        )}

        {iaTexto && (
          <div className="mt-4 p-4 rounded border border-[var(--color-border)] text-xs text-slate-300 leading-relaxed whitespace-pre-wrap"
            style={{ background: 'var(--color-surface)' }}>
            {iaTexto}
          </div>
        )}
      </main>
    </div>
  )
}

/* ── helpers de UI ───────────────────────────────────────────────────────── */

function Empty({ msg }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
      <Grid3x3 size={32} className="text-slate-700" />
      <p className="text-slate-500 text-sm">{msg}</p>
    </div>
  )
}

function Checkbox({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-blue-500 flex-shrink-0" />
      <span className="text-xs text-slate-300">{label}</span>
    </label>
  )
}

function FieldSelect({ label, cols, value, onChange, optional }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input w-full text-xs"
        size={1}
      >
        <option value="">{optional ? '— ninguna —' : '— seleccionar —'}</option>
        {cols.map(c => (
          <option key={c.nombre} value={c.nombre}>{c.nombre}</option>
        ))}
      </select>
    </div>
  )
}

function ParesEditor({ pares, setPares, cols }) {
  const addPar    = () => setPares(p => [...p, { fila: '', columna: '' }])
  const removePar = i => setPares(p => p.filter((_, idx) => idx !== i))
  const update    = (i, f, v) => setPares(p => p.map((par, idx) => idx === i ? { ...par, [f]: v } : par))

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-slate-500">Pares de variables</span>
        <button onClick={addPar} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
          <Plus size={12} /> Añadir
        </button>
      </div>
      {pares.length === 0 && (
        <p className="text-[11px] text-slate-600">Añade al menos un par</p>
      )}
      <div className="space-y-2">
        {pares.map((par, i) => (
          <div key={i} className="flex gap-1 items-center">
            <select value={par.fila}    onChange={e => update(i,'fila',e.target.value)}    className="input text-xs flex-1" size={1}>
              <option value="">Fila</option>
              {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
            </select>
            <ChevronRight size={11} className="text-slate-600 flex-shrink-0" />
            <select value={par.columna} onChange={e => update(i,'columna',e.target.value)} className="input text-xs flex-1" size={1}>
              <option value="">Col.</option>
              {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
            </select>
            <button onClick={() => removePar(i)} className="text-slate-600 hover:text-red-400 flex-shrink-0">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Tabla de resultados ─────────────────────────────────────────────────── */

function TablaResultado({ resultado, opciones }) {
  const [showStats, setShowStats] = useState(true)

  if (resultado.error) {
    return (
      <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-4">
        {resultado.variable_fila} × {resultado.variable_columna}: {resultado.error}
      </div>
    )
  }

  if (resultado.tipo === 'crosstabs_con_capa') {
    return (
      <div className="space-y-6">
        {resultado.capas.map((capa, i) => (
          <div key={i}>
            <p className="text-xs text-amber-400 font-medium mb-2">
              {resultado.variable_capa} = {capa.capa}
            </p>
            <TablaResultado resultado={{ ...capa, tipo: 'crosstabs' }} opciones={opciones} />
          </div>
        ))}
      </div>
    )
  }

  const {
    filas, columnas, frecuencias_observadas, totales_fila, totales_columna, n_total,
    porcentaje_fila, porcentaje_columna, porcentaje_total,
    frecuencias_esperadas, residuos_tipificados, residuos_corregidos, estadisticos,
  } = resultado

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-200">
        {resultado.variable_fila}
        <span className="text-slate-500 mx-1.5">×</span>
        {resultado.variable_columna}
        <span className="text-slate-500 text-xs ml-2">N = {n_total}</span>
      </p>

      {/* Tabla de contingencia */}
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-slate-500 border border-[var(--color-border)] min-w-[120px]"
                style={{ background: 'var(--color-surface)' }}>
                {resultado.variable_fila} / {resultado.variable_columna}
              </th>
              {columnas.map(c => (
                <th key={c} className="px-3 py-2 text-center text-slate-300 font-medium border border-[var(--color-border)] min-w-[90px]"
                  style={{ background: 'var(--color-surface)' }}>{c}</th>
              ))}
              <th className="px-3 py-2 text-center text-slate-400 border border-[var(--color-border)] min-w-[80px] bg-slate-800/60">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, i) => (
              <tr key={fila} className="hover:bg-white/[0.02]">
                <td className="px-3 py-2 text-slate-300 font-medium border border-[var(--color-border)]"
                  style={{ background: 'var(--color-surface)' }}>
                  {fila}
                </td>
                {columnas.map((_, j) => (
                  <td key={j} className="px-3 py-1.5 text-center border border-[var(--color-border)] align-top">
                    <CeldaTabla
                      obs={frecuencias_observadas[i][j]}
                      pctFila={porcentaje_fila?.[i]?.[j]}
                      pctCol={porcentaje_columna?.[i]?.[j]}
                      pctTotal={porcentaje_total?.[i]?.[j]}
                      esperado={frecuencias_esperadas?.[i]?.[j]}
                      resTyp={residuos_tipificados?.[i]?.[j]}
                      resAdj={residuos_corregidos?.[i]?.[j]}
                      opciones={opciones}
                    />
                  </td>
                ))}
                <td className="px-3 py-2 text-center border border-[var(--color-border)] bg-slate-800/30 align-top">
                  <div className="font-medium text-slate-300">{totales_fila[i]}</div>
                  {opciones.porcentaje_fila    && <div className="text-[10px] text-slate-500">100%</div>}
                  {opciones.porcentaje_total   && <div className="text-[10px] text-blue-500">{((totales_fila[i]/n_total)*100).toFixed(1)}%</div>}
                </td>
              </tr>
            ))}

            {/* Fila Total */}
            <tr className="bg-slate-800/30">
              <td className="px-3 py-2 text-slate-400 font-medium border border-[var(--color-border)]">Total</td>
              {columnas.map((_, j) => (
                <td key={j} className="px-3 py-2 text-center border border-[var(--color-border)] align-top">
                  <div className="font-medium text-slate-300">{totales_columna[j]}</div>
                  {opciones.porcentaje_columna && <div className="text-[10px] text-slate-500">100%</div>}
                  {opciones.porcentaje_total   && <div className="text-[10px] text-blue-500">{((totales_columna[j]/n_total)*100).toFixed(1)}%</div>}
                </td>
              ))}
              <td className="px-3 py-2 text-center border border-[var(--color-border)]">
                <div className="font-bold text-slate-200">{n_total}</div>
                {opciones.porcentaje_total && <div className="text-[10px] text-blue-500">100%</div>}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Leyenda */}
        <div className="flex flex-wrap gap-3 mt-1.5 text-[10px]">
          <span className="text-slate-400">Recuento</span>
          {opciones.porcentaje_fila    && <span className="text-slate-500">% fila</span>}
          {opciones.porcentaje_columna && <span className="text-emerald-700">% columna</span>}
          {opciones.porcentaje_total   && <span className="text-blue-700">% total</span>}
          {opciones.expected           && <span className="text-amber-700">[esperado]</span>}
          {opciones.residuos           && <span className="text-purple-500">res.tip. / res.cor.</span>}
        </div>
      </div>

      {/* Estadísticos de contraste */}
      {estadisticos && (
        <div className="rounded border border-[var(--color-border)] overflow-hidden"
          style={{ background: 'var(--color-surface)' }}>
          <button
            onClick={() => setShowStats(s => !s)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-300 hover:bg-white/5"
          >
            {showStats ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
            Estadísticos de contraste
          </button>
          {showStats && (
            <div className="px-4 pb-4 border-t border-[var(--color-border)]">
              <EstadisticosTabla stats={estadisticos} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CeldaTabla({ obs, pctFila, pctCol, pctTotal, esperado, resTyp, resAdj, opciones }) {
  const adjAbs = resAdj !== undefined ? Math.abs(resAdj) : 0
  const adjColor = adjAbs >= 1.96
    ? (resAdj > 0 ? 'text-emerald-400' : 'text-red-400')
    : 'text-slate-500'

  return (
    <div className="leading-tight space-y-0.5">
      <div className="font-semibold text-slate-200">{obs}</div>
      {opciones.porcentaje_fila    && pctFila    != null && <div className="text-[10px] text-slate-400">{pctFila}%</div>}
      {opciones.porcentaje_columna && pctCol     != null && <div className="text-[10px] text-emerald-600">{pctCol}%</div>}
      {opciones.porcentaje_total   && pctTotal   != null && <div className="text-[10px] text-blue-600">{pctTotal}%</div>}
      {opciones.expected           && esperado   != null && <div className="text-[10px] text-amber-600">[{esperado}]</div>}
      {opciones.residuos           && resTyp     != null && (
        <div className={`text-[10px] ${adjColor}`}>{resTyp} / {resAdj}</div>
      )}
    </div>
  )
}

function EstadisticosTabla({ stats }) {
  const tests = [
    ['Chi-cuadrado de Pearson',          stats.chi2_pearson,              stats.chi2_gl,                 stats.chi2_p],
    stats.chi2_yates != null
      ? ['Chi² corr. Yates (2×2)',        stats.chi2_yates,               stats.chi2_gl,                 stats.chi2_yates_p]
      : null,
    ['Razón de verosimilitud G²',         stats.razon_verosimilitud_g2,   stats.razon_verosimilitud_gl,  stats.razon_verosimilitud_p],
    stats.fisher_exacto_p != null
      ? ['Prueba exacta de Fisher (2×2)', '—',                            '—',                           stats.fisher_exacto_p]
      : null,
  ].filter(Boolean)

  const medidas = [
    stats.phi        != null ? ['Phi',              stats.phi]        : null,
    ['V de Cramér',   `${stats.v_cramer} (${stats.interpretacion_v})`],
    ['C contingencia', stats.c_contingencia],
    stats.gamma      != null ? ['Gamma',            stats.gamma]      : null,
    stats.tau_b_kendall != null ? ['Tau-b Kendall', stats.tau_b_kendall] : null,
    ['Lambda (fila dep.)', stats.lambda_fila],
  ].filter(Boolean)

  return (
    <div className="pt-3 space-y-4">
      {/* Tests */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
              <th className="text-left pb-1.5 pr-4">Estadístico</th>
              <th className="text-right pb-1.5 pr-4">Valor</th>
              <th className="text-right pb-1.5 pr-4">gl</th>
              <th className="text-right pb-1.5 pr-4">p-valor</th>
              <th className="text-center pb-1.5">Sig.</th>
            </tr>
          </thead>
          <tbody>
            {tests.map(([nombre, valor, gl, p], i) => (
              <tr key={i} className="border-b border-[var(--color-border)]/50">
                <td className="py-1.5 pr-4 text-slate-300">{nombre}</td>
                <td className="py-1.5 pr-4 text-right font-mono text-slate-200">{typeof valor === 'number' ? valor.toFixed(4) : valor}</td>
                <td className="py-1.5 pr-4 text-right text-slate-400">{typeof gl === 'number' ? gl : gl}</td>
                <td className="py-1.5 pr-4 text-right font-mono text-slate-200">{typeof p === 'number' ? p.toFixed(4) : p}</td>
                <td className="py-1.5 text-center">
                  {typeof p === 'number' && p < 0.05
                    ? <span className="text-emerald-400 font-bold">✓</span>
                    : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Medidas de asociación */}
      <div>
        <p className="text-[11px] text-slate-500 font-medium mb-2">Medidas de asociación</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
          {medidas.map(([nombre, valor], i) => (
            <div key={i} className="flex justify-between text-xs gap-2">
              <span className="text-slate-400">{nombre}</span>
              <span className="font-mono text-slate-200 text-right">{typeof valor === 'number' ? valor.toFixed(4) : valor}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Advertencia */}
      {stats.celdas_esperadas_menor_5_pct > 20 && (
        <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
          ⚠ {stats.celdas_esperadas_menor_5_pct}% de celdas tienen frecuencia esperada &lt; 5
          (mínimo: {stats.minima_frecuencia_esperada}). Considerar prueba exacta de Fisher o agrupar categorías.
        </p>
      )}
    </div>
  )
}
