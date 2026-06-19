import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export default function TablaFrecuencias({ datos }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!datos) return null

  const { variable, n_total, n_validos, n_perdidos, filas } = datos

  return (
    <div className="card overflow-hidden mt-4">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-sm font-medium text-slate-300">
          Tabla de frecuencias — <span className="text-slate-400">{variable}</span>
        </span>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>{n_validos} válidos · {n_perdidos} perdidos</span>
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-[var(--color-border)] overflow-x-auto">
          <table className="w-full text-xs selectable">
            <thead>
              <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
                <th className="px-4 py-2.5 text-left text-slate-400 font-medium">Valor</th>
                <th className="px-4 py-2.5 text-right text-slate-400 font-medium">Frecuencia</th>
                <th className="px-4 py-2.5 text-right text-slate-400 font-medium">%</th>
                <th className="px-4 py-2.5 text-right text-slate-400 font-medium">% válido</th>
                <th className="px-4 py-2.5 text-right text-slate-400 font-medium">% acumulado</th>
                <th className="px-4 py-2.5 text-left text-slate-400 font-medium w-32">Barra</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => {
                const pct = fila.porcentaje ?? 0
                const barWidth = Math.min(100, pct)
                return (
                  <tr
                    key={i}
                    className={`border-b border-[var(--color-border)] last:border-0 ${
                      fila.es_perdido ? 'opacity-50' : ''
                    } ${i % 2 === 0 ? 'bg-white/[0.01]' : ''}`}
                  >
                    <td className="px-4 py-2 stat-value text-slate-300">
                      {fila.es_perdido ? (
                        <span className="text-slate-600 italic">Perdido</span>
                      ) : (
                        fila.valor ?? '—'
                      )}
                    </td>
                    <td className="px-4 py-2 text-right stat-value text-slate-200">{fila.frecuencia}</td>
                    <td className="px-4 py-2 text-right stat-value text-slate-300">{fila.porcentaje?.toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right stat-value text-slate-300">
                      {fila.porcentaje_valido != null ? `${fila.porcentaje_valido.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right stat-value text-slate-300">
                      {fila.porcentaje_acumulado != null ? `${fila.porcentaje_acumulado.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <div className="h-2 rounded-full bg-[var(--color-border)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500/70 transition-all"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--color-border)] bg-white/[0.02]">
                <td className="px-4 py-2 text-slate-400 font-medium text-xs">Total</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{n_total}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-300">100%</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
