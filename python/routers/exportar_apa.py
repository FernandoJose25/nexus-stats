"""
Exportación en formato APA 7 a Word (.docx).
Genera tablas con el estilo APA: líneas horizontales únicamente (3 líneas),
fuente Times New Roman 12pt, notas al pie estandarizadas.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Any, Optional
import io, os, tempfile

router = APIRouter()

TIPO_LABELS = {
    "descriptivos": "Estadísticos descriptivos",
    "correlaciones": "Matriz de correlaciones",
    "t_test": "Prueba t",
    "anova": "Análisis de varianza (ANOVA)",
    "regresion": "Coeficientes de regresión",
    "chi2": "Prueba chi-cuadrado",
    "factorial": "Análisis factorial",
    "clustering": "Análisis de conglomerados",
    "crosstabs": "Tabla de contingencia",
    "supervivencia": "Análisis de supervivencia",
    "manova": "Análisis multivariante de varianza (MANOVA)",
    "discriminante": "Análisis discriminante",
    "mediacion": "Análisis de mediación",
}


class BloqueResultado(BaseModel):
    tipo: str
    titulo: Optional[str] = None
    datos: dict[str, Any]


class ExportarAPARequest(BaseModel):
    bloques: list[BloqueResultado]
    titulo_documento: str = "Resultados del Análisis"
    autor: str = ""
    institucion: str = ""
    nota_general: str = ""
    ruta_destino: str


def _apa_document():
    from docx import Document
    from docx.shared import Pt, Inches, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    doc = Document()

    # Márgenes APA: 1 pulgada por todos lados
    for section in doc.sections:
        section.top_margin    = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin   = Inches(1)
        section.right_margin  = Inches(1)

    # Fuente base: Times New Roman 12
    style = doc.styles['Normal']
    style.font.name = 'Times New Roman'
    style.font.size = Pt(12)

    return doc


def _set_apa_table_borders(table):
    """Aplica estilo APA a una tabla: solo líneas horizontales (top, header bottom, bottom)."""
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    def set_cell_border(cell, **kwargs):
        tc = cell._tc
        tcPr = tc.get_or_add_tcPr()
        tcBorders = OxmlElement('w:tcBorders')
        for edge in ('top','left','bottom','right','insideH','insideV'):
            tag = OxmlElement(f'w:{edge}')
            if edge in kwargs:
                tag.set(qn('w:val'), kwargs[edge].get('val','none'))
                tag.set(qn('w:sz'), str(kwargs[edge].get('sz', 4)))
                tag.set(qn('w:color'), kwargs[edge].get('color','000000'))
            else:
                tag.set(qn('w:val'), 'none')
            tcBorders.append(tag)
        tcPr.append(tcBorders)

    nrows = len(table.rows)
    for ri, row in enumerate(table.rows):
        for ci, cell in enumerate(row.cells):
            borders = {}
            if ri == 0:                    # Línea encima del header
                borders['top'] = {'val':'single','sz':8,'color':'000000'}
            if ri == 0:                    # Línea debajo del header
                borders['bottom'] = {'val':'single','sz':4,'color':'000000'}
            if ri == nrows - 1:            # Línea debajo de la última fila
                borders['bottom'] = {'val':'single','sz':8,'color':'000000'}
            set_cell_border(cell, **borders)


def _add_apa_heading(doc, text, level=1):
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    h = doc.add_paragraph(text)
    h.style = doc.styles['Normal']
    run = h.runs[0] if h.runs else h.add_run(text)
    if level == 1:
        run.bold = True
        h.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run.font.size = Pt(12)
    elif level == 2:
        run.bold = True
        run.italic = False
        h.alignment = WD_ALIGN_PARAGRAPH.LEFT
    elif level == 3:
        run.bold = True
        run.italic = True
        h.alignment = WD_ALIGN_PARAGRAPH.LEFT
    return h


def _add_table_note(doc, note_text: str):
    from docx.shared import Pt
    p = doc.add_paragraph()
    run_note = p.add_run("Nota. ")
    run_note.italic = True
    run_note.font.size = Pt(10)
    run_text = p.add_run(note_text)
    run_text.font.size = Pt(10)
    return p


def _render_descriptivos(doc, datos: dict):
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    resultados = datos.get("resultados", [])
    if not resultados:
        return

    headers = ["Variable", "N", "M", "DE", "Mín", "Máx", "Asimetría", "Curtosis"]
    table = doc.add_table(rows=1 + len(resultados), cols=len(headers))

    # Header
    for ci, h in enumerate(headers):
        cell = table.rows[0].cells[ci]
        cell.text = h
        cell.paragraphs[0].runs[0].bold = True
        cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    # Datos
    for ri, item in enumerate(resultados):
        row = table.rows[ri + 1].cells
        row[0].text = str(item.get("variable",""))
        row[1].text = str(item.get("n_validos",""))
        row[2].text = f"{item.get('media', ''):.2f}" if isinstance(item.get("media"), float) else str(item.get("media",""))
        row[3].text = f"{item.get('desv_tipica', ''):.2f}" if isinstance(item.get("desv_tipica"), float) else ""
        row[4].text = f"{item.get('minimo', ''):.2f}"  if isinstance(item.get("minimo"), float) else ""
        row[5].text = f"{item.get('maximo', ''):.2f}"  if isinstance(item.get("maximo"), float) else ""
        row[6].text = f"{item.get('asimetria', ''):.2f}" if isinstance(item.get("asimetria"), float) else ""
        row[7].text = f"{item.get('curtosis', ''):.2f}"  if isinstance(item.get("curtosis"), float) else ""
        for cell in row:
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    _set_apa_table_borders(table)
    _add_table_note(doc, "M = media; DE = desviación estándar.")


def _render_correlaciones(doc, datos: dict):
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    variables = datos.get("variables", [])
    matriz_r  = datos.get("matriz_r", [])
    matriz_p  = datos.get("matriz_p", [])
    if not variables or not matriz_r:
        return

    n = len(variables)
    table = doc.add_table(rows=n+1, cols=n+1)

    # Encabezados
    table.rows[0].cells[0].text = ""
    for ci, v in enumerate(variables):
        cell = table.rows[0].cells[ci+1]
        cell.text = str(ci+1)
        cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        cell.paragraphs[0].runs[0].bold = True

    for ri, v in enumerate(variables):
        row = table.rows[ri+1]
        row.cells[0].text = f"{ri+1}. {v}"
        for ci in range(n):
            r_val = matriz_r[ri][ci] if ri < len(matriz_r) and ci < len(matriz_r[ri]) else ""
            p_val = matriz_p[ri][ci] if ri < len(matriz_p) and ci < len(matriz_p[ri]) else 1.0
            if ci >= ri:
                text = "—" if ci == ri else f"{r_val:.2f}{'*' if isinstance(p_val,float) and p_val<.05 else ''}{'*' if isinstance(p_val,float) and p_val<.01 else ''}"
            else:
                text = ""
            row.cells[ci+1].text = text
            row.cells[ci+1].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    _set_apa_table_borders(table)
    _add_table_note(doc, "* p < .05. ** p < .01.")


def _render_anova(doc, datos: dict):
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    headers = ["Fuente", "SS", "gl", "MS", "F", "p", "η²"]
    gl_b = datos.get("gl_between", datos.get("gl_factor",""))
    gl_w = datos.get("gl_within", datos.get("gl_error",""))

    rows_data = [
        ["Entre grupos", f"{datos.get('ss_between',''):.3f}" if isinstance(datos.get('ss_between'),float) else "",
         str(gl_b), f"{datos.get('ms_between',''):.3f}" if isinstance(datos.get('ms_between'),float) else "",
         f"{datos.get('f_stat',''):.3f}" if isinstance(datos.get('f_stat'),float) else "",
         f"{datos.get('p_value',''):.3f}" if isinstance(datos.get('p_value'),float) else "",
         f"{datos.get('eta2',''):.3f}" if isinstance(datos.get('eta2'),float) else ""],
        ["Intra grupos", f"{datos.get('ss_within',''):.3f}" if isinstance(datos.get('ss_within'),float) else "",
         str(gl_w), f"{datos.get('ms_within',''):.3f}" if isinstance(datos.get('ms_within'),float) else "",
         "", "", ""],
        ["Total", "", "", "", "", "", ""],
    ]

    table = doc.add_table(rows=len(rows_data)+1, cols=len(headers))
    for ci, h in enumerate(headers):
        cell = table.rows[0].cells[ci]
        cell.text = h
        cell.paragraphs[0].runs[0].bold = True
        cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    for ri, rd in enumerate(rows_data):
        for ci, val in enumerate(rd):
            table.rows[ri+1].cells[ci].text = str(val)
            table.rows[ri+1].cells[ci].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    _set_apa_table_borders(table)
    _add_table_note(doc, "SS = suma de cuadrados; gl = grados de libertad; MS = cuadrado medio; η² = eta-cuadrado.")


def _render_regresion(doc, datos: dict):
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    coefs = datos.get("coeficientes", [])
    if not coefs:
        return

    headers = ["Variable", "B", "SE", "β", "t", "p", "IC 95%"]
    table = doc.add_table(rows=len(coefs)+1, cols=len(headers))

    for ci, h in enumerate(headers):
        cell = table.rows[0].cells[ci]
        cell.text = h
        cell.paragraphs[0].runs[0].bold = True
        cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    for ri, c in enumerate(coefs):
        b   = f"{c.get('b',0):.3f}" if isinstance(c.get('b'),float) else str(c.get('b',''))
        se  = f"{c.get('se',0):.3f}" if isinstance(c.get('se'),float) else str(c.get('se',''))
        beta= f"{c.get('beta_std',0):.3f}" if isinstance(c.get('beta_std'),float) else ""
        t   = f"{c.get('t',0):.3f}" if isinstance(c.get('t'),float) else ""
        p   = f"{c.get('p_value',0):.3f}" if isinstance(c.get('p_value'),float) else ""
        lo  = c.get('ic_low')
        hi  = c.get('ic_high')
        ic  = f"[{lo:.3f}, {hi:.3f}]" if isinstance(lo,float) and isinstance(hi,float) else ""
        vals = [c.get('nombre',''), b, se, beta, t, p, ic]
        for ci2, v in enumerate(vals):
            table.rows[ri+1].cells[ci2].text = str(v)
            table.rows[ri+1].cells[ci2].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    r2 = datos.get("r2")
    r2_adj = datos.get("r2_ajustado")
    nota = f"B = coeficiente no estandarizado; SE = error estándar; β = coeficiente estandarizado."
    if r2 is not None:
        nota += f" R² = {r2:.3f}"
    if r2_adj is not None:
        nota += f", R²aj = {r2_adj:.3f}."
    _set_apa_table_borders(table)
    _add_table_note(doc, nota)


def _render_generico(doc, datos: dict, titulo: str):
    """Renderiza cualquier diccionario de resultados como tabla clave-valor."""
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    items = [(k, v) for k, v in datos.items()
             if isinstance(v, (int, float, str, bool)) and not k.startswith("_")]

    if not items:
        p = doc.add_paragraph("(Datos no tabulables en formato APA)")
        return

    table = doc.add_table(rows=len(items)+1, cols=2)
    table.rows[0].cells[0].text = "Estadístico"
    table.rows[0].cells[1].text = "Valor"
    for cell in table.rows[0].cells:
        cell.paragraphs[0].runs[0].bold = True

    for ri, (k, v) in enumerate(items):
        table.rows[ri+1].cells[0].text = str(k).replace("_"," ").capitalize()
        table.rows[ri+1].cells[1].text = f"{v:.4f}" if isinstance(v, float) else str(v)
        table.rows[ri+1].cells[1].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    _set_apa_table_borders(table)


RENDERERS = {
    "descriptivos":  _render_descriptivos,
    "correlaciones": _render_correlaciones,
    "anova":         _render_anova,
    "regresion":     _render_regresion,
}


@router.post("/apa")
def exportar_apa(req: ExportarAPARequest):
    try:
        from docx import Document
        from docx.shared import Pt, Inches
        from docx.enum.text import WD_ALIGN_PARAGRAPH
    except ImportError:
        raise HTTPException(500, "python-docx no instalado. Ejecuta: pip install python-docx")

    doc = _apa_document()

    # ── Portada ──────────────────────────────────────────────────────────
    p_titulo = doc.add_paragraph()
    p_titulo.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p_titulo.add_run(req.titulo_documento)
    run.bold = True
    run.font.size = Pt(14)

    if req.autor:
        p = doc.add_paragraph(req.autor)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER

    if req.institucion:
        p = doc.add_paragraph(req.institucion)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_paragraph()  # Espacio

    # ── Bloques de resultados ─────────────────────────────────────────────
    for i, bloque in enumerate(req.bloques):
        label = TIPO_LABELS.get(bloque.tipo, bloque.tipo.capitalize())
        titulo_tabla = bloque.titulo or f"Tabla {i+1}"
        subtitle = bloque.titulo or label

        # Número y título de tabla (APA: "Tabla N\nTítulo en cursiva")
        p_num = doc.add_paragraph(f"Tabla {i+1}")
        p_num.runs[0].bold = True

        p_subtit = doc.add_paragraph(subtitle)
        p_subtit.runs[0].italic = True

        # Renderizar según tipo
        renderer = RENDERERS.get(bloque.tipo)
        if renderer:
            renderer(doc, bloque.datos)
        else:
            _render_generico(doc, bloque.datos, subtitle)

        doc.add_paragraph()  # Espacio entre tablas

    # ── Nota general ─────────────────────────────────────────────────────
    if req.nota_general:
        _add_table_note(doc, req.nota_general)

    # ── Guardar ──────────────────────────────────────────────────────────
    try:
        doc.save(req.ruta_destino)
    except Exception as e:
        raise HTTPException(500, f"Error al guardar el documento: {e}")

    return {"ok": True, "ruta": req.ruta_destino, "tablas": len(req.bloques)}
