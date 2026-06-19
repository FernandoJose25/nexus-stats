import { create } from 'zustand'

/**
 * Estado global del dataset activo.
 * metadata: info del archivo cargado (nombre, filas, columnas, column_info)
 * rows: primeras 100 filas para el editor visual
 * selectedVariables: columnas seleccionadas para el análisis actual
 */
export const useDataStore = create((set, get) => ({
  // ── Estado ──────────────────────────────────────────────────────────
  metadata: null,       // { filename, rows, columns, column_info[] }
  rows: [],             // array de objetos para la tabla
  selectedVariables: [],
  isLoading: false,
  loadError: null,
  isDirty: false,       // hay cambios sin guardar en el editor

  // ── Acciones ─────────────────────────────────────────────────────────
  setMetadata: (metadata) => set({ metadata }),

  setRows: (rows) => set({ rows }),

  setLoading: (isLoading) => set({ isLoading }),

  setLoadError: (loadError) => set({ loadError }),

  markClean: () => set({ isDirty: false }),

  toggleVariable: (varName) => {
    const current = get().selectedVariables
    const idx = current.indexOf(varName)
    if (idx === -1) {
      set({ selectedVariables: [...current, varName] })
    } else {
      set({ selectedVariables: current.filter((v) => v !== varName) })
    }
  },

  selectAllVariables: () => {
    const meta = get().metadata
    if (!meta) return
    const numericVars = meta.column_info
      .filter((c) => c.tipo === 'numerico')
      .map((c) => c.nombre)
    set({ selectedVariables: numericVars })
  },

  clearSelection: () => set({ selectedVariables: [] }),

  updateCell: (rowIndex, colName, value) => {
    const rows = get().rows.slice()
    rows[rowIndex] = { ...rows[rowIndex], [colName]: value === '' ? null : value }
    set({ rows, isDirty: true })
  },

  clearDataset: () =>
    set({
      metadata: null,
      rows: [],
      selectedVariables: [],
      loadError: null,
      isDirty: false,
    }),

  // Helpers derivados
  getColumnInfo: (varName) => {
    const meta = get().metadata
    if (!meta) return null
    return meta.column_info.find((c) => c.nombre === varName) ?? null
  },

  getNumericColumns: () => {
    const meta = get().metadata
    if (!meta) return []
    return meta.column_info.filter((c) => c.tipo === 'numerico')
  },

  getAllColumns: () => {
    const meta = get().metadata
    if (!meta) return []
    return meta.column_info
  },
}))
