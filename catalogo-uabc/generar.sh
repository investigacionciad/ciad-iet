#!/bin/sh
# Regenera uabc.json ({campus:{unidad:[programas]}}) desde el buscador de uabc.mx (oferta de licenciatura).
# Luego se pega el contenido en UABC_OFERTA de la página "Solicitud de Articulo" en Blogger.
set -e
API=https://www.uabc.mx/wp-content/uabc/includes/uabc_api.php
REF="Referer: https://www.uabc.mx/oferta-educativa-programas-de-licenciatura/"
T=$(mktemp -d)
curl -s -X POST "$API" -H "$REF" --data "func_accion=getUnidadesAcademicasHtml&idioma=es&ids_campus=1,2,3&agrupar_unidades=3" -o "$T/u.html"
curl -s -X POST "$API" -H "$REF" --data "func_accion=getBuscarProgramasEdLicenciaturaHtml&idioma=es&ids_campus=1,2,3&ids_niveles=1&ids_areas_edu=1,2,3,4,5,6,7&ids_unidades=&palabra_clave=" -o "$T/p.html"
python3 -I - "$T" <<'PY' > "$(dirname "$0")/uabc.json"
import re,html,json,sys
d=sys.argv[1]; u=open(d+'/u.html',encoding='utf8').read(); p=open(d+'/p.html',encoding='utf8').read()
cl=lambda s:re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>','',s))).replace('\u200b','').strip()
U={}
for c,b in re.findall(r'<optgroup label="([^"]+)">(.*?)</optgroup>',u,re.S):
    U[c]={cl(n):set() for n in re.findall(r"<option value='\d+'>(.*?)</option>",b)}
for c,a,un,pr in re.findall(r'<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>',p,re.S):
    U.setdefault(cl(c),{}).setdefault(cl(un),set()).add(cl(pr))
assert sum(len(v) for x in U.values() for v in x.values())>100, 'respuesta incompleta de uabc.mx'
print(json.dumps({c:{k:sorted(v) for k,v in sorted(x.items())} for c,x in U.items()},ensure_ascii=False,separators=(',',':')))
PY
rm -rf "$T"; echo "uabc.json actualizado"
