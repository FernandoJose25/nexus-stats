import { useState, useEffect } from 'react'
import { SlidersHorizontal, Save, Plus, Trash2, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { variablesGetAll, variablesActualizar, variablesRenombrar, variablesEliminar } from '../services/pythonApi'

const MEDIDAS = ['escala', 'ordinal', 'nominal']
const ALINEACIONES = ['izquierda', 'derecha', 'centrado']

export default function VariableView() {
  const { metadata, setMetadata } = useDataStore()
  const [variables, setVariables] = useState([])
  const [editando,  setEditando]  = useState(null)   // nombre de la variable en edición
  const [form,      setForm]      = useState({})
  const [cargando,  setCarg]      = useState(false)
  const [msg,       setMsg]       = useState(null)    // {tipo: 'ok'|'error', texto}
  const [nuevoValor, setNuevoVal] = useState({ clave: '', etiqueta: '' })

  useEffect(() => { if (metadata) cargar() }, [metadata])

  async function cargar() {
    setCarg(true)
    try {
      const res = await variablesGetAll()
      setVariables(res.variables || [])
    } catch (e) {
      setMsg({ tipo: 'error', texto: e.message })
    } finally {
      setCarg(false)
    }
  }

  function abrirEdicion(v) {
    setEditando(v.nombre)
    setForm({
      nombre:             v.nombre,
      etiqueta:           v.etiqueta || '',
      etiquetas_valores:  { ...(v.etiquetas_valores || {}) },
      missings_definidos: (v.missings_definidos || []).join(', '),
      medida:             v.medida || 'escala',
      decimales:          v.decimales ?? 2,
      ancho:              v.ancho ?? 8,
    })
    setNuevoVal({ clave: '', etiqueta: '' })
    setMsg(null)
  }

  function cerrarEdicion() {
    setEditando(null)
    setForm({})
  }

  async function guardarVariable() {
    const missings = form.missings_definidos
      ? form.missings_definidos.split(',').map(s => s.trim()).filter(Boolean).map(Number)
      : []

    setCarg(true)
    try {
      await variablesActualizar([{
        nombre: form.nombre,
        etiqueta: form.etiqueta,
        etiquetas_valores: form.etiquetas_valores,
        missings_definidos: missings,
        medida: form.medida,
        decimales: Number(form.decimales),
        ancho: Number(form.ancho),
      }])
      await cargar()
      setMsg({ tipo: 'ok', texto: `Variable '${form.nombre}' actualizada.` })
      cerrarEdicion()
    } catch (e) {
      setMsg({ tipo: 'error', texto: e.message })
    } finally {
      setCarg(false)
    }
  }

  async function eliminarVariable(nombre) {
    if (!confirm(`¿Eliminar la variable '${nombre}'? Esta acción se puede deshacer.`)) return
    setCarg(true)
    try {
      const res = await variablesEliminar(nombre)
      if (res.metadata) setMetadata(res.metadata)
      await cargar()
      setMsg({ tipo: 'ok', texto: `Variable '${nombre}' eliminada.` })
    } catch (e) {
      setMsg({ tipo: 'error', texto: e.message })
    } finally {
      setCarg(false)
    }
  }

  function addValueLabel() {
    if (!nuevoValor.clave) return
    setForm(f => ({
      ...f,
      etiquetas_valores: { ...f.etiquetas_valores, [nuevoValor.clave]: nuevoValor.etiqueta }
    }))
    setNuevoVal({ clave: '', etiqueta: '' })
  }

  function removeValueLabel(key) {
    setForm(f => {
      const ev = { ...f.etiquetas_valores }
      delete ev[key]
      return { ...f, etiquetas_valores: ev }
    })
  }

  if (!metadata) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <SlidersHorizontal size={32} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Carga un dataset primero</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ── Tabla de variables ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center gap-3"
          style={{ background: 'var(--color-surface)' }}>
          <SlidersHorizontal size={16} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Vista de variables</h2>
          <span className="text-slate-500 text-xs">{variables.length} variables</span>
          <button onClick={cargar} className="ml-auto btn-ghost text-xs flex items-center gap-1.5">
            <RefreshCw size={12} /> Recargar
          </button>
        </div>

        {msg && (
          <div className={`px-5 py-2 text-xs flex items-center gap-2 border-b
            ${msg.tipo==='ok' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
            {msg.tipo==='ok' ? <CheckCircle2 size={13}/> : <AlertCircle size={13}/>}
            {msg.texto}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10" style={{ background: 'var(--color-surface)' }}>
              <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
                {['Nombre','Etiqueta','Tipo','Missings definidos','Medida','Dec','Etiquetas valores','Acciones'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {variables.map(v => (
                <tr key={v.nombre}
                  className={`border-b border-[var(--color-border)]/50 hover:bg-white/[0.02] cursor-pointer
                    ${editando===v.nombre ? 'bg-blue-500/5' : ''}`}
                  onClick={() => editando===v.nombre ? cerrarEdicion() : abrirEdicion(v)}>
                  <td className="px-3 py-2 font-medium text-slate-200">{v.nombre}</td>
                  <td className="px-3 py-2 text-slate-400 italic">{v.etiqueta || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px]
                      ${v.tipo_dato==='numerico'?'bg-blue-500/10 text-blue-300':v.tipo_dato==='fecha'?'bg-amber-500/10 text-amber-300':'bg-emerald-500/10 text-emerald-300'}`}>
                      {v.tipo_dato}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">
                    {v.missings_definidos?.length ? v.missings_definidos.join(', ') : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px]
                      ${v.medida==='escala'?'bg-purple-500/10 text-purple-300':v.medida==='ordinal'?'bg-amber-500/10 text-amber-300':'bg-slate-500/10 text-slate-400'}`}>
                      {v.medida}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-400 text-center">{v.decimales ?? 2}</td>
                  <td className="px-3 py-2 text-slate-500 text-[11px]">
                    {v.etiquetas_valores && Object.keys(v.etiquetas_valores).length > 0
                      ? Object.entries(v.etiquetas_valores).slice(0,3).map(([k,lv]) => `${k}=${lv}`).join('; ') + (Object.keys(v.etiquetas_valores).length>3?'…':'')
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={e => { e.stopPropagation(); eliminarVariable(v.nombre) }}
                      className="text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Panel de edición ─────────────────────────────────────────── */}
      {editando && (
        <div className="w-80 flex-shrink-0 border-l border-[var(--color-border)] flex flex-col overflow-y-auto"
          style={{ background: 'var(--color-surface)' }}>
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-200">{form.nombre}</p>
            <button onClick={cerrarEdicion} className="text-slate-500 hover:text-slate-300 text-xs">✕ Cerrar</button>
          </div>

          <div className="p-4 space-y-3 flex-1">
            <Field label="Nombre">
              <input value={form.nombre} onChange={e => setForm(f=>({...f,nombre:e.target.value}))}
                className="input w-full" disabled />
            </Field>

            <Field label="Etiqueta (variable label)">
              <input value={form.etiqueta} onChange={e => setForm(f=>({...f,etiqueta:e.target.value}))}
                placeholder="Descripción de la variable" className="input w-full" />
            </Field>

            <Field label="Medida de escala">
              <select value={form.medida} onChange={e => setForm(f=>({...f,medida:e.target.value}))} className="input w-full" size={1}>
                {MEDIDAS.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase()+m.slice(1)}</option>)}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Decimales">
                <input type="number" min={0} max={10} value={form.decimales}
                  onChange={e => setForm(f=>({...f,decimales:e.target.value}))} className="input w-full" />
              </Field>
              <Field label="Ancho">
                <input type="number" min={1} max={40} value={form.ancho}
                  onChange={e => setForm(f=>({...f,ancho:e.target.value}))} className="input w-full" />
              </Field>
            </div>

            <Field label="Valores perdidos definidos (ej: 99, 999)">
              <input value={form.missings_definidos}
                onChange={e => setForm(f=>({...f,missings_definidos:e.target.value}))}
                placeholder="99, 999, -1" className="input w-full font-mono" />
              <p className="text-[10px] text-slate-600 mt-1">Separar con comas. Se aplicarán como NaN.</p>
            </Field>

            {/* Etiquetas de valores */}
            <div>
              <p className="text-[11px] text-slate-500 font-medium mb-1.5">Etiquetas de valores</p>
              {Object.entries(form.etiquetas_valores || {}).map(([k, lv]) => (
                <div key={k} className="flex items-center gap-1.5 mb-1">
                  <span className="font-mono text-xs text-slate-400 w-12 text-right">{k} =</span>
                  <span className="text-xs text-slate-300 flex-1">{lv}</span>
                  <button onClick={() => removeValueLabel(k)} className="text-slate-600 hover:text-red-400">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              <div className="flex gap-1.5 mt-1.5">
                <input value={nuevoValor.clave} onChange={e => setNuevoVal(v=>({...v,clave:e.target.value}))}
                  placeholder="valor" className="input w-16 font-mono text-xs" />
                <input value={nuevoValor.etiqueta} onChange={e => setNuevoVal(v=>({...v,etiqueta:e.target.value}))}
                  placeholder="etiqueta" className="input flex-1 text-xs" />
                <button onClick={addValueLabel} className="text-blue-400 hover:text-blue-300">
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-[var(--color-border)]">
            <button onClick={guardarVariable} disabled={cargando} className="btn-primary w-full flex items-center justify-center gap-2">
              <Save size={14} /> {cargando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
