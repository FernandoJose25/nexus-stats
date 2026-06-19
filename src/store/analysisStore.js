import { create } from 'zustand'

/**
 * Estado global de resultados e historial de análisis.
 * Cada entrada del historial tiene: id, tipo, variables, resultado, timestamp.
 */
export const useAnalysisStore = create((set, get) => ({
  // ── Estado ──────────────────────────────────────────────────────────
  historial: [],          // análisis previos en esta sesión
  resultadoActivo: null,  // el que se muestra en pantalla
  analizando: false,
  errorAnalisis: null,

  // Para el panel de IA
  interpretacionIA: null,
  interpretandoIA: false,
  errorIA: null,

  // ── Acciones ─────────────────────────────────────────────────────────
  setAnalizando: (v) => set({ analizando: v }),

  setErrorAnalisis: (e) => set({ errorAnalisis: e }),

  guardarResultado: (tipo, variables, resultado) => {
    const entrada = {
      id: Date.now(),
      tipo,
      variables,
      resultado,
      timestamp: new Date().toISOString(),
    }
    set((state) => ({
      historial: [entrada, ...state.historial].slice(0, 50), // máx 50 en historial
      resultadoActivo: entrada,
      analizando: false,
      errorAnalisis: null,
    }))
    return entrada
  },

  setResultadoActivo: (entrada) => set({ resultadoActivo: entrada }),

  limpiarResultado: () => set({ resultadoActivo: null }),

  clearHistorial: () => set({ historial: [], resultadoActivo: null }),

  // IA
  setInterpretacionIA: (texto) => set({ interpretacionIA: texto, interpretandoIA: false }),

  setInterpretandoIA: (v) => set({ interpretandoIA: v, interpretacionIA: null }),

  setErrorIA: (e) => set({ errorIA: e, interpretandoIA: false }),

  clearIA: () => set({ interpretacionIA: null, errorIA: null }),
}))
