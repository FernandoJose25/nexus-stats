"""
Exportación de resultados a PDF y Excel.
Recibe los resultados ya calculados desde el frontend para evitar recalcular.
"""
import io
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter()


class ExportarPDFRequest(BaseModel):
    resultados: list[dict[str, Any]]
    titulo: str = "Resultados Nexus Stats"
    ruta_destino: str


class ExportarExcelRequest(BaseModel):
    resultados: list[dict[str, Any]]
    ruta_destino: str


@router.post("/pdf")
def exportar_pdf(req: ExportarPDFRequest):
    """Genera un PDF con los resultados estadísticos y lo guarda en la ruta indicada."""
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

        doc = SimpleDocTemplate(
            req.ruta_destino,
            pagesize=A4,
            leftMargin=2 * cm,
            rightMargin=2 * cm,
            topMargin=2 * cm,
            bottomMargin=2 * cm,
        )

        styles = getSampleStyleSheet()
        story = []

        # Título
        title_style = ParagraphStyle("Title", parent=styles["Title"], fontSize=18, spaceAfter=20)
        story.append(Paragraph(req.titulo, title_style))
        story.append(Spacer(1, 0.5 * cm))

        for bloque in req.resultados:
            var = bloque.get("variable", "")
            story.append(Paragraph(f"Variable: {var}", styles["Heading2"]))
            story.append(Spacer(1, 0.2 * cm))

            # Tabla de estadísticos
            campos = [
                ("N válidos", bloque.get("n_validos")),
                ("N perdidos", bloque.get("n_perdidos")),
                ("Media", bloque.get("media")),
                ("Error estándar media", bloque.get("error_estandar_media")),
                ("Mediana", bloque.get("mediana")),
                ("Desv. típica", bloque.get("desv_tipica")),
                ("Varianza", bloque.get("varianza")),
                ("Asimetría", bloque.get("asimetria")),
                ("Curtosis", bloque.get("curtosis")),
                ("Mínimo", bloque.get("minimo")),
                ("Máximo", bloque.get("maximo")),
                ("Rango", bloque.get("rango")),
            ]

            table_data = [["Estadístico", "Valor"]]
            for label, val in campos:
                if val is not None:
                    table_data.append([label, str(val)])

            t = Table(table_data, colWidths=[8 * cm, 6 * cm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A5F")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#F8FAFC"), colors.white]),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("PADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 0.8 * cm))

        doc.build(story)
        return {"ok": True, "ruta": req.ruta_destino}

    except ImportError:
        raise HTTPException(500, "reportlab no está instalado. Ejecuta: pip install reportlab")
    except Exception as e:
        raise HTTPException(500, detail=f"Error al generar PDF: {e}")


@router.post("/excel")
def exportar_excel(req: ExportarExcelRequest):
    """Exporta los resultados estadísticos a un archivo Excel (.xlsx)."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Resultados"

        header_fill = PatternFill("solid", fgColor="1E3A5F")
        header_font = Font(bold=True, color="FFFFFF")
        alt_fill = PatternFill("solid", fgColor="F1F5F9")

        row = 1
        for bloque in req.resultados:
            var = bloque.get("variable", "")

            # Encabezado de variable
            cell = ws.cell(row=row, column=1, value=f"Variable: {var}")
            cell.font = Font(bold=True, size=12)
            row += 1

            # Headers de tabla
            headers = ["Estadístico", "Valor"]
            for col, h in enumerate(headers, 1):
                c = ws.cell(row=row, column=col, value=h)
                c.fill = header_fill
                c.font = header_font
                c.alignment = Alignment(horizontal="center")
            row += 1

            campos = [
                ("N válidos", bloque.get("n_validos")),
                ("N perdidos", bloque.get("n_perdidos")),
                ("Media", bloque.get("media")),
                ("Error estándar (media)", bloque.get("error_estandar_media")),
                ("Mediana", bloque.get("mediana")),
                ("Desv. típica", bloque.get("desv_tipica")),
                ("Varianza", bloque.get("varianza")),
                ("Asimetría", bloque.get("asimetria")),
                ("E.E. asimetría", bloque.get("error_estandar_asimetria")),
                ("Curtosis", bloque.get("curtosis")),
                ("E.E. curtosis", bloque.get("error_estandar_curtosis")),
                ("Mínimo", bloque.get("minimo")),
                ("Máximo", bloque.get("maximo")),
                ("Rango", bloque.get("rango")),
                ("Suma", bloque.get("suma")),
                ("IQR (P75-P25)", bloque.get("iqr")),
            ]

            for i, (label, val) in enumerate(campos):
                if val is None:
                    continue
                fill = alt_fill if i % 2 == 0 else PatternFill()
                c1 = ws.cell(row=row, column=1, value=label)
                c2 = ws.cell(row=row, column=2, value=val)
                c1.fill = fill
                c2.fill = fill
                row += 1

            row += 2  # Espacio entre variables

        # Ajustar anchos
        ws.column_dimensions["A"].width = 28
        ws.column_dimensions["B"].width = 16

        wb.save(req.ruta_destino)
        return {"ok": True, "ruta": req.ruta_destino}

    except Exception as e:
        raise HTTPException(500, detail=f"Error al generar Excel: {e}")
