import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles, X, FlaskConical, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import {
  tUnaMuestra, tIndependientes, tRelacionadas,
  chiCuadrado, mannWhitney, kruskalWallis, testsNormalidad,
  wilcoxon, fisherExact, friedman, testBinomial, testRachas,
} from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'

const TESTS = [
  { id: 'normalidad',      label: 'Tests de normalidad', desc: 'Shapiro-Wilk y Kolmogorov-Smirnov', tipo: 'normalidad' },
  { id: 't-una-muestra',   label: 't — Una muestra',     desc: 'Compara la media con un valor de referencia', tipo: 'parametrico' },
  { id: 't-independientes',label: 't — Muestras independientes', desc: 'Compara medias de dos grupos independientes', tipo: 'parametrico' },
  { id: 't-relacionadas',  label: 't — Muestras relacionadas',   desc: 'Compara dos mediciones del mismo grupo', tipo: 'parametrico' },
  { id: 'chi-cuadrado',    label: 'Chi-cuadrado',        desc: 'Independencia entre variables categóricas', tipo: 'no-parametrico' },
  { id: 'fisher',          label: 'Fisher exacto',       desc: 'Tabla 2×2 con n pequeño o celdas < 5', tipo: 'no-parametrico' },
  { id: 'mann-whitney',    label: 'Mann-Whitney U',      desc: 'Alternativa no paramétrica a t independientes', tipo: 'no-parametrico' },
  { id: 'wilcoxon',        label: 'Wilcoxon rangos',     desc: 'Alternativa no paramétrica a t relacionadas', tipo: 'no-parametrico' },
  { id: 'kruskal-wallis',  label: 'Kruskal-Wallis H',   desc: 'Comparación no paramétrica de 3+ grupos independientes', tipo: 'no-parametrico' },
  { id: 'friedman',        label: 'Friedman',            desc: 'ANOVA no paramétrico de medidas repetidas (k ≥ 3)', tipo: 'no-parametrico' },
  { id: 'binomial',        label: 'Test binomial',       desc: 'Contrasta una proporción observada vs. esperada', tipo: 'no-parametrico' },
  { id: 'rachas',          label: 'Test de rachas',      desc: 'Aleatoriedad de una secuencia (Wald-Wolfowitz)', tipo: 'no-parametrico' },
]

const ALTERNATIVAS = [
  { id: 'two-sided', label: 'Bilateral (≠)' },
  { id: 'less',      label: 'Unilateral izquierda (<)' },
  { id: 'greater',   label: 'Unilateral derecha (>)' },
]

const MAGNITUD_STYLE = {
  despreciable: 'text-slate-500 bg-slate-500/10',
  pequeño:      'text-sky-400 bg-sky-400/10',
  mediano:      'text-amber-400 bg-amber-400/10',
  grande:       'text-violet-400 bg-violet-400/10',
}

export default function Hipotesis() {
  const navigate = useNavigate()
  const { metadata, getNumericColumns, getAllColumns } = useDataStore()

  const [testActivo, setTestActivo] = useState('t-una-muestra')
  const [calculando, setCalculando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  // Parámetros compartidos
  const [alpha, setAlpha] = useState(0.05)
  const [alternativa, setAlternativa] = useState('two-sided')

  // Normalidad: múltiples variables
  const [varsNormalidad, setVarsNormalidad] = useState([])
  // Friedman: múltiples variables
  const [varsFriedman, setVarsFriedman] = useState([])
  // Binomial
  const [pEsperada, setPEsperada] = useState(0.5)
  const [categoriaExito, setCategoriaExito] = useState('')
  // Rachas
  const [puntoCortRachas, setPuntoCortRachas] = useState('')

  // Parámetros por test
  const [varPrincipal, setVarPrincipal] = useState('')
  const [varSecundaria, setVarSecundaria] = useState('')
  const [varGrupo, setVarGrupo] = useState('')
  const [valorRef, setValorRef] = useState('')
  const [igualdadVarianzas, setIgualdadVarianzas] = useState(true)

  // IA
  const [interpretacionIA, setInterpretacionIA] = useState(null)
  const [interpretandoIA, setInterpretandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState(null)
  const abortRef = useRef(null)

  const numericCols = getNumericColumns?.() ?? []
  const allCols = getAllColumns?.() ?? []

  // Reset estado al cambiar test
  function handleSelectTest(id) {
    setTestActivo(id)
    setResultado(null)
    setError(null)
    setInterpretacionIA(null)
    setErrorIA(null)
  }

  async function handleCalcular() {
    setCalculando(true)
    setError(null)
    setResultado(null)
    try {
      let resp
      switch (testActivo) {
        case 'normalidad':
          if (varsNormalidad.length === 0) throw new Error('Selecciona al menos una variable')
          resp = await testsNormalidad(varsNormalidad, alpha)
          break
        case 'wilcoxon':
          if (!varPrincipal) throw new Error('Selecciona Variable 1')
          resp = await wilcoxon(varPrincipal, varSecundaria || null, parseFloat(valorRef) || 0, alpha, alternativa)
          break
        case 'fisher':
          if (!varPrincipal || !varSecundaria) throw new Error('Selecciona ambas variables')
          resp = await fisherExact(varPrincipal, varSecundaria, alpha, alternativa)
          break
        case 'friedman':
          if (varsFriedman.length < 3) throw new Error('Selecciona al menos 3 variables')
          resp = await friedman(varsFriedman, alpha)
          break
        case 'binomial':
          if (!varPrincipal) throw new Error('Selecciona una variable')
          resp = await testBinomial(varPrincipal, categoriaExito || null, parseFloat(pEsperada) || 0.5, alpha, alternativa)
          break
        case 'rachas':
          if (!varPrincipal) throw new Error('Selecciona una variable')
          resp = await testRachas(varPrincipal, puntoCortRachas !== '' ? parseFloat(puntoCortRachas) : null, alpha)
          break
        case 't-una-muestra':
          if (!varPrincipal || valorRef === '') throw new Error('Completa todos los campos')
          resp = await tUnaMuestra(varPrincipal, parseFloat(valorRef), alpha, alternativa)
          break
        case 't-independientes':
          if (!varPrincipal || !varGrupo) throw new Error('Completa todos los campos')
          resp = await tIndependientes(varPrincipal, varGrupo, alpha, alternativa, igualdadVarianzas)
          break
        case 't-relacionadas':
          if (!varPrincipal || !varSecundaria) throw new Error('Completa todos los campos')
          resp = await tRelacionadas(varPrincipal, varSecundaria, alpha, alternativa)
          break
        case 'chi-cuadrado':
          if (!varPrincipal || !varSecundaria) throw new Error('Completa todos los campos')
          resp = await chiCuadrado(varPrincipal, varSecundaria, alpha)
          break
        case 'mann-whitney':
          if (!varPrincipal || !varGrupo) throw new Error('Completa todos los campos')
          resp = await mannWhitney(varPrincipal, varGrupo, alpha, alternativa)
          break
        case 'kruskal-wallis':
          if (!varPrincipal || !varGrupo) throw new Error('Completa todos los campos')
          resp = await kruskalWallis(varPrincipal, varGrupo, alpha)
          break
      }
      setResultado(resp)
    } catch (err) {
      setError(err.message)
    } finally {
      setCalculando(false)
    }
  }

  async function handleInterpretarIA() {
    const apiKey = localStorage.getItem('nexus-groq-key')
    if (!apiKey) { navigate('/configuracion'); return }
    setInterpretandoIA(true)
    setInterpretacionIA(null)
    setErrorIA(null)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const texto = await interpretarResultado(resultado, apiKey, resultado.test, abortRef.current.signal)
      setInterpretacionIA(texto)
    } catch (err) {
      if (err.name === 'AbortError') return
      setErrorIA(err.message)
    } finally {
      setInterpretandoIA(false)
    }
  }

  if (!metadata) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-400 mb-4">No hay datos cargados.</p>
          <button onClick={() => navigate('/datos')} className="btn-primary text-sm">Ir al editor de datos</button>
        </div>
      </div>
    )
  }

  const testInfo = TESTS.find((t) => t.id === testActivo)
  const canCalcular = (() => {
    if (testActivo === 'normalidad') return varsNormalidad.length > 0
    if (testActivo === 'friedman') return varsFriedman.length >= 3
    if (testActivo === 'binomial' || testActivo === 'rachas') return !!varPrincipal
    if (!varPrincipal) return false
    if (testActivo === 't-una-muestra') return valorRef !== ''
    if (testActivo === 't-relacionadas' || testActivo === 'chi-cuadrado' || testActivo === 'fisher') return !!varSecundaria
    if (testActivo === 'wilcoxon') return true   // var_2 es opcional
    return !!varGrupo
  })()

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tests de hipótesis</p>
        </div>

        {/* Lista de tests */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {['normalidad', 'parametrico', 'no-parametrico'].map((tipo) => (
            <div key={tipo}>
              <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-2 pt-2 pb-1">
                {tipo === 'normalidad' ? 'Normalidad' : tipo === 'parametrico' ? 'Paramétricos' : 'No paramétricos'}
              </p>
              {TESTS.filter((t) => t.tipo === tipo).map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelectTest(t.id)}
                  title={t.desc}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors
                    ${testActivo === t.id
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Opciones */}
        <div className="p-3 border-t border-[var(--color-border)] space-y-3">
          <SelectField
            label="Nivel α"
            value={alpha}
            onChange={(e) => setAlpha(parseFloat(e.target.value))}
          >
            <option value={0.05}>0.05 (95%)</option>
            <option value={0.01}>0.01 (99%)</option>
            <option value={0.001}>0.001 (99.9%)</option>
          </SelectField>

          {testActivo !== 'chi-cuadrado' && testActivo !== 'kruskal-wallis' && (
            <SelectField
              label="Hipótesis alternativa"
              value={alternativa}
              onChange={(e) => setAlternativa(e.target.value)}
            >
              {ALTERNATIVAS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </SelectField>
          )}

          <button
            onClick={handleCalcular}
            disabled={!canCalcular || calculando}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            {calculando
              ? <><Loader2 size={14} className="animate-spin" /> Calculando...</>
              : 'Calcular'}
          </button>
        </div>
      </aside>

      {/* Panel central */}
      <div className="flex-1 overflow-y-auto">
        {/* Formulario de parámetros */}
        <div className="p-5 border-b border-[var(--color-border)]">
          <div
            className="flex items-start justify-between mb-4"
            style={{ paddingRight: 'calc(var(--titlebar-controls-width) + 8px)' }}
          >
            <div>
              <p className="font-semibold text-slate-200">{testInfo.label}</p>
              <p className="text-slate-500 text-xs mt-0.5">{testInfo.desc}</p>
            </div>
            {resultado && (
              <button
                onClick={handleInterpretarIA}
                disabled={interpretandoIA}
                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-400/10 border border-amber-400/20 transition-colors"
              >
                {interpretandoIA ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Interpretar con IA
              </button>
            )}
          </div>

          {testActivo === 'normalidad' ? (
            <div>
              <p className="text-xs text-slate-500 mb-2">Variables a testar ({varsNormalidad.length} seleccionadas)</p>
              <div className="flex flex-wrap gap-1.5">
                {numericCols.map((c) => (
                  <button key={c.nombre} onClick={() => setVarsNormalidad((p) => p.includes(c.nombre) ? p.filter((x) => x !== c.nombre) : [...p, c.nombre])}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      varsNormalidad.includes(c.nombre) ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'text-slate-400 border-[var(--color-border)] hover:text-slate-200 hover:border-slate-500'
                    }`}>
                    {c.nombre}
                  </button>
                ))}
              </div>
            </div>
          ) : testActivo === 'friedman' ? (
            <div>
              <p className="text-xs text-slate-500 mb-2">Variables / mediciones ({varsFriedman.length} seleccionadas, mín. 3)</p>
              <div className="flex flex-wrap gap-1.5">
                {numericCols.map((c) => (
                  <button key={c.nombre} onClick={() => setVarsFriedman((p) => p.includes(c.nombre) ? p.filter((x) => x !== c.nombre) : [...p, c.nombre])}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      varsFriedman.includes(c.nombre) ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'text-slate-400 border-[var(--color-border)] hover:text-slate-200 hover:border-slate-500'
                    }`}>
                    {c.nombre}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 max-w-2xl">
              <InputFields
                testActivo={testActivo}
                numericCols={numericCols}
                allCols={allCols}
                varPrincipal={varPrincipal} setVarPrincipal={setVarPrincipal}
                varSecundaria={varSecundaria} setVarSecundaria={setVarSecundaria}
                varGrupo={varGrupo} setVarGrupo={setVarGrupo}
                valorRef={valorRef} setValorRef={setValorRef}
                igualdadVarianzas={igualdadVarianzas} setIgualdadVarianzas={setIgualdadVarianzas}
              />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Placeholder */}
        {!resultado && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <FlaskConical size={36} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Configura los parámetros y haz clic en Calcular</p>
          </div>
        )}

        {/* Resultados */}
        {resultado && (
          <div className="p-5 space-y-4">
            {resultado.tipo === 'Tests de normalidad'
              ? <ResultadoNormalidad resultado={resultado} />
              : resultado.test === 'Wilcoxon de rangos con signo'
                ? <ResultadoWilcoxon resultado={resultado} />
                : resultado.test === 'Prueba exacta de Fisher'
                  ? <ResultadoFisher resultado={resultado} />
                  : resultado.test === 'Friedman'
                    ? <ResultadoFriedman resultado={resultado} />
                    : resultado.test === 'Test binomial'
                      ? <ResultadoBinomial resultado={resultado} />
                      : resultado.test === 'Test de rachas (Wald-Wolfowitz)'
                        ? <ResultadoRachas resultado={resultado} />
                        : <ResultadoPanel resultado={resultado} alpha={alpha} />}
          </div>
        )}
      </div>

      {/* Panel IA */}
      {(interpretacionIA || interpretandoIA || errorIA) && (
        <aside className="w-72 flex-shrink-0 border-l border-[var(--color-border)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2 text-amber-400">
              <Sparkles size={14} />
              <span className="text-xs font-semibold">Interpretación IA</span>
            </div>
            <button onClick={() => { setInterpretacionIA(null); setErrorIA(null); setInterpretandoIA(false) }} className="btn-ghost p-1">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {interpretandoIA && <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 size={14} className="animate-spin" /> Analizando...</div>}
            {errorIA && <p className="text-red-400 text-xs">{errorIA}</p>}
            {interpretacionIA && <p className="text-slate-300 text-sm leading-relaxed">{interpretacionIA}</p>}
          </div>
        </aside>
      )}
    </div>
  )
}

// ─── Subcomponente: campos de entrada por test ─────────────────────────────

function InputFields({
  testActivo, numericCols, allCols,
  varPrincipal, setVarPrincipal,
  varSecundaria, setVarSecundaria,
  varGrupo, setVarGrupo,
  valorRef, setValorRef,
  igualdadVarianzas, setIgualdadVarianzas,
}) {
  const numOpts = numericCols.map((c) => c.nombre)
  const allOpts = allCols.map((c) => c.nombre)

  switch (testActivo) {
    case 't-una-muestra':
      return (<>
        <VarSelect label="Variable numérica" value={varPrincipal} onChange={setVarPrincipal} options={numOpts} />
        <div>
          <label className="text-xs text-slate-500 block mb-1.5">Valor de referencia (μ₀)</label>
          <input
            type="number"
            step="any"
            value={valorRef}
            onChange={(e) => setValorRef(e.target.value)}
            placeholder="ej. 0"
            className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500"
          />
        </div>
      </>)

    case 't-independientes':
      return (<>
        <VarSelect label="Variable numérica" value={varPrincipal} onChange={setVarPrincipal} options={numOpts} />
        <VarSelect label="Variable de grupo (2 categorías)" value={varGrupo} onChange={setVarGrupo} options={allOpts} />
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={igualdadVarianzas}
              onChange={(e) => setIgualdadVarianzas(e.target.checked)}
              className="accent-blue-500"
            />
            Asumir igualdad de varianzas (Student) — desmarcar para usar corrección de Welch
          </label>
        </div>
      </>)

    case 't-relacionadas':
      return (<>
        <VarSelect label="Variable 1" value={varPrincipal} onChange={setVarPrincipal} options={numOpts} />
        <VarSelect label="Variable 2" value={varSecundaria} onChange={setVarSecundaria} options={numOpts.filter((n) => n !== varPrincipal)} />
      </>)

    case 'chi-cuadrado':
      return (<>
        <VarSelect label="Variable 1 (categórica)" value={varPrincipal} onChange={setVarPrincipal} options={allOpts} />
        <VarSelect label="Variable 2 (categórica)" value={varSecundaria} onChange={setVarSecundaria} options={allOpts.filter((n) => n !== varPrincipal)} />
      </>)

    case 'mann-whitney':
      return (<>
        <VarSelect label="Variable numérica" value={varPrincipal} onChange={setVarPrincipal} options={numOpts} />
        <VarSelect label="Variable de grupo (2 categorías)" value={varGrupo} onChange={setVarGrupo} options={allOpts} />
      </>)

    case 'kruskal-wallis':
      return (<>
        <VarSelect label="Variable numérica" value={varPrincipal} onChange={setVarPrincipal} options={numOpts} />
        <VarSelect label="Variable de grupo (2+ categorías)" value={varGrupo} onChange={setVarGrupo} options={allOpts} />
      </>)

    case 'wilcoxon':
      return (<>
        <VarSelect label="Variable 1" value={varPrincipal} onChange={setVarPrincipal} options={numOpts} />
        <VarSelect
          label="Variable 2 (opcional — omitir = 1 muestra)"
          value={varSecundaria}
          onChange={setVarSecundaria}
          options={['', ...numOpts.filter((n) => n !== varPrincipal)]}
        />
        {!varSecundaria && (
          <div>
            <label className="text-xs text-slate-500 block mb-1.5">Mediana de referencia (H₀)</label>
            <input
              type="number" step="any" value={valorRef}
              onChange={(e) => setValorRef(e.target.value)}
              placeholder="0"
              className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500"
            />
          </div>
        )}
      </>)

    case 'fisher':
      return (<>
        <VarSelect label="Variable 1 (categórica, 2 niveles)" value={varPrincipal} onChange={setVarPrincipal} options={allOpts} />
        <VarSelect label="Variable 2 (categórica, 2 niveles)" value={varSecundaria} onChange={setVarSecundaria} options={allOpts.filter((n) => n !== varPrincipal)} />
      </>)

    case 'binomial':
      return (<>
        <VarSelect label="Variable (2 categorías)" value={varPrincipal} onChange={setVarPrincipal} options={allOpts} />
        <div>
          <label className="text-xs text-slate-500 block mb-1.5">Categoría de éxito (opcional)</label>
          <input type="text" value={categoriaExito} onChange={(e) => setCategoriaExito(e.target.value)}
            placeholder="primer valor si se omite"
            className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1.5">Proporción esperada (H₀)</label>
          <input type="number" step="0.01" min="0.01" max="0.99" value={pEsperada} onChange={(e) => setPEsperada(e.target.value)}
            className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" />
        </div>
      </>)

    case 'rachas':
      return (<>
        <VarSelect label="Variable numérica" value={varPrincipal} onChange={setVarPrincipal} options={numOpts} />
        <div>
          <label className="text-xs text-slate-500 block mb-1.5">Punto de corte (vacío = mediana)</label>
          <input type="number" step="any" value={puntoCortRachas} onChange={(e) => setPuntoCortRachas(e.target.value)}
            placeholder="mediana automática"
            className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" />
        </div>
      </>)

    default:
      return null
  }
}

// ─── Subcomponente: panel de resultados ────────────────────────────────────

function ResultadoPanel({ resultado, alpha }) {
  const sig = resultado.significativo
  const p = resultado.p_value

  return (
    <div className="space-y-4">
      {/* Veredicto */}
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${
        sig ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-500/5 border-slate-600/20'
      }`}>
        {sig
          ? <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          : <Info size={20} className="text-slate-400 flex-shrink-0 mt-0.5" />}
        <div>
          <p className={`font-semibold text-sm ${sig ? 'text-emerald-300' : 'text-slate-300'}`}>
            {sig ? 'Diferencia estadísticamente significativa' : 'Sin significación estadística'}
          </p>
          <p className="text-slate-500 text-xs mt-0.5 capitalize">{resultado.interpretacion}</p>
        </div>
      </div>

      {/* Estadísticos principales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {/* Estadístico principal */}
        {resultado.t !== undefined && <StatCard label="t" value={resultado.t} />}
        {resultado.chi2 !== undefined && <StatCard label="χ²" value={resultado.chi2} />}
        {resultado.u !== undefined && <StatCard label="U" value={resultado.u} />}
        {resultado.h !== undefined && <StatCard label="H" value={resultado.h} />}

        {resultado.gl !== undefined && resultado.gl !== null && <StatCard label="g.l." value={resultado.gl} />}
        <StatCard
          label="p-valor"
          value={p < 0.001 ? '< 0.001' : p?.toFixed(4)}
          highlight={sig ? 'green' : 'default'}
        />
        {resultado.n !== undefined && !Array.isArray(resultado.n) && <StatCard label="n" value={resultado.n} />}

        {/* Tamaño del efecto */}
        {resultado.cohen_d !== undefined && (
          <StatCard
            label="d de Cohen"
            value={resultado.cohen_d}
            badge={resultado.magnitud_efecto}
          />
        )}
        {resultado.cramer_v !== undefined && (
          <StatCard label="V de Cramér" value={resultado.cramer_v} badge={resultado.magnitud_efecto} />
        )}
        {resultado.r_efecto !== undefined && (
          <StatCard label="r (efecto)" value={resultado.r_efecto} badge={resultado.magnitud_efecto} />
        )}
        {resultado.eta2 !== undefined && (
          <StatCard label="η²" value={resultado.eta2} badge={resultado.magnitud_efecto} />
        )}
      </div>

      {/* Detalle por test */}
      <DetalleTest resultado={resultado} />

      {/* Advertencia chi-cuadrado celdas esperadas */}
      {resultado.advertencia_esperados && (
        <div className="flex items-start gap-2 text-xs text-amber-400 p-3 bg-amber-400/5 border border-amber-400/20 rounded-lg">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            El {resultado.pct_celdas_esperadas_bajas}% de las celdas tiene frecuencias esperadas &lt; 5.
            Los resultados del chi-cuadrado pueden no ser fiables. Considera agrupar categorías.
          </span>
        </div>
      )}

      {/* Nota Levene */}
      {resultado.levene_p !== undefined && (
        <div className="flex items-start gap-2 text-xs text-slate-500 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            Test de Levene: F = {resultado.levene_stat}, p = {resultado.levene_p?.toFixed(4)} →{' '}
            {resultado.varianzas_iguales ? 'no se rechaza igualdad de varianzas' : 'varianzas significativamente distintas — considera usar corrección de Welch'}.
          </span>
        </div>
      )}
    </div>
  )
}

function DetalleTest({ resultado }) {
  // t independientes / Mann-Whitney: dos grupos
  if ((resultado.categorias && resultado.medias) || resultado.medianas) {
    const cats = resultado.categorias
    const vals1 = resultado.medias ?? resultado.medianas
    const label = resultado.medias ? 'Media' : 'Mediana'
    return (
      <div className="card overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Grupo</th>
              <th className="px-4 py-2.5 text-right text-slate-400">n</th>
              <th className="px-4 py-2.5 text-right text-slate-400">{label}</th>
              {resultado.desv_tipicas && <th className="px-4 py-2.5 text-right text-slate-400">Desv. típica</th>}
            </tr>
          </thead>
          <tbody>
            {cats.map((cat, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{cat}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{resultado.n?.[i]}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{vals1[i]?.toFixed(4)}</td>
                {resultado.desv_tipicas && (
                  <td className="px-4 py-2 text-right stat-value text-slate-400">{resultado.desv_tipicas[i]?.toFixed(4)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // t una muestra: media e IC
  if (resultado.media !== undefined && resultado.ic_media_low !== undefined) {
    return (
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Media observada" value={resultado.media} />
        <StatCard label="Valor referencia" value={resultado.valor_referencia} />
        <StatCard label={`IC ${Math.round((1 - resultado.alpha) * 100)}%`}
          value={`[${resultado.ic_media_low}, ${resultado.ic_media_high}]`} />
      </div>
    )
  }

  // t relacionadas
  if (resultado.media_diferencia !== undefined) {
    return (
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={resultado.variable_1} value={resultado.media_1} />
        <StatCard label={resultado.variable_2} value={resultado.media_2} />
        <StatCard label="Diferencia media" value={resultado.media_diferencia} />
      </div>
    )
  }

  // Chi-cuadrado: tabla de contingencia
  if (resultado.tabla_contingencia) {
    const { index, columns, values } = resultado.tabla_contingencia
    return (
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Tabla de contingencia</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-3 py-2 text-left text-slate-400">{resultado.variable_1} \ {resultado.variable_2}</th>
              {columns.map((c) => <th key={c} className="px-3 py-2 text-right text-slate-400">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {index.map((row, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-3 py-2 text-slate-300 font-medium">{row}</td>
                {values[i].map((v, j) => (
                  <td key={j} className="px-3 py-2 text-right stat-value text-slate-300">{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // Kruskal-Wallis: tabla de grupos
  if (resultado.grupos) {
    return (
      <div className="card overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Grupo</th>
              <th className="px-4 py-2.5 text-right text-slate-400">n</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Mediana</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Media</th>
            </tr>
          </thead>
          <tbody>
            {resultado.grupos.map((g, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{g.grupo}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{g.n}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{g.mediana}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{g.media}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return null
}

// ─── Utilidades UI ────────────────────────────────────────────────────────

function StatCard({ label, value, highlight = 'default', badge }) {
  const valColor = highlight === 'green' ? 'text-emerald-400' : 'text-slate-200'
  return (
    <div className="card p-3 space-y-1">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`stat-value font-bold text-base ${valColor}`}>{value}</p>
      {badge && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${MAGNITUD_STYLE[badge] ?? 'text-slate-400 bg-slate-400/10'}`}>
          {badge}
        </span>
      )}
    </div>
  )
}

function VarSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500"
      >
        <option value="">— Seleccionar —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

// ─── Wilcoxon ─────────────────────────────────────────────────────────────────
function ResultadoWilcoxon({ resultado }) {
  const sig = resultado.significativo
  return (
    <div className="space-y-4">
      <Veredicto sig={sig} interpretacion={resultado.interpretacion} subtitulo={resultado.label} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="W" value={resultado.w} />
        <StatCard label="Z (aprox.)" value={resultado.z_aprox} />
        <StatCard label="p-valor" value={resultado.p_value < 0.001 ? '< 0.001' : resultado.p_value} highlight={sig ? 'green' : 'default'} />
        <StatCard label="r (efecto)" value={resultado.r_efecto} badge={resultado.magnitud_efecto} />
        <StatCard label="n pares" value={resultado.n_pares} />
        <StatCard label="n efectivo" value={resultado.n_efectivo} />
        <StatCard label="Mediana diferencia" value={resultado.mediana_diferencia} />
        {resultado.n_excluidos_cero > 0 && <StatCard label="Excluidos (dif=0)" value={resultado.n_excluidos_cero} />}
      </div>
      {resultado.n_excluidos_cero > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-400 p-3 bg-amber-400/5 border border-amber-400/20 rounded-lg">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
          {resultado.n_excluidos_cero} par(es) con diferencia = 0 excluidos del análisis (protocolo Wilcoxon estándar).
        </div>
      )}
    </div>
  )
}

// ─── Fisher exacto ────────────────────────────────────────────────────────────
function ResultadoFisher({ resultado }) {
  const sig = resultado.significativo
  const { tabla_contingencia: tc } = resultado
  return (
    <div className="space-y-4">
      <Veredicto sig={sig} interpretacion={resultado.interpretacion} subtitulo={`${resultado.variable_1} × ${resultado.variable_2}`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="p-valor (Fisher)" value={resultado.p_value < 0.001 ? '< 0.001' : resultado.p_value} highlight={sig ? 'green' : 'default'} />
        <StatCard label="Odds Ratio" value={resultado.odds_ratio ?? 'Inf'} />
        {resultado.or_ic_low && <StatCard label={`IC ${Math.round((1-resultado.alpha)*100)}% OR`} value={`[${resultado.or_ic_low}, ${resultado.or_ic_high}]`} />}
        <StatCard label="χ² (referencia)" value={resultado.chi2_referencia} />
        <StatCard label="p (chi²)" value={resultado.chi2_p < 0.001 ? '< 0.001' : resultado.chi2_p} />
        <StatCard label="n" value={resultado.n} />
      </div>
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Tabla de contingencia 2×2</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-3 py-2 text-left text-slate-400">{resultado.variable_1} \ {resultado.variable_2}</th>
              {tc.columns.map((c) => <th key={c} className="px-3 py-2 text-right text-slate-400">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {tc.index.map((row, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-3 py-2 text-slate-300 font-medium">{row}</td>
                {tc.values[i].map((v, j) => <td key={j} className="px-3 py-2 text-right stat-value text-slate-200">{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-start gap-2 text-xs text-slate-500 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        {resultado.nota}
      </div>
    </div>
  )
}

// ─── Friedman ─────────────────────────────────────────────────────────────────
function ResultadoFriedman({ resultado }) {
  const sig = resultado.significativo
  return (
    <div className="space-y-4">
      <Veredicto sig={sig} interpretacion={resultado.interpretacion} subtitulo={`${resultado.k} variables · ${resultado.n} sujetos`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="χ² de Friedman" value={resultado.chi2} />
        <StatCard label="g.l." value={resultado.gl} />
        <StatCard label="p-valor" value={resultado.p_value < 0.001 ? '< 0.001' : resultado.p_value} highlight={sig ? 'green' : 'default'} />
        <StatCard label="W de Kendall" value={resultado.w_kendall} />
      </div>
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Estadísticos por variable</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Variable</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Mediana</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Media</th>
            </tr>
          </thead>
          <tbody>
            {resultado.medianas.map((m, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{m.variable}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{m.mediana}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{m.media}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resultado.posthoc_wilcoxon_bonferroni?.length > 0 && (
        <div className="card overflow-auto">
          <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Post-hoc: Wilcoxon por pares (corrección Bonferroni)</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
                <th className="px-4 py-2.5 text-left text-slate-400">Var 1</th>
                <th className="px-4 py-2.5 text-left text-slate-400">Var 2</th>
                <th className="px-4 py-2.5 text-right text-slate-400">W</th>
                <th className="px-4 py-2.5 text-right text-slate-400">p</th>
                <th className="px-4 py-2.5 text-right text-slate-400">p (Bonferroni)</th>
              </tr>
            </thead>
            <tbody>
              {resultado.posthoc_wilcoxon_bonferroni.map((c, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-slate-300">{c.var_1}</td>
                  <td className="px-4 py-2 text-slate-300">{c.var_2}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-400">{c.w}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-500">{c.p_value < 0.001 ? '< 0.001' : c.p_value}</td>
                  <td className={`px-4 py-2 text-right stat-value ${c.significativo ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {c.p_bonferroni < 0.001 ? '< 0.001' : c.p_bonferroni}{c.significativo && ' *'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Binomial ─────────────────────────────────────────────────────────────────
function ResultadoBinomial({ resultado }) {
  const sig = resultado.significativo
  return (
    <div className="space-y-4">
      <Veredicto sig={sig} interpretacion={resultado.interpretacion}
        subtitulo={`Éxito = "${resultado.categoria_exito}" · p₀ = ${resultado.p_esperada}`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="p observada" value={resultado.p_observada} />
        <StatCard label="p esperada (H₀)" value={resultado.p_esperada} />
        <StatCard label="p-valor" value={resultado.p_value < 0.001 ? '< 0.001' : resultado.p_value} highlight={sig ? 'green' : 'default'} />
        <StatCard label="n" value={resultado.n} />
        <StatCard label="n éxitos" value={resultado.n_exito} />
        <StatCard label="n fracasos" value={resultado.n_fracaso} />
        <StatCard label={`IC ${Math.round((1-resultado.alpha)*100)}% (Clopper-Pearson)`}
          value={`[${resultado.ic_clopper_pearson_low}, ${resultado.ic_clopper_pearson_high}]`} />
      </div>
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Frecuencias observadas vs. esperadas</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Categoría</th>
              <th className="px-4 py-2.5 text-right text-slate-400">n observado</th>
              <th className="px-4 py-2.5 text-right text-slate-400">n esperado</th>
              <th className="px-4 py-2.5 text-right text-slate-400">p observada</th>
              <th className="px-4 py-2.5 text-right text-slate-400">p esperada</th>
            </tr>
          </thead>
          <tbody>
            {resultado.frecuencias.map((f, i) => (
              <tr key={i} className={`border-b border-[var(--color-border)] last:border-0 ${f.exito ? 'bg-blue-500/5' : ''}`}>
                <td className="px-4 py-2 text-slate-300 font-medium">
                  {f.categoria} {f.exito && <span className="text-[10px] text-blue-400 ml-1">(éxito)</span>}
                </td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{f.n_observado}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{f.n_esperado}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{f.p_observada}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{f.p_esperada}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Rachas ───────────────────────────────────────────────────────────────────
function ResultadoRachas({ resultado }) {
  const sig = resultado.significativo
  return (
    <div className="space-y-4">
      <Veredicto sig={sig} interpretacion={resultado.aleatoriedad}
        subtitulo={`Punto de corte = ${resultado.punto_corte}`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Rachas observadas" value={resultado.n_rachas} />
        <StatCard label="Rachas esperadas" value={resultado.media_rachas_esperada} />
        <StatCard label="Z" value={resultado.z} />
        <StatCard label="p-valor" value={resultado.p_value < 0.001 ? '< 0.001' : resultado.p_value} highlight={sig ? 'red' : 'green'} />
        <StatCard label="n total" value={resultado.n} />
        <StatCard label="n > corte" value={resultado.n_mayor_corte} />
        <StatCard label="n ≤ corte" value={resultado.n_menor_igual_corte} />
      </div>
      <div className="flex items-start gap-2 text-xs text-slate-500 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        {resultado.nota}
      </div>
    </div>
  )
}

// ─── Helper compartido: veredicto banner ─────────────────────────────────────
function Veredicto({ sig, interpretacion, subtitulo }) {
  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${sig ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-500/5 border-slate-600/20'}`}>
      {sig ? <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" /> : <Info size={20} className="text-slate-400 flex-shrink-0 mt-0.5" />}
      <div>
        <p className={`font-semibold text-sm ${sig ? 'text-emerald-300' : 'text-slate-300'}`}>
          {sig ? 'Resultado estadísticamente significativo' : 'Sin significación estadística'}
        </p>
        <p className="text-slate-500 text-xs mt-0.5 capitalize">{interpretacion}{subtitulo ? ` · ${subtitulo}` : ''}</p>
      </div>
    </div>
  )
}

function ResultadoNormalidad({ resultado }) {
  return (
    <div className="space-y-3">
      {resultado.resultados.map((r, i) => {
        if (r.error) return (
          <div key={i} className="card p-3 text-xs text-red-400">{r.variable}: {r.error}</div>
        )
        const sw = r.shapiro_wilk
        const ks = r.kolmogorov_smirnov
        const normal = r.veredicto === 'normal'
        return (
          <div key={i} className={`card overflow-hidden border ${normal ? 'border-emerald-500/20' : 'border-red-500/20'}`}>
            <div className={`flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] ${normal ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}>
              <div className="flex items-center gap-2">
                {normal
                  ? <CheckCircle2 size={15} className="text-emerald-400" />
                  : <AlertCircle size={15} className="text-red-400" />}
                <span className="font-semibold text-sm text-slate-200">{r.variable}</span>
                <span className="text-xs text-slate-500">n = {r.n}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${normal ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
                {normal ? 'distribución normal' : 'no normal'}
              </span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-4">
              {sw && !sw.nota && (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Shapiro-Wilk</p>
                  <div className="space-y-1">
                    <Row label="W" value={sw.estadistico} />
                    <Row label="p-valor" value={sw.p_value < 0.001 ? '< 0.001' : sw.p_value} highlight={sw.normal ? 'green' : 'red'} />
                    <Row label="Resultado" value={sw.interpretacion} />
                  </div>
                </div>
              )}
              {ks && !ks.nota && !ks.error && (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Kolmogorov-Smirnov</p>
                  <div className="space-y-1">
                    <Row label="D" value={ks.estadistico} />
                    <Row label="p-valor" value={ks.p_value < 0.001 ? '< 0.001' : ks.p_value} highlight={ks.normal ? 'green' : 'red'} />
                    <Row label="Resultado" value={ks.interpretacion} />
                  </div>
                </div>
              )}
              {r.asimetria && (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Asimetría</p>
                  <div className="space-y-1">
                    <Row label="Valor" value={r.asimetria.valor} />
                    <Row label="Error std." value={r.asimetria.error_estandar} />
                    <Row label="Z" value={r.asimetria.z} highlight={r.asimetria.normal ? 'green' : 'red'} />
                  </div>
                </div>
              )}
              {r.curtosis && (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Curtosis</p>
                  <div className="space-y-1">
                    <Row label="Valor" value={r.curtosis.valor} />
                    <Row label="Error std." value={r.curtosis.error_estandar} />
                    <Row label="Z" value={r.curtosis.z} highlight={r.curtosis.normal ? 'green' : 'red'} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Row({ label, value, highlight }) {
  const color = highlight === 'green' ? 'text-emerald-400' : highlight === 'red' ? 'text-red-400' : 'text-slate-200'
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`stat-value ${color}`}>{value}</span>
    </div>
  )
}

function SelectField({ label, value, onChange, children }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-1.5">{label}</p>
      <select
        value={value}
        onChange={onChange}
        className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500"
      >
        {children}
      </select>
    </div>
  )
}
