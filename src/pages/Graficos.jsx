import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Plot from 'react-plotly.js'
import {
  Loader2, BarChart2, BarChart3, ScatterChart, BoxSelect, TrendingUp,
  PieChart, AlertCircle, Grid2x2, Minus, GitBranch,
} from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import {
  graficoBarras, graficoHistograma, graficoScatter, graficoBoxplot, graficoLineas,
  graficoPie, graficoErrorBars, graficoQQ, graficoPP, graficoStemLeaf,
  graficoScatterMatrix, graficoViolin,
} from '../services/pythonApi'
import { useT } from '../i18n/useT'

// Gráficos de una sola serie que admiten selector de color
const COLOR_SUPPORTED = ['histograma', 'barras', 'lineas', 'boxplot', 'violin']

const PALETTE = [
  '#3B82F6', // azul
  '#8B5CF6', // violeta
  '#10B981', // verde
  '#F59E0B', // ámbar
  '#EF4444', // rojo
  '#EC4899', // rosa
  '#14B8A6', // teal
  '#F97316', // naranja
]

const CHART_TYPES = [
  // Distribución
  { id: 'histograma',      label: 'Histograma',        icon: <BarChart3 size={14}/>,    group: 'Distribución' },
  { id: 'boxplot',         label: 'Boxplot',            icon: <BoxSelect size={14}/>,    group: 'Distribución', multi: true },
  { id: 'violin',          label: 'Violín',             icon: <Minus size={14}/>,         group: 'Distribución' },
  { id: 'stem_leaf',       label: 'Tallos y hojas',     icon: <GitBranch size={14}/>,    group: 'Distribución' },
  // Frecuencias
  { id: 'barras',          label: 'Barras',             icon: <BarChart2 size={14}/>,    group: 'Frecuencias' },
  { id: 'pie',             label: 'Sectores (Pie)',     icon: <PieChart size={14}/>,     group: 'Frecuencias' },
  { id: 'donut',           label: 'Donut',              icon: <PieChart size={14}/>,     group: 'Frecuencias' },
  // Relaciones
  { id: 'scatter',         label: 'Dispersión',         icon: <ScatterChart size={14}/>, group: 'Relaciones', needsY: true },
  { id: 'lineas',          label: 'Líneas',             icon: <TrendingUp size={14}/>,   group: 'Relaciones', needsYOpt: true },
  { id: 'scatter_matrix',  label: 'Scatter Matrix',     icon: <Grid2x2 size={14}/>,      group: 'Relaciones', multi: true },
  { id: 'error_bars',      label: 'Barras de error',    icon: <AlertCircle size={14}/>,  group: 'Relaciones' },
  // Diagnóstico
  { id: 'qq',              label: 'Q-Q Plot',           icon: <ScatterChart size={14}/>, group: 'Diagnóstico' },
  { id: 'pp',              label: 'P-P Plot',           icon: <ScatterChart size={14}/>, group: 'Diagnóstico' },
]

const GRUPOS = ['Distribución', 'Frecuencias', 'Relaciones', 'Diagnóstico']

export default function Graficos() {
  const t = useT()
  const navigate = useNavigate()
  const { metadata, getNumericColumns, getAllColumns } = useDataStore()

  const [tipo,        setTipo]       = useState('histograma')
  const [varX,        setVarX]       = useState('')
  const [varY,        setVarY]       = useState('')
  const [varGrp,      setVarGrp]     = useState('')
  const [varsMulti,   setVarsMulti]  = useState([])
  const [tipoError,   setTipoError]  = useState('ic95')
  const [color,       setColor]      = useState('#3B82F6')
  const [horizontal,  setHorizontal] = useState(false)
  const [plotData,    setPlotData]   = useState(null)
  const [stemText,    setStemText]   = useState(null)
  const [generando,   setGen]        = useState(false)
  const [error,       setError]      = useState(null)

  const numCols = getNumericColumns()
  const allCols = getAllColumns ? getAllColumns() : numCols
  const tipoObj = CHART_TYPES.find(c => c.id === tipo)

  function toggleMulti(v) {
    setVarsMulti(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])
  }

  async function handleGenerar() {
    setGen(true); setError(null); setPlotData(null); setStemText(null)
    try {
      let res
      switch (tipo) {
        case 'histograma':     res = await graficoHistograma(varX, 0, '', color); break
        case 'barras':         res = await graficoBarras(varX, '', color); break
        case 'scatter':        res = await graficoScatter(varX, varY); break
        case 'boxplot':        res = await graficoBoxplot(varsMulti, false, '', color, horizontal); break
        case 'lineas':         res = await graficoLineas(varX, varY, '', color); break
        case 'pie':            res = await graficoPie(varX, false); break
        case 'donut':          res = await graficoPie(varX, true); break
        case 'violin':         res = await graficoViolin(varX, varGrp, '', color); break
        case 'error_bars':     res = await graficoErrorBars(varX, varGrp, tipoError); break
        case 'qq':             res = await graficoQQ(varX); break
        case 'pp':             res = await graficoPP(varX); break
        case 'stem_leaf':      res = await graficoStemLeaf(varX); setStemText(res?.texto); break
        case 'scatter_matrix': res = await graficoScatterMatrix(varsMulti); break
        default: break
      }
      if (res && res.data) setPlotData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setGen(false)
    }
  }

  if (!metadata) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-400 mb-4">No hay datos cargados.</p>
          <button onClick={() => navigate('/datos')} className="btn-primary text-sm">
            Ir al editor de datos
          </button>
        </div>
      </div>
    )
  }

  const isMulti    = tipoObj?.multi
  const needsY     = tipoObj?.needsY
  const needsYOpt  = tipoObj?.needsYOpt
  const needsGroup = ['violin','error_bars'].includes(tipo)
  const isText     = tipo === 'stem_leaf'

  const canGenerar = !generando && (
    isMulti ? varsMulti.length >= (tipo === 'scatter_matrix' ? 2 : 1)
    : needsY ? (varX && varY)
    : !!varX
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-hidden"
        style={{ background: 'var(--color-surface)' }}>
        <div className="p-3 border-b border-[var(--color-border)] flex-1 overflow-y-auto">
          {GRUPOS.map(grp => (
            <div key={grp} className="mb-3">
              <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1 px-1">{grp}</p>
              {CHART_TYPES.filter(c => c.group === grp).map(ct => (
                <button key={ct.id}
                  onClick={() => { setTipo(ct.id); setPlotData(null); setStemText(null); setError(null); setVarX(''); setVarY(''); setVarsMulti([]); setHorizontal(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors mb-0.5
                    ${tipo === ct.id ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
                  {ct.icon} {ct.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Controles de variables */}
        <div className="p-3 border-t border-[var(--color-border)] space-y-2.5">
          {isMulti ? (
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Variables ({varsMulti.length}{tipo==='scatter_matrix'?'/6':'/8'})</p>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {numCols.map(c => (
                  <label key={c.nombre} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={varsMulti.includes(c.nombre)}
                      disabled={!varsMulti.includes(c.nombre) && varsMulti.length >= (tipo==='scatter_matrix'?6:8)}
                      onChange={() => toggleMulti(c.nombre)} className="accent-blue-500" />
                    <span className="text-xs text-slate-300">{c.nombre}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <VarSelect label="Variable" cols={numCols} value={varX} onChange={setVarX} />
          )}

          {needsY && <VarSelect label="Variable Y" cols={numCols.filter(c=>c.nombre!==varX)} value={varY} onChange={setVarY} />}
          {needsYOpt && <VarSelect label="Variable Y (opc.)" cols={numCols.filter(c=>c.nombre!==varX)} value={varY} onChange={setVarY} optional />}
          {needsGroup && <VarSelect label="Variable de grupo (opc.)" cols={allCols} value={varGrp} onChange={setVarGrp} optional />}

          {tipo === 'error_bars' && (
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Tipo de error</p>
              <select value={tipoError} onChange={e=>setTipoError(e.target.value)} className="input w-full text-xs" size={1}>
                <option value="ic95">IC 95%</option>
                <option value="se">Error estándar</option>
                <option value="sd">Desv. típica</option>
              </select>
            </div>
          )}

          {/* Selector de color — solo para gráficos de serie única */}
          {COLOR_SUPPORTED.includes(tipo) && (
            <div>
              <p className="text-[11px] text-slate-500 mb-1.5">Color</p>
              <div className="flex flex-wrap gap-1.5">
                {PALETTE.map(c => (
                  <button
                    key={c}
                    title={c}
                    onClick={() => setColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ background: c }}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  title="Color personalizado"
                  className="w-5 h-5 rounded-full cursor-pointer border-0 bg-transparent p-0"
                  style={{ appearance: 'none' }}
                />
              </div>
            </div>
          )}

          {/* Opción horizontal — solo boxplot */}
          {tipo === 'boxplot' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={horizontal} onChange={e => setHorizontal(e.target.checked)} className="accent-blue-500" />
              <span className="text-xs text-slate-300">Horizontal</span>
            </label>
          )}

          <button onClick={handleGenerar} disabled={!canGenerar}
            className="btn-primary w-full text-xs flex items-center justify-center gap-1.5">
            {generando ? <><Loader2 size={12} className="animate-spin"/> Generando…</> : 'Generar gráfico'}
          </button>
        </div>
      </aside>

      {/* ── Área del gráfico ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {error && (
          <div className="px-5 py-2 text-xs bg-red-500/10 text-red-400 border-b border-red-500/20">
            ✕ {error}
          </div>
        )}

        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
          {!plotData && !stemText && !error && (
            <p className="text-slate-600 text-sm">Configura las opciones y genera el gráfico</p>
          )}

          {/* Gráfico Plotly */}
          {plotData && (
            <div className="w-full h-full">
              <Plot
                data={plotData.data}
                layout={{ ...plotData.layout, autosize: true }}
                config={{
                  displayModeBar: 'hover', displaylogo: false, responsive: true,
                  modeBarButtonsToRemove: ['select2d','lasso2d','toggleSpikelines'],
                  toImageButtonOptions: { format: 'png', scale: 2 },
                }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          )}

          {/* Tallos y hojas (texto) */}
          {stemText && (
            <pre className="text-xs text-slate-300 font-mono bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4 overflow-auto max-w-xl w-full">
              {stemText}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

function VarSelect({ label, cols, value, onChange, optional }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500 mb-1">{label}</p>
      <select value={value} onChange={e => onChange(e.target.value)} className="input w-full text-xs" size={1}>
        <option value="">{optional ? '— ninguna —' : '— seleccionar —'}</option>
        {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
      </select>
    </div>
  )
}
