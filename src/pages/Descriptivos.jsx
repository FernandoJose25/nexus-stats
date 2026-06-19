import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, Sparkles, ChevronDown, ChevronUp, Download, X, Loader2, Check, AlertCircle } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { useAnalysisStore } from '../store/analysisStore'
import { calcularDescriptivos, exportarPDF, exportarExcel } from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'
import { useT } from '../i18n/useT'
import TablaFrecuencias from '../components/Results/TablaFrecuencias'
import HistorialPanel from '../components/Layout/HistorialPanel'

export default function Descriptivos() {
  const t = useT()
  const navigate = useNavigate()
  const { metadata, selectedVariables, toggleVariable, getNumericColumns } = useDataStore()
  const { guardarResultado, resultadoActivo, analizando, setAnalizando, setErrorAnalisis } = useAnalysisStore()

  const [expandedVars, setExpandedVars] = useState({})
  const [incluirFrecuencias, setIncluirFrecuencias] = useState(false)
  const [exportStatus, setExportStatus] = useState(null)
  const [interpretacionIA, setInterpretacionIA] = useState(null)
  const [interpretandoIA, setInterpretandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState(null)
  const abortRef = useRef(null)

  const numericCols = getNumericColumns()

  async function handleCalcular() {
    if (selectedVariables.length === 0) return
    setAnalizando(true)
    setErrorAnalisis(null)
    try {
      const resp = await calcularDescriptivos(selectedVariables, incluirFrecuencias)
      guardarResultado('descriptivos', selectedVariables, resp)
      // Expandir todos por defecto
      const exp = {}
      resp.resultados.forEach((r) => { exp[r.variable] = true })
      setExpandedVars(exp)
    } catch (err) {
      setErrorAnalisis(err.message)
    }
  }

  async function handleInterpretarIA(bloqueResultado) {
    const apiKey = localStorage.getItem('nexus-groq-key')
    if (!apiKey) {
      alert(t('ia.sinApiKey'))
      navigate('/configuracion')
      return
    }

    setInterpretandoIA(true)
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const texto = await interpretarResultado(bloqueResultado, apiKey, 'Estadísticos descriptivos', abortRef.current.signal)
      setInterpretacionIA(texto)
    } catch (err) {
      if (err.name === 'AbortError') return
      if (err.message === 'NO_API_KEY') setErrorIA(t('ia.sinApiKey'))
      else if (err.message === 'API_KEY_INVALIDA') setErrorIA(t('ia.errorApiKey'))
      else if (err.message === 'LIMITE_ALCANZADO') setErrorIA(t('ia.limiteAlcanzado'))
      else setErrorIA(err.message)
    }
  }

  async function handleExportar(formato) {
    const ruta = await window.electronAPI?.saveExport(formato === 'pdf' ? 'pdf' : 'xlsx')
    if (!ruta || !resultadoActivo) return
    try {
      if (formato === 'pdf') await exportarPDF(resultadoActivo.resultado.resultados, ruta)
      else await exportarExcel(resultadoActivo.resultado.resultados, ruta)
      setExportStatus('ok')
    } catch {
      setExportStatus('error')
    } finally {
      setTimeout(() => setExportStatus(null), 3000)
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

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Panel izquierdo — selección de variables */}
      <aside className="w-52 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Variables</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {numericCols.map((col) => (
            <label key={col.nombre} className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
              <input
                type="checkbox"
                checked={selectedVariables.includes(col.nombre)}
                onChange={() => toggleVariable(col.nombre)}
                className="accent-blue-500 w-3.5 h-3.5 rounded"
              />
              <span className="text-sm text-slate-300 truncate">{col.nombre}</span>
            </label>
          ))}
          {numericCols.length === 0 && (
            <p className="text-slate-600 text-xs p-2">Sin variables numéricas</p>
          )}
        </div>
        <div className="p-3 border-t border-[var(--color-border)] space-y-2">
          <label className="flex items-center gap-2 px-1 cursor-pointer">
            <input
              type="checkbox"
              checked={incluirFrecuencias}
              onChange={(e) => setIncluirFrecuencias(e.target.checked)}
              className="accent-blue-500 w-3.5 h-3.5"
            />
            <span className="text-xs text-slate-400">Incluir frecuencias</span>
          </label>
          <button
            onClick={handleCalcular}
            disabled={selectedVariables.length === 0 || analizando}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            {analizando ? <><Loader2 size={14} className="animate-spin" /> {t('descriptivos.calculando')}</> : t('descriptivos.calcular')}
          </button>
        </div>
        <HistorialPanel />
      </aside>

      {/* Panel central — resultados */}
      <div className="flex-1 overflow-y-auto p-5 selectable">
        {!resultadoActivo ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <BarChart3 size={40} className="text-slate-700 mb-4" />
            <p className="text-slate-400 font-medium">{t('descriptivos.sinResultados')}</p>
            <p className="text-slate-600 text-sm mt-1 max-w-xs">{t('descriptivos.sinResultadosDesc')}</p>
          </div>
        ) : (
          <>
            {/* Barra de acciones */}
            <div className="flex items-center justify-between mb-5" style={{ paddingRight: 'calc(var(--titlebar-controls-width) + 8px)' }}>
              <p className="text-sm text-slate-400">
                {resultadoActivo.resultado.n_variables} variable{resultadoActivo.resultado.n_variables !== 1 ? 's' : ''}
              </p>
              <div className="flex items-center gap-2">
                {exportStatus === 'ok' && <span className="text-emerald-400 text-xs flex items-center gap-1"><Check size={12} /> Guardado</span>}
                {exportStatus === 'error' && <span className="text-red-400 text-xs flex items-center gap-1"><AlertCircle size={12} /> Error al exportar</span>}
                <button onClick={() => handleExportar('pdf')} className="btn-ghost text-xs flex items-center gap-1.5">
                  <Download size={13} /> PDF
                </button>
                <button onClick={() => handleExportar('excel')} className="btn-ghost text-xs flex items-center gap-1.5">
                  <Download size={13} /> Excel
                </button>
              </div>
            </div>

            {/* Cards por variable */}
            <div className="space-y-4">
              {resultadoActivo.resultado.resultados.map((bloque) => (
                <div key={bloque.variable}>
                  <ResultCard
                    bloque={bloque}
                    expanded={expandedVars[bloque.variable] ?? true}
                    onToggle={() => setExpandedVars((prev) => ({ ...prev, [bloque.variable]: !prev[bloque.variable] }))}
                    onInterpretarIA={() => handleInterpretarIA(bloque)}
                    t={t}
                  />
                  {bloque.frecuencias && (
                    <TablaFrecuencias datos={bloque.frecuencias} />
                  )}
                </div>
              ))}
            </div>

            {/* Errores del backend */}
            {resultadoActivo.resultado.errores?.length > 0 && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                {resultadoActivo.resultado.errores.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Panel derecho — IA */}
      {(interpretacionIA || interpretandoIA || errorIA) && (
        <aside className="w-72 flex-shrink-0 border-l border-[var(--color-border)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2 text-amber-400">
              <Sparkles size={14} />
              <span className="text-xs font-semibold">{t('ia.titulo')}</span>
            </div>
            <button onClick={() => { setInterpretacionIA(null); setErrorIA(null); }} className="btn-ghost p-1">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {interpretandoIA && (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 size={14} className="animate-spin" /> {t('ia.interpretando')}
              </div>
            )}
            {errorIA && <p className="text-red-400 text-xs">{errorIA}</p>}
            {interpretacionIA && (
              <p className="text-slate-300 text-sm leading-relaxed">{interpretacionIA}</p>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}

function ResultCard({ bloque, expanded, onToggle, onInterpretarIA, t }) {
  const stats = [
    ['N válidos', bloque.n_validos],
    ['N perdidos', bloque.n_perdidos],
    [t('descriptivos.media'), bloque.media],
    [t('descriptivos.errorEstandarMedia'), bloque.error_estandar_media],
    [t('descriptivos.mediana'), bloque.mediana],
    [t('descriptivos.moda'), Array.isArray(bloque.moda)
      ? (bloque.moda.length === 0 ? 'Sin moda' : bloque.moda.join(', '))
      : bloque.moda],
    [t('descriptivos.desvTipica'), bloque.desv_tipica],
    [t('descriptivos.varianza'), bloque.varianza],
    [t('descriptivos.asimetria'), bloque.asimetria],
    [t('descriptivos.errorEstandarAsimetria'), bloque.error_estandar_asimetria],
    [t('descriptivos.curtosis'), bloque.curtosis],
    [t('descriptivos.errorEstandarCurtosis'), bloque.error_estandar_curtosis],
    [t('descriptivos.minimo'), bloque.minimo],
    [t('descriptivos.maximo'), bloque.maximo],
    [t('descriptivos.rango'), bloque.rango],
    [t('descriptivos.suma'), bloque.suma],
    ['IQR', bloque.iqr],
  ].filter(([, v]) => v != null)

  return (
    <div className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <span className="font-medium text-slate-200 text-sm">{bloque.variable}</span>
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); onInterpretarIA() }}
            className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors px-2 py-1 rounded hover:bg-amber-400/10"
          >
            <Sparkles size={12} /> {t('ia.interpretar')}
          </button>
          {expanded ? <ChevronUp size={15} className="text-slate-500" /> : <ChevronDown size={15} className="text-slate-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)]">
          <table className="w-full text-xs">
            <tbody>
              {stats.map(([label, value], i) => (
                <tr key={label} className={i % 2 === 0 ? 'bg-white/[0.015]' : ''}>
                  <td className="px-4 py-2 text-slate-400 font-medium">{label}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-200">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Percentiles */}
          {bloque.percentiles && (
            <div className="px-4 pb-4 pt-2 border-t border-[var(--color-border)]">
              <p className="text-xs text-slate-500 mb-2 font-medium">{t('descriptivos.percentiles')}</p>
              <div className="grid grid-cols-7 gap-1">
                {Object.entries(bloque.percentiles).map(([key, val]) => (
                  <div key={key} className="text-center">
                    <div className="stat-value text-slate-200 text-[11px]">{val}</div>
                    <div className="text-slate-600 text-[9px] mt-0.5">{key.toUpperCase()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
