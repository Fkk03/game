#!/usr/bin/env python3
"""Post-process the openpyxl-written workbook so _xll.BQL array formulas are
stored exactly as Excel 365 stores dynamic-array formulas (cm/aca/ca attributes
plus xl/metadata.xml XLDAPR record) — replicating the user's reference file.
Without this, Excel treats them as legacy single-cell CSE arrays and the
16-column spills would show only their first value."""
import re, shutil, sys, zipfile

SRC = "Earnings_Sector_Comp.xlsx"
DST = sys.argv[1] if len(sys.argv) > 1 else SRC

METADATA_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
    '<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    'xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">'
    '<metadataTypes count="1">'
    '<metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" '
    'pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" '
    'clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes>'
    '<futureMetadata name="XLDAPR" count="1"><bk><extLst>'
    '<ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}">'
    '<xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk>'
    '</futureMetadata>'
    '<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>'
)

zin = zipfile.ZipFile(SRC)
names = zin.namelist()
out = {}
touched = 0

cell_re = re.compile(
    r'<c r="([A-Z]+\d+)"([^>]*)><f t="array" ref="([A-Z0-9:]+)">([^<]*_xll\.BQL[^<]*)</f>(<v ?/>|<v></v>)?</c>')

def fix_cell(m):
    global touched
    coord, attrs, ref, formula, _v = m.groups()
    touched += 1
    return (f'<c r="{coord}"{attrs} cm="1">'
            f'<f t="array" aca="1" ref="{ref}" ca="1">{formula}</f><v/></c>')

for name in names:
    data = zin.read(name)
    if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"):
        text = data.decode("utf-8")
        text = cell_re.sub(fix_cell, text)
        data = text.encode("utf-8")
    elif name == "[Content_Types].xml":
        text = data.decode("utf-8")
        if "metadata.xml" not in text:
            text = text.replace(
                "</Types>",
                '<Override PartName="/xl/metadata.xml" ContentType="application/'
                'vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/></Types>')
        data = text.encode("utf-8")
    elif name == "xl/_rels/workbook.xml.rels":
        text = data.decode("utf-8")
        ids = [int(x) for x in re.findall(r'Id="rId(\d+)"', text)]
        rid = max(ids) + 1
        if "sheetMetadata" not in text:
            text = text.replace(
                "</Relationships>",
                f'<Relationship Id="rId{rid}" Type="http://schemas.openxmlformats.org/'
                f'officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/>'
                f'</Relationships>')
        data = text.encode("utf-8")
    out[name] = data
zin.close()
out["xl/metadata.xml"] = METADATA_XML.encode("utf-8")

with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in out.items():
        z.writestr(name, data)
print(f"dynamic-array formulas patched: {touched}; wrote {DST}")
assert touched > 0, "no BQL array formulas found!"
