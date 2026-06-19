import { useState } from 'react'
import { Hash, Type, Calendar, Check, X, Pencil } from 'lucide-react'
import { useDataStore } from '../../store/dataStore'

const TIPOS = [
  { id: 'numerico', label: 'Numérico', icon: <Hash size={13} className="text-blue-400" /> },
  { id: 'cadena',   label: 'Texto',    icon: <Type size={13} className="text-emerald-400" /> },
  { id: 'fecha',    label: 'Fecha',    icon: <Calendar size={13} className="text-amber-400" /> },
]

export default function VariableEditor({ onClose }) {
  const { metadata, setMetadata } = useDataStore()
  const [editingIdx, setEditingIdx] = useState(null)
  const [editName, setEditName] = useState('')

  if (!metadata) return null

  const columns = [...metadata.column_info]

  function startEdit(idx) {
    setEditingIdx(idx)
    setEditName(columns[idx].nombre)
  }

  function commitRename(idx) {
    const trimmed = editName.trim()
    if (!trimmed || trimmed === columns[idx].nombre) {
      setEditingIdx(null)
      return
    }
    const updated = columns.map((col, i) =>
      i === idx ? { ...col, nombre: trimmed } : col
    )
    setMetadata({ ...metadata, column_info: updated })
    setEditingIdx(null)
  }

  function changeTipo(idx, tipo) {
    const updated = columns.map((col, i) =>
      i === idx ? { ...col, tipo } : col
    )
    setMetadata({ ...metadata, column_info: updated })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card w-[680px] max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-semibold text-slate-200">Editor de variables</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X size={16} />
          </button>
        </div>

        {/* Tabla */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: 'var(--color-surface)' }}>
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Nombre</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Tipo</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Válidos</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Perdidos</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col, idx) => (
                <tr key={idx} className={`border-b border-[var(--color-border)] ${idx % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                  {/* Índice */}
                  <td className="px-5 py-3 text-slate-600 font-mono text-xs">{idx + 1}</td>

                  {/* Nombre editable */}
                  <td className="px-5 py-3">
                    {editingIdx === idx ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(idx)
                            if (e.key === 'Escape') setEditingIdx(null)
                          }}
                          className="bg-[var(--color-bg)] border border-blue-500 rounded px-2 py-1
                                     text-slate-200 text-sm focus:outline-none w-40"
                        />
                        <button onClick={() => commitRename(idx)} className="text-emerald-400 hover:text-emerald-300">
                          <Check size={14} />
                        </button>
                        <button onClick={() => setEditingIdx(null)} className="text-slate-500 hover:text-slate-300">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <span className="text-slate-200 font-medium">{col.nombre}</span>
                        <button
                          onClick={() => startEdit(idx)}
                          className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-300 transition-opacity"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Tipo */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      {TIPOS.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => changeTipo(idx, t.id)}
                          title={t.label}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors
                                      ${col.tipo === t.id
                                        ? 'bg-blue-500/15 border border-blue-500/30 text-blue-300'
                                        : 'text-slate-600 hover:text-slate-300 hover:bg-white/5'
                                      }`}
                        >
                          {t.icon}
                          <span className="hidden sm:inline">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </td>

                  {/* Stats */}
                  <td className="px-5 py-3 text-right stat-value text-slate-300">{col.n_validos.toLocaleString()}</td>
                  <td className={`px-5 py-3 text-right stat-value ${col.n_perdidos > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                    {col.n_perdidos.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {columns.length} variables · Los cambios de nombre y tipo son solo locales (no modifican el archivo original)
          </p>
          <button onClick={onClose} className="btn-primary text-sm">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
