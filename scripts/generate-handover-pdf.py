from pathlib import Path
import re
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs' / 'MAYA_SYSTEM_HANDOVER.md'
OUTPUT = ROOT / 'docs' / 'Maya-Steel-Works-System-Handover.pdf'

BLUE = colors.HexColor('#173A68')
BLUE2 = colors.HexColor('#244F83')
TEXT = colors.HexColor('#3D4858')
MUTED = colors.HexColor('#6B7585')
LINE = colors.HexColor('#CED7E2')
LIGHT = colors.HexColor('#F5F8FC')
CODE_BG = colors.HexColor('#101820')

styles = getSampleStyleSheet()
body = ParagraphStyle('BodyMaya', parent=styles['BodyText'], fontName='Helvetica', fontSize=8.5, leading=10.5, textColor=TEXT, spaceAfter=3.5)
h1 = ParagraphStyle('H1Maya', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=16, leading=19, textColor=BLUE, spaceBefore=8, spaceAfter=5)
h2 = ParagraphStyle('H2Maya', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=11.5, leading=14, textColor=BLUE2, spaceBefore=6, spaceAfter=3)
h3 = ParagraphStyle('H3Maya', parent=styles['Heading3'], fontName='Helvetica-Bold', fontSize=9.5, leading=11.5, textColor=colors.HexColor('#3A5E88'), spaceBefore=4, spaceAfter=2)
title = ParagraphStyle('TitleMaya', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=26, leading=29, textColor=BLUE, alignment=TA_CENTER, spaceAfter=8)
subtitle = ParagraphStyle('SubtitleMaya', parent=body, fontName='Helvetica-Bold', fontSize=12.5, leading=15, textColor=colors.HexColor('#303B4A'), alignment=TA_CENTER, spaceAfter=8)
small = ParagraphStyle('SmallMaya', parent=body, fontSize=7.2, leading=8.5, textColor=MUTED)
bullet = ParagraphStyle('BulletMaya', parent=body, leftIndent=12, firstLineIndent=-6, bulletIndent=4, spaceAfter=2.3)
number = ParagraphStyle('NumberMaya', parent=body, leftIndent=15, firstLineIndent=-10, bulletIndent=4, spaceAfter=2.3)
code = ParagraphStyle('CodeMaya', parent=body, fontName='Courier', fontSize=7.1, leading=8.7, textColor=colors.white, backColor=CODE_BG, leftIndent=5, rightIndent=5, borderPadding=6, spaceBefore=4, spaceAfter=5)
quote = ParagraphStyle('QuoteMaya', parent=body, leftIndent=10, rightIndent=8, borderColor=colors.HexColor('#D9B66F'), borderWidth=0.6, borderPadding=6, backColor=colors.HexColor('#FFF7E8'), textColor=colors.HexColor('#5A4A2F'), spaceBefore=3, spaceAfter=5)


def esc(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def inline(text):
    text = esc(text)
    text = re.sub(r'`([^`]+)`', r'<font name="Courier">\1</font>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)
    return text


def footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(MUTED)
    canvas.setFont('Helvetica', 6.5)
    canvas.drawRightString(width - 15 * mm, height - 9 * mm, 'MAYA STEEL WORKS MANAGEMENT SYSTEM | PROJECT HANDOVER')
    canvas.drawCentredString(width / 2, 8 * mm, f'Internal project context | Page {doc.page}')
    canvas.restoreState()


def parse_table(lines):
    rows = []
    for line in lines:
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if all(re.fullmatch(r':?-{3,}:?', c or '') for c in cells):
            continue
        rows.append([Paragraph(inline(c), small) for c in cells])
    if not rows:
        return None
    widths = None
    if len(rows[0]) == 2:
        widths = [52 * mm, 128 * mm]
    table = Table(rows, colWidths=widths, repeatRows=1, hAlign='CENTER')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.3, LINE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT]),
    ]))
    return table


lines = SOURCE.read_text(encoding='utf-8').splitlines()
story = []
i = 0
first_title = True
while i < len(lines):
    raw = lines[i].rstrip()
    stripped = raw.strip()

    if not stripped or stripped == '---':
        i += 1
        continue

    if stripped.startswith('```'):
        block = []
        i += 1
        while i < len(lines) and not lines[i].strip().startswith('```'):
            block.append(lines[i])
            i += 1
        i += 1
        story.append(Paragraph(esc('\n'.join(block)).replace('\n', '<br/>'), code))
        continue

    if stripped.startswith('|') and i + 1 < len(lines) and lines[i + 1].strip().startswith('|'):
        table_lines = []
        while i < len(lines) and lines[i].strip().startswith('|'):
            table_lines.append(lines[i])
            i += 1
        table = parse_table(table_lines)
        if table:
            story.append(table)
            story.append(Spacer(1, 4))
        continue

    if stripped.startswith('# '):
        text = stripped[2:].strip()
        story.append(Paragraph(inline(text), title if first_title else h1))
        first_title = False
        i += 1
        continue

    if stripped.startswith('## '):
        text = stripped[3:].strip()
        if text == 'Complete Project Handover and Development Context':
            story.append(Paragraph(inline(text), subtitle))
        else:
            story.append(Paragraph(inline(text), h1))
        i += 1
        continue

    if stripped.startswith('### '):
        story.append(Paragraph(inline(stripped[4:].strip()), h2))
        i += 1
        continue

    if stripped.startswith('#### '):
        story.append(Paragraph(inline(stripped[5:].strip()), h3))
        i += 1
        continue

    if stripped.startswith('> '):
        story.append(Paragraph(inline(stripped[2:].strip()), quote))
        i += 1
        continue

    if re.match(r'^- \[[ xX]\] ', stripped):
        mark = '&#9745;' if '[x]' in stripped.lower() else '&#9744;'
        text = re.sub(r'^- \[[ xX]\] ', '', stripped)
        story.append(Paragraph(f'{mark} {inline(text)}', bullet))
        i += 1
        continue

    if stripped.startswith('- '):
        story.append(Paragraph('&bull; ' + inline(stripped[2:].strip()), bullet))
        i += 1
        continue

    m = re.match(r'^(\d+)\.\s+(.*)$', stripped)
    if m:
        story.append(Paragraph(f'{m.group(1)}. {inline(m.group(2))}', number))
        i += 1
        continue

    # Gather a normal paragraph until the next structural line.
    parts = [stripped]
    i += 1
    while i < len(lines):
        nxt = lines[i].strip()
        if (not nxt or nxt == '---' or nxt.startswith('#') or nxt.startswith('```') or nxt.startswith('|') or nxt.startswith('> ') or nxt.startswith('- ') or re.match(r'^\d+\.\s+', nxt)):
            break
        parts.append(nxt)
        i += 1
    story.append(Paragraph(inline(' '.join(parts)), body))

pdf = SimpleDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    rightMargin=15 * mm,
    leftMargin=15 * mm,
    topMargin=14 * mm,
    bottomMargin=14 * mm,
    title='Maya Steel Works Management System - Project Handover',
    author='Maya Steel Works',
)
pdf.build(story, onFirstPage=footer, onLaterPages=footer)
print(f'Generated {OUTPUT}')
