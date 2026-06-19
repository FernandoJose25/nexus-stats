import { Clock, BarChart3, Trash2 } from 'lucide-react'
import { useAnalysisStore } from '../../store/analysisStore'

const TIPO_LABELS = {
  descriptivos: 'Descriptivos',
  frecuencias: 'Frecuencias',
  regresion: 'Regresión',
  anova: 'ANOVA',
  correlacion: 'Correlación',
}

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

export default function HistorialPanel() {
  const { historial, resultadoActivo, setResultadoActivo, clearHistorial } = useAnalysisStore()

  if (historial.length === 0) return null

  return (
    <div className="border-t border-[var(--color-border)] mt-auto">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5 text-slate-500">
          <Clock size={12} />
          <span className="text-xs font-medium uppercase tracking-wider">Historial</span>
        </div>
        <button
          onClick={clearHistorial}
          className="text-slate-600 hover:text-red-400 transition-colors p-1 rounded"
          title="Limpiar historial"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="max-h-48 overflow-y-auto px-2 pb-2 space-y-0.5">
        {historial.map((entrada) => (
          <button
            key={entrada.id}
            onClick={() => setResultadoActivo(entrada)}
            className={`w-full text-left px-2 py-2 rounded-lg transition-colors text-xs
                        ${resultadoActivo?.id === entrada.id
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                        }`}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <BarChart3 size={11} />
              <span className="font-medium">{TIPO_LABELS[entrada.tipo] ?? entrada.tipo}</span>
              <span className="ml-auto text-slate-600">{formatTime(entrada.timestamp)}</span>
            </div>
            <div className="text-slate-600 truncate pl-4">
              {entrada.variables.slice(0, 3).join(', ')}
              {entrada.variables.length > 3 && ` +${entrada.variables.length - 3}`}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
