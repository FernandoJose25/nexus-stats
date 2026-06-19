import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, Hash, Type, Calendar, AlertCircle, SlidersHorizontal, Save, CheckCircle2 } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { cargarArchivo, getPreview, guardarDatos } from '../services/pythonApi'
import { useT } from '../i18n/useT'
import VariableEditor from '../components/DataEditor/VariableEditor'

const TYPE_ICONS = {
  numerico: <Hash size={12} className="text-blue-400" />,
  cadena:   <Type size={12} className="text-emerald-400" />,
  fecha:    <Calendar size={12} className="text-amber-400" />,
}

const EMPTY_ROWS = 20

export default function DataEditorPage() {
  const t = useT()
  const navigate = useNavigate()
  const [showVarEditor, setShowVarEditor] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [savedOk, setSavedOk]             = useState(false)

  // selección tipo hoja de cálculo
  const [selected, setSelected]     = useState(null)  // { row, col } — índices en columns[]
  const [editing, setEditing]       = useState(false)
  const [editValue, setEditValue]   = useState('')
  const [formulaBar, setFormulaBar] = useState('')    // lo que muestra la barra de estado

  const inputRef   = useRef(null)
  const tableRef   = useRef(null)
  const containerRef = useRef(null)

  const {
    metadata, rows, isLoading, loadError, isDirty,
    setMetadata, setRows, setLoading, setLoadError,
    toggleVariable, selectedVariables, updateCell, markClean,
  } = useDataStore()

  const columns = metadata?.column_info ?? []
  const totalRows = rows.length + EMPTY_ROWS   // filas de datos + vacías al final

  // ── helpers ─────────────────────────────────────────────────────────────────

  const getCellValue = useCallback((rowIdx, colIdx) => {
    const row = rows[rowIdx]
    if (!row) return null
    const col = columns[colIdx]
    if (!col) return null
    const v = row[col.nombre]
    return (v === '' || v == null) ? null : v
  }, [rows, columns])

  const moveTo = useCallback((row, col, startEditing = false) => {
    const r = Math.max(0, Math.min(row, totalRows - 1))
    const c = Math.max(0, Math.min(col, columns.length - 1))
    setSelected({ row: r, col: c })
    setEditing(startEditing)
    if (startEditing) {
      const val = getCellValue(r, c)
      setEditValue(val == null ? '' : String(val))
    } else {
      const val = getCellValue(r, c)
      setFormulaBar(val == null ? '' : String(val))
    }
  }, [totalRows, columns.length, getCellValue])

  // enfocar input al entrar en edición
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing, selected])

  // ── commit / cancel ──────────────────────────────────────────────────────────

  const commitEdit = useCallback((nextRow, nextCol) => {
    if (!editing || !selected) return
    updateCell(selected.row, columns[selected.col]?.nombre, editValue)
    setEditing(false)
    setFormulaBar(editValue)
    if (nextRow !== undefined) moveTo(nextRow, nextCol)
  }, [editing, selected, editValue, updateCell, columns, moveTo])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    const val = getCellValue(selected?.row, selected?.col)
    setFormulaBar(val == null ? '' : String(val))
  }, [selected, getCellValue])

  // ── teclado global (cuando hay celda seleccionada, no editando) ──────────────

  useEffect(() => {
    const handleKey = (e) => {
      if (!selected || editing) return
      const { row, col } = selected

      if (e.key === 'ArrowDown')  { e.preventDefault(); moveTo(row + 1, col) }
      else if (e.key === 'ArrowUp')    { e.preventDefault(); moveTo(row - 1, col) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); moveTo(row, col + 1) }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveTo(row, col - 1) }
      else if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) moveTo(row, col - 1)
        else moveTo(row, col + 1)
      }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) moveTo(row - 1, col)
        else {
          // entrar en modo edición
          const val = getCellValue(row, col)
          setEditValue(val == null ? '' : String(val))
          setEditing(true)
        }
      }
      else if (e.key === 'F2') {
        e.preventDefault()
        const val = getCellValue(row, col)
        setEditValue(val == null ? '' : String(val))
        setEditing(true)
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        updateCell(row, columns[col]?.nombre, null)
        setFormulaBar('')
      }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // tipear directamente empieza la edición con ese carácter
        setEditValue(e.key)
        setEditing(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selected, editing, moveTo, getCellValue, columns, updateCell])

  // ── teclado dentro del input ─────────────────────────────────────────────────

  const handleInputKey = useCallback((e) => {
    const { row, col } = selected
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEdit()
      moveTo(row + 1, col)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commitEdit()
      if (e.shiftKey) moveTo(row, col - 1)
      else moveTo(row, col + 1)
    } else if (e.key === 'Escape') {
      cancelEdit()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      commitEdit(row + 1, col)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      commitEdit(row - 1, col)
    }
  }, [selected, commitEdit, moveTo, cancelEdit])

  // ── clic en celda ────────────────────────────────────────────────────────────

  const handleCellClick = useCallback((row, col) => {
    if (editing) commitEdit()
    const val = getCellValue(row, col)
    setSelected({ row, col })
    setEditing(false)
    setFormulaBar(val == null ? '' : String(val))
  }, [editing, commitEdit, getCellValue])

  const handleCellDoubleClick = useCallback((row, col) => {
    const val = getCellValue(row, col)
    setSelected({ row, col })
    setEditValue(val == null ? '' : String(val))
    setEditing(true)
  }, [getCellValue])

  // ── abrir archivo ────────────────────────────────────────────────────────────

  async function handleAbrirArchivo() {
    if (!window.electronAPI) return
    const ruta = await window.electronAPI.openFile()
    if (!ruta) return
    setLoading(true)
    setLoadError(null)
    try {
      const { metadata: meta } = await cargarArchivo(ruta)
      setMetadata(meta)
      const { filas } = await getPreview(100)
      setRows(filas)
      setSelected(null)
      setEditing(false)
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── guardar ──────────────────────────────────────────────────────────────────

  async function handleGuardar() {
    setSaving(true)
    try {
      await guardarDatos()
      markClean()
      setSavedOk(true)
      setTimeout(() => setSavedOk(false), 2500)
    } catch (err) {
      alert(`Error al guardar: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── pantalla sin datos ───────────────────────────────────────────────────────

  if (!metadata) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        {loadError && (
          <div className="flex items-center gap-2 text-red-400 text-sm mb-2">
            <AlertCircle size={16} /> {loadError}
          </div>
        )}
        <div className="text-center">
          <p className="text-slate-300 font-medium mb-1">{t('datos.sinDatos')}</p>
          <p className="text-slate-500 text-sm mb-6">{t('datos.sinDatosDesc')}</p>
          <button onClick={handleAbrirArchivo} disabled={isLoading} className="btn-primary">
            {isLoading ? t('datos.cargando') : t('datos.abrirArchivo')}
          </button>
        </div>
      </div>
    )
  }

  // ── render ───────────────────────────────────────────────────────────────────

  const selCol = selected ? columns[selected.col] : null

  return (
    <div className="flex-1 flex flex-col overflow-hidden" ref={containerRef}>

      {/* ── Barra de herramientas ── */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] flex-shrink-0"
        style={{ paddingRight: 'calc(var(--titlebar-controls-width) + 12px)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-medium text-slate-200 truncate">{metadata.filename}</span>
          <span className="text-slate-500 text-xs whitespace-nowrap">
            {metadata.rows.toLocaleString()} {t('datos.filas')} · {metadata.columns} {t('datos.columnas')}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Botón guardar — visible solo cuando hay cambios pendientes */}
          {isDirty && (
            <button
              onClick={handleGuardar}
              disabled={saving}
              className="btn-primary text-xs flex items-center gap-1.5 animate-pulse-once"
            >
              <Save size={13} />
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          )}
          {savedOk && !isDirty && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={13} /> Guardado
            </span>
          )}
          <button onClick={handleAbrirArchivo} disabled={isLoading} className="btn-ghost text-xs flex items-center gap-1.5">
            <FolderOpen size={14} /> {t('datos.abrirArchivo')}
          </button>
          <button onClick={() => setShowVarEditor(true)} className="btn-ghost text-xs flex items-center gap-1.5">
            <SlidersHorizontal size={14} /> Variables
          </button>
          {selectedVariables.length > 0 && (
            <button onClick={() => navigate('/descriptivos')} className="btn-primary text-xs">
              Analizar {selectedVariables.length} variable{selectedVariables.length > 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      {/* ── Barra de fórmula (estilo SPSS / Excel) ── */}
      <div
        className="flex items-center gap-0 border-b border-[var(--color-border)] flex-shrink-0 text-xs"
        style={{ background: 'var(--color-surface)' }}
      >
        {/* referencia de celda */}
        <div className="flex items-center justify-center px-3 py-1.5 border-r border-[var(--color-border)] min-w-[90px] text-slate-400 font-mono select-none">
          {selected
            ? `${selected.row + 1} : ${selCol?.nombre ?? ''}`
            : '—'}
        </div>
        {/* tipo de variable */}
        <div className="flex items-center px-2 border-r border-[var(--color-border)] text-slate-600 select-none">
          {selCol ? (TYPE_ICONS[selCol.tipo] ?? null) : null}
        </div>
        {/* valor actual */}
        <div className="flex-1 px-3 py-1.5 text-slate-300 font-mono truncate select-text">
          {editing ? editValue : formulaBar}
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="flex-1 overflow-auto" ref={tableRef} tabIndex={-1}>
        <table className="text-xs border-collapse" style={{ minWidth: '100%' }}>

          {/* ── Encabezados ── */}
          <thead className="sticky top-0 z-10" style={{ background: 'var(--color-surface)' }}>
            <tr>
              {/* esquina vacía */}
              <th className="w-10 min-w-[40px] px-2 py-2 text-center border-b border-r border-[var(--color-border)]" />
              {columns.map((col, ci) => (
                <th
                  key={col.nombre}
                  onClick={() => toggleVariable(col.nombre)}
                  style={{ minWidth: 100 }}
                  className={`px-3 py-2 text-left border-b border-r border-[var(--color-border)]
                              cursor-pointer select-none transition-colors whitespace-nowrap
                              ${selected?.col === ci ? 'bg-blue-500/10' : ''}
                              ${selectedVariables.includes(col.nombre)
                                ? 'text-blue-300'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'}`}
                >
                  <div className="flex items-center gap-1.5">
                    {TYPE_ICONS[col.tipo]}
                    <span className="font-medium">{col.nombre}</span>
                  </div>
                  <div className="text-[10px] font-normal text-slate-600 mt-0.5">
                    {col.n_validos}V · {col.n_perdidos}P
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* ── Cuerpo ── */}
          <tbody>
            {Array.from({ length: totalRows }, (_, i) => {
              const row = rows[i] ?? null
              const isDataRow = i < rows.length
              const isSelectedRow = selected?.row === i

              return (
                <tr
                  key={i}
                  className={`transition-colors ${isSelectedRow ? '' : 'hover:bg-white/[0.015]'}`}
                >
                  {/* número de fila */}
                  <td
                    className={`px-2 py-1.5 text-center border-r border-b border-[var(--color-border)]
                                font-mono select-none text-slate-600 cursor-default
                                ${isSelectedRow ? 'bg-blue-500/10 text-blue-400 font-semibold' : ''}`}
                  >
                    {i + 1}
                  </td>

                  {columns.map((col, ci) => {
                    const isThisSelected = isSelectedRow && selected?.col === ci
                    const isEditing = isThisSelected && editing
                    const val = isDataRow ? row?.[col.nombre] : undefined
                    const isEmpty = val === '' || val == null
                    const isColSelected = selectedVariables.includes(col.nombre)

                    return (
                      <td
                        key={col.nombre}
                        onClick={() => handleCellClick(i, ci)}
                        onDoubleClick={() => handleCellDoubleClick(i, ci)}
                        style={{ minWidth: 100 }}
                        className={[
                          'border-r border-b border-[var(--color-border)] stat-value cursor-cell relative',
                          isEditing ? 'p-0' : 'px-3 py-1.5',
                          isThisSelected && !isEditing
                            ? 'outline outline-2 outline-blue-500 outline-offset-[-2px] bg-blue-500/10'
                            : '',
                          isColSelected && !isThisSelected ? 'bg-blue-500/5' : '',
                          isEmpty && !isEditing ? 'text-slate-600' : 'text-slate-200',
                          !isDataRow && !isThisSelected ? 'bg-white/[0.01]' : '',
                        ].join(' ')}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => {
                              setEditValue(e.target.value)
                              setFormulaBar(e.target.value)
                            }}
                            onBlur={commitEdit}
                            onKeyDown={handleInputKey}
                            className="w-full h-full px-3 py-1.5 bg-[#1a2a4a] text-slate-100
                                       font-mono text-xs border-0 outline-none"
                            style={{ minHeight: '100%' }}
                          />
                        ) : (
                          isEmpty ? (isDataRow ? '.' : '') : String(val)
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>

        {rows.length === 100 && (
          <p className="text-center text-slate-600 text-xs py-3 select-none">
            Vista previa: primeras 100 filas de {metadata.rows.toLocaleString()}
          </p>
        )}
      </div>

      {/* ── Barra de estado inferior (estilo SPSS) ── */}
      <div className="flex items-center justify-between px-4 py-1 border-t border-[var(--color-border)] flex-shrink-0 text-[10px] text-slate-600 select-none"
           style={{ background: 'var(--color-surface)' }}>
        <span>
          {editing
            ? `Editando: ${selCol?.nombre ?? ''}`
            : selected
              ? `Fila ${selected.row + 1}  Variable: ${selCol?.nombre ?? ''}  Tipo: ${selCol?.tipo ?? ''}`
              : 'Listo'}
        </span>
        <span>
          {metadata.rows.toLocaleString()} casos · {metadata.columns} variables
        </span>
      </div>

      {showVarEditor && <VariableEditor onClose={() => setShowVarEditor(false)} />}
    </div>
  )
}
