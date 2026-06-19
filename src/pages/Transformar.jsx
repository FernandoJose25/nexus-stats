import { useState, useEffect } from 'react'
import {
  Calculator, RefreshCw, Filter, ArrowUpDown, Award,
  Replace, Layers, Shuffle, SplitSquareHorizontal, Scale,
  Undo2, History, ChevronRight, Plus, Trash2, AlertCircle, CheckCircle2,
} from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import {
  transformarCalcular, transformarRecodificar, transformarFiltrar,
  transformarOrdenar, transformarRanking, transformarReemplazarPerdidos,
  transformarAgregar, transformarReestructurar, transformarDeshacer,
  transformarHistorial, transformarPartirArchivo, transformarDesactivarParticion,
  transformarPonderar, transformarEstado,
} from '../services/pythonApi'

const TABS = [
  { id: 'calcular',   label: 'Calcular variable',     icon: Calculator },
  { id: 'recodificar',label: 'Recodificar',            icon: RefreshCw },
  { id: 'filtrar',    label: 'Filtrar casos',          icon: Filter },
  { id: 'ordenar',    label: 'Ordenar datos',          icon: ArrowUpDown },
  { id: 'ranking',    label: 'Ranking',                icon: Award },
  { id: 'perdidos',   label: 'Reemplazar perdidos',    icon: Replace },
  { id: 'agregar',    label: 'Agregar datos',          icon: Layers },
  { id: 'reestructurar', label: 'Reestructurar',       icon: Shuffle },
  { id: 'partir',     label: 'Partir archivo',         icon: SplitSquareHorizontal },
  { id: 'ponderar',   label: 'Ponderar casos',         icon: Scale },
]

export default function Transformar() {
  const [tab, setTab] = useState('calcular')
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [historial, setHistorial] = useState([])
  const [estado, setEstado] = useState(null)

  const { metadata, setMetadata, setRows } = useDataStore()

  useEffect(() => {
    cargarEstado()
  }, [])

  async function cargarEstado() {
    try {
      const est = await transformarEstado()
      setEstado(est)
      setHistorial(est.historial || [])
    } catch (_) {}
  }

  async function ejecutar(fn, params) {
    setError(null)
    setResultado(null)
    setCargando(true)
    try {
      const res = await fn(params)
      setResultado(res)
      if (res.metadata) setMetadata(res.metadata)
      await cargarEstado()
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  async function handleDeshacer() {
    setCargando(true)
    setError(null)
    try {
      const res = await transformarDeshacer({ pasos: 1 })
      if (res.metadata) setMetadata(res.metadata)
      setResultado({ ok: true, accion: res.mensaje })
      await cargarEstado()
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  const cols = metadata?.column_info ?? []
  const numericas = cols.filter(c => c.tipo === 'numerico').map(c => c.nombre)

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar de tabs */}
      <div className="w-52 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col" style={{ background: 'var(--color-surface)' }}>
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-slate-200">Transformar</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Menú Transform de SPSS</p>
        </div>
        <nav className="flex-1 p-1.5 space-y-0.5 overflow-y-auto">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setResultado(null); setError(null) }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-left transition-colors
                  ${tab === t.id ? 'bg-blue-500/15 text-blue-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
              >
                <Icon size={14} className="flex-shrink-0" />
                <span>{t.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Historial + Deshacer */}
        <div className="p-2 border-t border-[var(--color-border)]">
          <button
            onClick={handleDeshacer}
            disabled={!historial.length || cargando}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 disabled:opacity-40 transition-colors"
          >
            <Undo2 size={14} />
            <span>Deshacer ({historial.length})</span>
          </button>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!metadata ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <AlertCircle size={32} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">Carga un dataset primero desde el Editor de datos</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            <TabContent
              tab={tab}
              cols={cols}
              numericas={numericas}
              ejecutar={ejecutar}
              cargando={cargando}
              estado={estado}
            />

            {/* Feedback */}
            {error && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {resultado?.ok && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
                <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{resultado.accion || 'Transformación aplicada'}</p>
                  {resultado.filas_antes !== undefined && (
                    <p className="text-emerald-500/70 mt-0.5">
                      Filas: {resultado.filas_antes} → {resultado.filas_despues}
                      {' '}({resultado.filas_afectadas > 0 ? `-${resultado.filas_afectadas}` : `+${resultado.filas_despues - resultado.filas_antes}`})
                    </p>
                  )}
                  {resultado.n_recodificados !== undefined && (
                    <p className="text-emerald-500/70 mt-0.5">{resultado.n_recodificados} valores recodificados</p>
                  )}
                  {resultado.preview && (
                    <p className="text-emerald-500/70 mt-0.5">Preview: [{resultado.preview.slice(0, 5).join(', ')}...]</p>
                  )}
                </div>
              </div>
            )}

            {/* Historial */}
            {historial.length > 0 && (
              <div className="mt-5">
                <div className="flex items-center gap-2 mb-2">
                  <History size={13} className="text-slate-500" />
                  <span className="text-xs text-slate-500 font-medium">Historial de transformaciones</span>
                </div>
                <div className="space-y-1">
                  {historial.map(h => (
                    <div key={h.paso} className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="text-slate-700 w-5 text-right">{h.paso}.</span>
                      <span className="font-mono text-slate-400">{h.descripcion}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


function TabContent({ tab, cols, numericas, ejecutar, cargando, estado }) {
  switch (tab) {
    case 'calcular':    return <TabCalcular cols={cols} ejecutar={ejecutar} cargando={cargando} />
    case 'recodificar': return <TabRecodificar cols={cols} ejecutar={ejecutar} cargando={cargando} />
    case 'filtrar':     return <TabFiltrar cols={cols} ejecutar={ejecutar} cargando={cargando} />
    case 'ordenar':     return <TabOrdenar cols={cols} ejecutar={ejecutar} cargando={cargando} />
    case 'ranking':     return <TabRanking cols={cols} numericas={numericas} ejecutar={ejecutar} cargando={cargando} />
    case 'perdidos':    return <TabPerdidos cols={cols} numericas={numericas} ejecutar={ejecutar} cargando={cargando} />
    case 'agregar':     return <TabAgregar cols={cols} numericas={numericas} ejecutar={ejecutar} cargando={cargando} />
    case 'reestructurar': return <TabReestructurar cols={cols} ejecutar={ejecutar} cargando={cargando} />
    case 'partir':      return <TabPartir cols={cols} ejecutar={ejecutar} cargando={cargando} estado={estado} />
    case 'ponderar':    return <TabPonderar cols={cols} numericas={numericas} ejecutar={ejecutar} cargando={cargando} estado={estado} />
    default: return null
  }
}


// ─── Tab: Calcular variable ───────────────────────────────────────────────────

function TabCalcular({ cols, ejecutar, cargando }) {
  const [nombre, setNombre] = useState('')
  const [expr, setExpr] = useState('')

  const FUNCIONES = [
    ['abs(x)', 'Valor absoluto'],
    ['sqrt(x)', 'Raíz cuadrada'],
    ['log(x)', 'Logaritmo natural'],
    ['log10(x)', 'Logaritmo base 10'],
    ['exp(x)', 'Exponencial'],
    ['round(x, 2)', 'Redondear'],
    ['np.where(cond, a, b)', 'Si… entonces'],
  ]

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Calcular variable</h3>
        <p className="text-xs text-slate-500">Crea o modifica una variable usando una expresión matemática. Equivale a COMPUTE en SPSS.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Nombre de la variable destino</label>
          <input
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="ej: ingreso_log"
            className="input w-full"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Variable a insertar</label>
          <select className="input w-full" onChange={e => setExpr(prev => prev + e.target.value)}>
            <option value="">— insertar variable —</option>
            {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">Expresión</label>
        <textarea
          value={expr}
          onChange={e => setExpr(e.target.value)}
          placeholder="ej: edad * 2   |   log(ingreso)   |   np.where(edad >= 18, 1, 0)"
          rows={3}
          className="input w-full font-mono text-xs resize-none"
        />
      </div>

      <div>
        <p className="text-xs text-slate-500 mb-1.5">Funciones disponibles:</p>
        <div className="flex flex-wrap gap-1.5">
          {FUNCIONES.map(([fn, desc]) => (
            <button
              key={fn}
              title={desc}
              onClick={() => setExpr(prev => prev ? `${prev} ${fn}` : fn)}
              className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-blue-300 text-[11px] font-mono border border-slate-700 hover:border-blue-500/40 transition-colors"
            >
              {fn}
            </button>
          ))}
        </div>
      </div>

      <button
        disabled={!nombre || !expr || cargando}
        onClick={() => ejecutar(transformarCalcular, { nombre_variable: nombre, expresion: expr })}
        className="btn-primary"
      >
        {cargando ? 'Calculando…' : 'Calcular'}
      </button>
    </div>
  )
}


// ─── Tab: Recodificar ────────────────────────────────────────────────────────

function TabRecodificar({ cols, ejecutar, cargando }) {
  const [varOrigen, setVarOrigen] = useState('')
  const [varDestino, setVarDestino] = useState('')
  const [tipoSalida, setTipoSalida] = useState('numerico')
  const [reglas, setReglas] = useState([{ de: '', a: '' }])

  function addRegla() { setReglas(r => [...r, { de: '', a: '' }]) }
  function removeRegla(i) { setReglas(r => r.filter((_, idx) => idx !== i)) }
  function updateRegla(i, field, val) {
    setReglas(r => r.map((rule, idx) => idx === i ? { ...rule, [field]: val } : rule))
  }

  function handleEjecutar() {
    const mapeo = reglas
      .filter(r => r.de !== '' || r.a !== '')
      .map(r => {
        let de = r.de
        if (de !== 'MISSING' && de !== '') {
          const n = Number(de)
          de = isNaN(n) ? de : n
        } else if (de === '') {
          de = null
        }
        const a = r.a === '' ? null : (isNaN(Number(r.a)) ? r.a : Number(r.a))
        return { de, a }
      })
    ejecutar(transformarRecodificar, {
      variable_origen: varOrigen,
      variable_destino: varDestino || varOrigen,
      mapeo,
      tipo_salida: tipoSalida,
    })
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Recodificar variable</h3>
        <p className="text-xs text-slate-500">Asigna nuevos valores a categorías o rangos. Equivale a RECODE en SPSS.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Variable origen</label>
          <select value={varOrigen} onChange={e => { setVarOrigen(e.target.value); setVarDestino(e.target.value) }} className="input w-full">
            <option value="">— seleccionar —</option>
            {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Variable destino (nueva o misma)</label>
          <input value={varDestino} onChange={e => setVarDestino(e.target.value)} placeholder="nombre_variable" className="input w-full" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">Tipo de salida</label>
        <select value={tipoSalida} onChange={e => setTipoSalida(e.target.value)} className="input w-44">
          <option value="numerico">Numérico</option>
          <option value="cadena">Cadena (texto)</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-slate-400 font-medium">Reglas de recodificación</label>
          <button onClick={addRegla} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
            <Plus size={12} /> Añadir regla
          </button>
        </div>
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_24px_1fr_32px] gap-2 text-[11px] text-slate-500 mb-1">
            <span>Valor original (o MISSING)</span>
            <span></span>
            <span>Nuevo valor</span>
            <span></span>
          </div>
          {reglas.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_24px_1fr_32px] gap-2 items-center">
              <input
                value={r.de}
                onChange={e => updateRegla(i, 'de', e.target.value)}
                placeholder="valor / MISSING"
                className="input text-xs"
              />
              <ChevronRight size={14} className="text-slate-600 justify-self-center" />
              <input
                value={r.a}
                onChange={e => updateRegla(i, 'a', e.target.value)}
                placeholder="nuevo valor"
                className="input text-xs"
              />
              <button onClick={() => removeRegla(i)} className="text-slate-600 hover:text-red-400 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-600 mt-1.5">Para rangos usa formato: min-max (ej: 0-18). Los valores no mapeados se conservan.</p>
      </div>

      <button disabled={!varOrigen || cargando} onClick={handleEjecutar} className="btn-primary">
        {cargando ? 'Recodificando…' : 'Recodificar'}
      </button>
    </div>
  )
}


// ─── Tab: Filtrar casos ───────────────────────────────────────────────────────

function TabFiltrar({ cols, ejecutar, cargando }) {
  const [condicion, setCondicion] = useState('')
  const [modo, setModo] = useState('seleccionar')

  const EJEMPLOS = [
    'edad > 18',
    "sexo == 'M'",
    'ingreso >= 1000 and ingreso <= 5000',
    'notna(puntuacion)',
    'edad > 18 and educacion != "primaria"',
  ]

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Filtrar casos</h3>
        <p className="text-xs text-slate-500">Selecciona o elimina filas según una condición. Equivale a SELECT IF en SPSS.</p>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">Modo</label>
        <div className="flex gap-3">
          {[['seleccionar', 'Mantener los que cumplen'], ['eliminar', 'Eliminar los que cumplen']].map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={v} checked={modo === v} onChange={() => setModo(v)} className="accent-blue-500" />
              <span className="text-xs text-slate-300">{l}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">Condición</label>
        <textarea
          value={condicion}
          onChange={e => setCondicion(e.target.value)}
          placeholder="ej: edad > 18 and sexo == 'M'"
          rows={3}
          className="input w-full font-mono text-xs resize-none"
        />
      </div>

      <div>
        <p className="text-xs text-slate-500 mb-1.5">Insertar variable:</p>
        <div className="flex flex-wrap gap-1.5">
          {cols.map(c => (
            <button key={c.nombre} onClick={() => setCondicion(prev => prev ? `${prev} ${c.nombre}` : c.nombre)}
              className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-blue-300 text-[11px] font-mono border border-slate-700 hover:border-blue-500/40 transition-colors">
              {c.nombre}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-500 mb-1.5">Ejemplos:</p>
        <div className="space-y-1">
          {EJEMPLOS.map(e => (
            <button key={e} onClick={() => setCondicion(e)}
              className="block text-left text-[11px] font-mono text-slate-500 hover:text-blue-300 transition-colors">
              {e}
            </button>
          ))}
        </div>
      </div>

      <button disabled={!condicion || cargando} onClick={() => ejecutar(transformarFiltrar, { condicion, modo })} className="btn-primary">
        {cargando ? 'Filtrando…' : 'Aplicar filtro'}
      </button>
    </div>
  )
}


// ─── Tab: Ordenar datos ───────────────────────────────────────────────────────

function TabOrdenar({ cols, ejecutar, cargando }) {
  const [criterios, setCriterios] = useState([{ variable: '', ascendente: true }])

  function addCriterio() { setCriterios(c => [...c, { variable: '', ascendente: true }]) }
  function removeCriterio(i) { setCriterios(c => c.filter((_, idx) => idx !== i)) }
  function update(i, field, val) { setCriterios(c => c.map((cr, idx) => idx === i ? { ...cr, [field]: val } : cr)) }

  function handleEjecutar() {
    const validos = criterios.filter(c => c.variable)
    ejecutar(transformarOrdenar, {
      variables: validos.map(c => c.variable),
      ascendente: validos.map(c => c.ascendente),
    })
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Ordenar datos</h3>
        <p className="text-xs text-slate-500">Reordena las filas por una o varias variables. Equivale a SORT CASES en SPSS.</p>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_140px_32px] gap-2 text-[11px] text-slate-500">
          <span>Variable</span><span>Orden</span><span></span>
        </div>
        {criterios.map((cr, i) => (
          <div key={i} className="grid grid-cols-[1fr_140px_32px] gap-2 items-center">
            <select value={cr.variable} onChange={e => update(i, 'variable', e.target.value)} className="input text-xs">
              <option value="">— seleccionar —</option>
              {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
            </select>
            <select value={String(cr.ascendente)} onChange={e => update(i, 'ascendente', e.target.value === 'true')} className="input text-xs">
              <option value="true">Ascendente (A→Z)</option>
              <option value="false">Descendente (Z→A)</option>
            </select>
            <button onClick={() => removeCriterio(i)} className="text-slate-600 hover:text-red-400 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button onClick={addCriterio} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-1">
          <Plus size={12} /> Añadir criterio
        </button>
      </div>

      <button disabled={!criterios.some(c => c.variable) || cargando} onClick={handleEjecutar} className="btn-primary">
        {cargando ? 'Ordenando…' : 'Ordenar datos'}
      </button>
    </div>
  )
}


// ─── Tab: Ranking ─────────────────────────────────────────────────────────────

function TabRanking({ cols, numericas, ejecutar, cargando }) {
  const [variable, setVariable] = useState('')
  const [nombre, setNombre] = useState('')
  const [metodo, setMetodo] = useState('average')
  const [ascendente, setAscendente] = useState(true)

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Crear ranking</h3>
        <p className="text-xs text-slate-500">Crea una nueva variable con el rango de cada observación. Equivale a RANK en SPSS.</p>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">Variable a rankear</label>
        <select value={variable} onChange={e => { setVariable(e.target.value); setNombre(`RNG_${e.target.value}`) }} className="input w-full">
          <option value="">— seleccionar —</option>
          {numericas.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Nombre de la variable ranking</label>
        <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="RNG_variable" className="input w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Método de empates</label>
          <select value={metodo} onChange={e => setMetodo(e.target.value)} className="input w-full">
            <option value="average">Promedio (SPSS default)</option>
            <option value="min">Mínimo</option>
            <option value="max">Máximo</option>
            <option value="first">Primero encontrado</option>
            <option value="dense">Denso (sin saltos)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Dirección</label>
          <select value={String(ascendente)} onChange={e => setAscendente(e.target.value === 'true')} className="input w-full">
            <option value="true">Ascendente (1 = menor)</option>
            <option value="false">Descendente (1 = mayor)</option>
          </select>
        </div>
      </div>

      <button disabled={!variable || cargando} onClick={() => ejecutar(transformarRanking, { variable, nombre_ranking: nombre, metodo, ascendente })} className="btn-primary">
        {cargando ? 'Calculando…' : 'Crear ranking'}
      </button>
    </div>
  )
}


// ─── Tab: Reemplazar perdidos ─────────────────────────────────────────────────

function TabPerdidos({ cols, numericas, ejecutar, cargando }) {
  const [variables, setVariables] = useState([])
  const [metodo, setMetodo] = useState('media')
  const [valor, setValor] = useState('')

  function toggleVar(v) {
    setVariables(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  const METODOS = [
    ['media', 'Media de la serie'],
    ['mediana', 'Mediana'],
    ['moda', 'Moda (valor más frecuente)'],
    ['valor', 'Valor fijo específico'],
    ['interpolacion', 'Interpolación lineal'],
    ['ffill', 'Copiar valor anterior'],
    ['bfill', 'Copiar valor siguiente'],
  ]

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Reemplazar valores perdidos</h3>
        <p className="text-xs text-slate-500">Imputa los missings con un valor calculado. Equivale a REPLACE MISSING VALUES en SPSS.</p>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Variables a imputar</label>
        <div className="grid grid-cols-3 gap-1.5">
          {numericas.map(v => (
            <label key={v} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={variables.includes(v)} onChange={() => toggleVar(v)} className="accent-blue-500" />
              <span className="text-xs text-slate-300">{v}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">Método de imputación</label>
        <select value={metodo} onChange={e => setMetodo(e.target.value)} className="input w-full">
          {METODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {metodo === 'valor' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">Valor de reemplazo</label>
          <input type="number" value={valor} onChange={e => setValor(e.target.value)} placeholder="0" className="input w-40" />
        </div>
      )}

      <button
        disabled={!variables.length || cargando}
        onClick={() => ejecutar(transformarReemplazarPerdidos, {
          variables,
          metodo,
          valor: metodo === 'valor' ? Number(valor) : null,
        })}
        className="btn-primary"
      >
        {cargando ? 'Imputando…' : 'Reemplazar perdidos'}
      </button>
    </div>
  )
}


// ─── Tab: Agregar datos ───────────────────────────────────────────────────────

function TabAgregar({ cols, numericas, ejecutar, cargando }) {
  const [varGrupo, setVarGrupo] = useState('')
  const [agregaciones, setAgregaciones] = useState([{ variable: '', funcion: 'media', nombre: '' }])

  function addAgg() { setAgregaciones(a => [...a, { variable: '', funcion: 'media', nombre: '' }]) }
  function removeAgg(i) { setAgregaciones(a => a.filter((_, idx) => idx !== i)) }
  function updateAgg(i, field, val) {
    setAgregaciones(a => a.map((ag, idx) => {
      if (idx !== i) return ag
      const updated = { ...ag, [field]: val }
      if ((field === 'variable' || field === 'funcion') && !updated.nombre) {
        updated.nombre = `${updated.variable}_${updated.funcion}`
      }
      return updated
    }))
  }

  const FUNCIONES = ['media', 'mediana', 'suma', 'minimo', 'maximo', 'n', 'desv', 'varianza']

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Agregar datos</h3>
        <p className="text-xs text-slate-500">Calcula estadísticos resumidos por grupos y los añade al dataset. Equivale a AGGREGATE en SPSS.</p>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">Variable de agrupación</label>
        <select value={varGrupo} onChange={e => setVarGrupo(e.target.value)} className="input w-56">
          <option value="">— seleccionar —</option>
          {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-slate-400 font-medium">Agregaciones</label>
          <button onClick={addAgg} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
            <Plus size={12} /> Añadir
          </button>
        </div>
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 text-[11px] text-slate-500 mb-1">
            <span>Variable</span><span>Función</span><span>Nombre resultado</span><span></span>
          </div>
          {agregaciones.map((ag, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 items-center">
              <select value={ag.variable} onChange={e => updateAgg(i, 'variable', e.target.value)} className="input text-xs">
                <option value="">— var —</option>
                {numericas.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={ag.funcion} onChange={e => updateAgg(i, 'funcion', e.target.value)} className="input text-xs">
                {FUNCIONES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <input value={ag.nombre} onChange={e => updateAgg(i, 'nombre', e.target.value)} placeholder="nombre" className="input text-xs" />
              <button onClick={() => removeAgg(i)} className="text-slate-600 hover:text-red-400"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>

      <button
        disabled={!varGrupo || !agregaciones.some(a => a.variable) || cargando}
        onClick={() => ejecutar(transformarAgregar, { variable_grupo: varGrupo, agregaciones: agregaciones.filter(a => a.variable) })}
        className="btn-primary"
      >
        {cargando ? 'Agregando…' : 'Agregar datos'}
      </button>
    </div>
  )
}


// ─── Tab: Reestructurar ───────────────────────────────────────────────────────

function TabReestructurar({ cols, ejecutar, cargando }) {
  const [modo, setModo] = useState('wide_a_long')
  const [colsId, setColsId] = useState([])
  const [colsValor, setColsValor] = useState([])
  const [nombreVar, setNombreVar] = useState('variable')
  const [nombreVal, setNombreVal] = useState('valor')
  const [colIndice, setColIndice] = useState('')
  const [colColumnas, setColColumnas] = useState('')
  const [colValores, setColValores] = useState('')

  function toggleId(v) { setColsId(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]) }
  function toggleValor(v) { setColsValor(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]) }

  function handleEjecutar() {
    if (modo === 'wide_a_long') {
      ejecutar(transformarReestructurar, {
        modo, columnas_id: colsId, columnas_valor: colsValor,
        nombre_var: nombreVar, nombre_val: nombreVal,
      })
    } else {
      ejecutar(transformarReestructurar, {
        modo, columna_indice: colIndice, columna_columnas: colColumnas, columna_valores: colValores,
      })
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Reestructurar datos</h3>
        <p className="text-xs text-slate-500">Convierte entre formato ancho (wide) y largo (long). Equivale a RESTRUCTURE en SPSS.</p>
      </div>

      <div className="flex gap-3">
        {[['wide_a_long', 'Ancho → Largo'], ['long_a_wide', 'Largo → Ancho']].map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 cursor-pointer">
            <input type="radio" value={v} checked={modo === v} onChange={() => setModo(v)} className="accent-blue-500" />
            <span className="text-xs text-slate-300">{l}</span>
          </label>
        ))}
      </div>

      {modo === 'wide_a_long' ? (
        <>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Columnas de identificación (permanecen)</label>
            <div className="grid grid-cols-3 gap-1.5">
              {cols.map(c => (
                <label key={c.nombre} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={colsId.includes(c.nombre)} onChange={() => toggleId(c.nombre)} className="accent-blue-500" />
                  <span className="text-xs text-slate-300">{c.nombre}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Columnas a convertir en filas</label>
            <div className="grid grid-cols-3 gap-1.5">
              {cols.map(c => (
                <label key={c.nombre} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={colsValor.includes(c.nombre)} onChange={() => toggleValor(c.nombre)} className="accent-blue-500" />
                  <span className="text-xs text-slate-300">{c.nombre}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Nombre columna variable</label>
              <input value={nombreVar} onChange={e => setNombreVar(e.target.value)} className="input w-full" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Nombre columna valor</label>
              <input value={nombreVal} onChange={e => setNombreVal(e.target.value)} className="input w-full" />
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {[
            ['Columna índice (identifica filas)', colIndice, setColIndice],
            ['Columna que se convierte en columnas', colColumnas, setColColumnas],
            ['Columna de valores', colValores, setColValores],
          ].map(([label, val, setter]) => (
            <div key={label}>
              <label className="block text-xs text-slate-400 mb-1">{label}</label>
              <select value={val} onChange={e => setter(e.target.value)} className="input w-full">
                <option value="">— seleccionar —</option>
                {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      <button disabled={cargando} onClick={handleEjecutar} className="btn-primary">
        {cargando ? 'Reestructurando…' : 'Reestructurar'}
      </button>
    </div>
  )
}


// ─── Tab: Partir archivo ──────────────────────────────────────────────────────

function TabPartir({ cols, ejecutar, cargando, estado }) {
  const [varGrupo, setVarGrupo] = useState('')

  const activa = estado?.particion_activa

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Partir archivo</h3>
        <p className="text-xs text-slate-500">Divide todos los análisis por grupos de una variable. Equivale a SPLIT FILE en SPSS.</p>
      </div>

      {activa && (
        <div className="flex items-center gap-2 p-2.5 rounded bg-amber-500/10 border border-amber-500/20">
          <span className="text-xs text-amber-400">Partición activa: <strong>{activa}</strong></span>
          <button onClick={() => ejecutar(transformarDesactivarParticion, {})} className="ml-auto text-xs text-slate-400 hover:text-red-400">
            Desactivar
          </button>
        </div>
      )}

      <div>
        <label className="block text-xs text-slate-400 mb-1">Variable de agrupación</label>
        <select value={varGrupo} onChange={e => setVarGrupo(e.target.value)} className="input w-full">
          <option value="">— seleccionar —</option>
          {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </select>
      </div>

      <button disabled={!varGrupo || cargando} onClick={() => ejecutar(transformarPartirArchivo, { variable_grupo: varGrupo })} className="btn-primary">
        {cargando ? 'Configurando…' : 'Activar partición'}
      </button>
    </div>
  )
}


// ─── Tab: Ponderar casos ──────────────────────────────────────────────────────

function TabPonderar({ cols, numericas, ejecutar, cargando, estado }) {
  const [varPeso, setVarPeso] = useState('')

  const activa = estado?.ponderacion_activa

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Ponderar casos</h3>
        <p className="text-xs text-slate-500">Asigna pesos a las observaciones usando una variable numérica. Equivale a WEIGHT BY en SPSS.</p>
      </div>

      {activa && (
        <div className="flex items-center gap-2 p-2.5 rounded bg-amber-500/10 border border-amber-500/20">
          <span className="text-xs text-amber-400">Ponderación activa: <strong>{activa}</strong></span>
          <button onClick={() => ejecutar(transformarPonderar, { variable_peso: null })} className="ml-auto text-xs text-slate-400 hover:text-red-400">
            Desactivar
          </button>
        </div>
      )}

      <div>
        <label className="block text-xs text-slate-400 mb-1">Variable de peso (debe ser numérica y positiva)</label>
        <select value={varPeso} onChange={e => setVarPeso(e.target.value)} className="input w-full">
          <option value="">— seleccionar —</option>
          {numericas.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      <button disabled={!varPeso || cargando} onClick={() => ejecutar(transformarPonderar, { variable_peso: varPeso })} className="btn-primary">
        {cargando ? 'Activando…' : 'Activar ponderación'}
      </button>
    </div>
  )
}
