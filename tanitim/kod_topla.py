"""Projenin kaynak kodlarını tanıtım uygulamasına gömmek için kod.js dosyasını üretir.

tanitim_olustur.bat tarafından exe derlenmeden önce çalıştırılır; böylece sunumdaki
"Kaynak kod" bölümü her zaman projenin güncel kodunu gösterir.
"""
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "kod.js"

GROUPS = [
    ("Masaüstü uygulaması", ["backend/desktop_app.py", "backend/run_desktop.py", "backend/desktop_notify.py", "backend/brand.py"]),
    ("Arka uç (FastAPI)", sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "backend/app").glob("*.py") if p.name != "__init__.py")),
    ("Arayüz: çekirdek", sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "frontend/src").glob("*.ts*"))),
    ("Arayüz: sayfalar", sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "frontend/src/pages").glob("*.tsx"))),
    ("Arayüz: bileşenler", sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "frontend/src/components").glob("*.tsx"))),
    ("Yapılandırma ve derleme", ["backend/requirements.txt", "frontend/package.json", "exe_olustur.bat", "baslat.bat"]),
]

# Arayüz dosyalarında docstring olmadığı için kısa açıklamalar
FRONT_DESC = {
    "App.tsx": "Uygulama iskeleti: oturum kontrolü, yan menü, sayfa yönlendirmeleri (react-router).",
    "api.ts": "Tüm API isteklerinin geçtiği katman: JWT ekleme, 401'de oturumu kapatma, hata yönetimi, sayı biçimlendirme.",
    "main.tsx": "React uygulamasının başlangıç noktası (DOM'a bağlama).",
    "nav.ts": "Yan menüdeki sayfa listesi ve grupları.",
    "prefs.ts": "Kullanıcı tercihlerinin sunucuyla eşitlenmesi.",
    "refresh.ts": "Otomatik veri yenileme zamanlayıcısı.",
    "theme.ts": "Açık / koyu tema yönetimi.",
    "errors.ts": "Hata mesajlarının Türkçeleştirilmesi.",
    "Analysis.tsx": "Teknik Analiz sayfası: mum grafiği, göstergeler, formasyonlar, sinyal özeti.",
    "Prediction.tsx": "YZ Tahmin sayfası: model karşılaştırması, öznitelik önemleri, tahmin grafiği.",
    "Dashboard.tsx": "Piyasa Özeti (ana sayfa): piyasalar, favoriler, günün bülteni.",
    "Portfolio.tsx": "Portföy: pozisyonlar, kâr/zarar, dağılım, işlem geçmişi.",
    "Backtest.tsx": "Strateji testi: geçmiş veride strateji deneme ve sonuç grafikleri.",
    "Bots.tsx": "Otomatik strateji botları yönetimi.",
    "Screener.tsx": "Teknik tarama ekranı ve filtreler.",
    "Kap.tsx": "KAP bildirimleri listesi.",
    "Ipo.tsx": "Halka arz ve sermaye artırımı takibi.",
    "News.tsx": "Haberler ve duygu analizi.",
    "Login.tsx": "Giriş, kayıt, misafir girişi ve şifre sıfırlama ekranı.",
    "Settings.tsx": "Ayarlar: tema, Claude API anahtarı, bildirimler, yedekleme.",
    "Market.tsx": "Piyasa sayfaları (BIST, ABD, döviz, kripto).",
    "Compare.tsx": "Varlık karşılaştırma: normalize getiri, korelasyon.",
    "Fundamentals.tsx": "Temel analiz: oranlar, finansallar, temettü.",
    "Watchlist.tsx": "İzleme listesi ve fiyat alarmları.",
    "Calendar.tsx": "Ekonomik takvim.",
    "Bulletin.tsx": "Günlük piyasa bülteni.",
    "Heatmap.tsx": "Piyasa ısı haritası.",
    "Sectors.tsx": "Sektör performansları.",
    "Academy.tsx": "Yatırım akademisi: dersler ve mini testler.",
    "Game.tsx": "Haftalık tahmin oyunu.",
    "Lab.tsx": "Nicel analiz laboratuvarı: etkin sınır, Monte Carlo.",
    "TimeTravel.tsx": "Zaman makinesi: geçmişte yatırsaydım ne olurdu?",
    "MultiChart.tsx": "Çoklu grafik görünümü.",
    "Dividends.tsx": "Temettü takvimi.",
    "Achievements.tsx": "Başarı rozetleri ve aylık karne.",
    "Profile.tsx": "Profil ve hesap güvenliği.",
    "Widget.tsx": "Mini pencere (widget) görünümü.",
    "Chart.tsx": "Lightweight Charts ile mum grafiği ve gösterge panelleri.",
    "TradePanel.tsx": "Sanal alım/satım ve emir paneli.",
    "QuickSearch.tsx": "Ctrl+K hızlı arama.",
    "StockCard.tsx": "Hisse kartı: özet bilgiler ve 'bugün neden hareket etti?'.",
    "Markdown.tsx": "LLM yanıtlarını biçimlendiren basit Markdown görüntüleyici.",
    "Term.tsx": "Finans terimleri için açıklama ipuçları.",
    "auth.tsx": "Oturum bağlamı (React context).",
    "common.tsx": "Ortak bileşenler: hata kutusu, boş durum, mini grafik.",
    "ui.tsx": "Arayüz yapı taşları: iskelet yükleme, canlı fiyat, ağaç haritası.",
    "extras.tsx": "Yardımcı bileşenler.",
    "fx.tsx": "Animasyon ve görsel efektler.",
    "Tabs.tsx": "Sekme bileşeni.",
    "Logo.tsx": "Uygulama logosu.",
    "GuestUpgrade.tsx": "Misafir hesabını gerçek hesaba yükseltme.",
    "PortfolioPlus.tsx": "Portföy ek analizleri (sağlık skoru, hedefler).",
}
OTHER_DESC = {
    "requirements.txt": "Python bağımlılıkları.",
    "package.json": "Arayüz bağımlılıkları ve npm betikleri.",
    "exe_olustur.bat": "Arayüzü derleyip PyInstaller ile TradeMetrix.exe'yi üreten betik.",
    "baslat.bat": "Uygulamayı kaynak koddan çalıştıran betik.",
}

LANG = {".py": "py", ".ts": "ts", ".tsx": "ts", ".json": "json", ".bat": "bat", ".txt": "txt"}
SYM_TS = re.compile(r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|const|type)\s+([A-Za-z_]\w*)", re.M)


def py_info(text: str):
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return "", []
    doc = (ast.get_docstring(tree) or "").split("\n\n")[0].replace("\n", " ")
    syms = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            route = ""
            for d in getattr(node, "decorator_list", []):
                if isinstance(d, ast.Call) and getattr(d.func, "attr", "") in ("get", "post", "put", "delete", "patch") and d.args \
                        and isinstance(d.args[0], ast.Constant):
                    route = f"{d.func.attr.upper()} {d.args[0].value}"
            syms.append({"name": node.name, "line": node.lineno, "kind": "class" if isinstance(node, ast.ClassDef) else "def",
                         "route": route})
    return doc, syms


def ts_info(text: str):
    syms = []
    for m in SYM_TS.finditer(text):
        if m.group(1) == "const" and not re.match(r"\s*=\s*(?:\(|async|use|memo|\w+\s*=>)", text[m.end():m.end() + 30]):
            continue
        syms.append({"name": m.group(2), "line": text.count("\n", 0, m.start()) + 1, "kind": m.group(1), "route": ""})
    return syms


def parse_schema(text: str) -> list[dict]:
    """db.py içindeki CREATE TABLE ifadelerini ve sonradan eklenen sütunları (_add_columns) okur."""
    tables = []
    for m in re.finditer(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\);", text.split("def _migrate_alerts")[0], re.S):
        cols, pk, fks = [], set(), {}
        body = re.sub(r"\s+", " ", m.group(2))
        parts, depth, cur = [], 0, ""
        for ch in body:  # parantez içindeki virgüllerde bölmemek için elle ayrıştırılır
            depth += ch == "("
            depth -= ch == ")"
            if ch == "," and depth == 0:
                parts.append(cur.strip())
                cur = ""
            else:
                cur += ch
        parts.append(cur.strip())
        for p in parts:
            if p.upper().startswith("PRIMARY KEY"):
                pk |= {c.strip() for c in re.search(r"\((.*)\)", p).group(1).split(",")}
            elif p.upper().startswith(("UNIQUE", "CHECK")):
                continue
            else:
                name, typ = p.split()[0], (p.split() + ["", ""])[1]
                if "PRIMARY KEY" in p.upper():
                    pk.add(name)
                ref = re.search(r"REFERENCES (\w+)", p)
                if ref:
                    fks[name] = ref.group(1)
                cols.append({"name": name, "type": typ})
        tables.append({"table": m.group(1), "columns": cols, "pk": sorted(pk), "fk": fks})
    by_name = {t["table"]: t for t in tables}
    for m in re.finditer(r'_add_columns\(con, "(\w+)", \{(.*?)\}\)', text, re.S):
        for name, ddl in re.findall(r'"(\w+)": "(\w+)', m.group(2)):
            by_name[m.group(1)]["columns"].append({"name": name, "type": ddl, "added": True})
    return tables


API_CALL = re.compile(r"api(?:<[^>()]*(?:<[^>]*>)?[^>()]*>)?\(\s*[`'\"](/[^`'\"]*)")


def norm_front(path: str) -> str:
    path = re.split(r"\?|(?<!/)\$\{", path)[0]
    return re.sub(r"\$\{[^}]*\}", "{}", path).rstrip("/") or "/"


def norm_back(path: str) -> str:
    return re.sub(r"\{[^}]*\}", "{}", path[4:] if path.startswith("/api") else path).rstrip("/") or "/"


def parse_routes(main_text: str) -> list[dict]:
    tree = ast.parse(main_text)
    local = {a.name for n in tree.body if isinstance(n, ast.ImportFrom) and n.module is None and n.level == 1 for a in n.names}
    helpers = {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

    def mods_of(fn, seen=()):
        found = set()
        for sub in (x for stmt in fn.body for x in ast.walk(stmt)):  # parametrelerdeki Depends(auth...) sayılmaz
            if isinstance(sub, ast.Attribute) and isinstance(sub.value, ast.Name) and sub.value.id in local:
                found.add(sub.value.id)
            elif isinstance(sub, ast.Name) and sub.id in helpers and sub.id not in seen and sub.id != fn.name:
                found |= mods_of(helpers[sub.id], seen + (fn.name,))  # main.py içindeki yardımcı fonksiyonlar
            elif isinstance(sub, ast.Name) and sub.id == "connect":
                found.add("db")  # doğrudan SQL sorgusu
        return found
    routes = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for d in node.decorator_list:
            if isinstance(d, ast.Call) and getattr(d.func, "attr", "") in ("get", "post", "put", "delete", "patch") \
                    and d.args and isinstance(d.args[0], ast.Constant):
                path = d.args[0].value
                if not path.startswith("/api"):
                    continue
                needs_auth = "current_user" in ast.unparse(node.args)
                routes.append({"method": d.func.attr.upper(), "path": path, "func": node.name, "line": node.lineno,
                               "auth": needs_auth, "doc": (ast.get_docstring(node) or "").split("\n")[0],
                               "key": norm_back(path), "used_by": [],
                               "mods": sorted(mods_of(node))})
    return routes


def match_routes(front: str, routes: list[dict]) -> list[dict]:
    fs = front.split("/")
    out = []
    for r in routes:
        bs = r["key"].split("/")
        if len(bs) == len(fs) and all(a == b or a == "{}" or b == "{}" for a, b in zip(bs, fs)):
            out.append(r)
    return out


def parse_pages(nav_text: str, app_text: str, src: Path, routes: list[dict]) -> list[dict]:
    imports = dict(re.findall(r"import (\w+) from '\./pages/(\w+)'", app_text))
    route_comp = dict(re.findall(r'<Route path="([^"]+)" element=\{<(\w+)', app_text))
    pages = []
    for sec in re.finditer(r"\{ id: '(\w+)', label: '([^']+)', icon: '([^']+)'.*?pages: \[(.*?)\] \}", nav_text, re.S):
        for pm in re.finditer(r"\{ to: '([^']+)', label: '([^']+)', icon: '([^']+)', desc: '((?:[^'\\]|\\.)*)'(, advanced: true)?", sec.group(4)):
            to, label, icon, desc, adv = pm.groups()
            comp = route_comp.get(to)
            fname = imports.get(comp, comp)
            rel = f"frontend/src/pages/{fname}.tsx" if fname else None
            calls = set()
            if rel and (src.parent.parent / rel).exists():
                text = (src.parent.parent / rel).read_text(encoding="utf-8")
                files = [text] + [(src / "components" / f"{c}.tsx").read_text(encoding="utf-8")
                                  for c in set(re.findall(r"from '\.\./components/(\w+)'", text))
                                  if (src / "components" / f"{c}.tsx").exists()]
                for t in files:
                    calls |= {norm_front(p) for p in API_CALL.findall(t)}
            apis = []
            for c in sorted(calls):
                matched = match_routes(c, routes)
                for r in matched:
                    if label not in r["used_by"]:
                        r["used_by"].append(label)
                apis.append({"path": c, "routes": [f"{r['method']} {r['path']}" for r in matched]})
            pages.append({"section": sec.group(2), "section_icon": sec.group(3), "to": to, "label": label, "icon": icon,
                          "desc": desc.replace("\\'", "'"), "advanced": bool(adv), "file": rel, "apis": apis})
    return pages


def main():
    files, total = [], 0
    for group, paths in GROUPS:
        for rel in paths:
            p = ROOT / rel
            if not p.exists():
                continue
            text = p.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")
            lang = LANG.get(p.suffix, "txt")
            if lang == "py":
                desc, syms = py_info(text)
            elif lang == "ts":
                desc, syms = FRONT_DESC.get(p.name, ""), ts_info(text)
            else:
                desc, syms = OTHER_DESC.get(p.name, ""), []
            lines = text.count("\n") + 1
            total += lines
            files.append({"path": rel, "group": group, "lang": lang, "lines": lines, "desc": desc, "syms": syms, "code": text})
    read = lambda rel: (ROOT / rel).read_text(encoding="utf-8")  # noqa: E731
    routes = parse_routes(read("backend/app/main.py"))
    pages = parse_pages(read("frontend/src/nav.ts"), read("frontend/src/App.tsx"), ROOT / "frontend/src", routes)
    for f in files:  # her uç noktayı çağıran arayüz dosyaları
        if f["path"].startswith("frontend/src") and f["lang"] == "ts":
            for c in {norm_front(p) for p in API_CALL.findall(f["code"])}:
                for r in match_routes(c, routes):
                    r.setdefault("files", [])
                    if f["path"] not in r["files"]:
                        r["files"].append(f["path"])
    schema = parse_schema(read("backend/app/db.py"))
    data = {"files": files, "total": total, "routes": routes, "pages": pages, "schema": schema}
    OUT.write_text("window.KOD = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"{len(files)} dosya, {total} satır, {len(routes)} uç nokta, {len(pages)} sayfa, {len(schema)} tablo "
          f"-> {OUT.name} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
