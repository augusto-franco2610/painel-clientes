import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot,
  addDoc, getDocs, orderBy, serverTimestamp, writeBatch, increment }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAIL } from "./config.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

const ETAPAS = ["Iniciados", "Conversando", "Negociando", "Vendido", "Descartados"];
const MOTIVOS = ["Sem resposta", "Sem interesse", "Não tem renda", "Parou de interagir", "Só pesquisando",
  "Inválido", "Já comprou", "Outros"];
const PRODUTOS_BASE = ["Gran Vic Niagara", "Gran Vic Nexus", "Brisas do Japi", "Smart Apê Medeiros",
  "Villagio dos Eucaliptos - Emccamp", "Produtos Minha Casa Minha Vida"];

const S = {
  me: null, profile: null, admin: false,
  leads: [], users: [], produtos: [...PRODUTOS_BASE],
  view: "dash", shown: 60, selMode: false, sel: new Set(),
  charts: {}, unsub: [], importRows: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const clean = (s) => (s == null ? "" : String(s).trim());
const toDate = (v) => {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(String(v).replace(" ", "T"));
  return isNaN(d) ? null : d;
};
const fmtDate = (v, withTime) => {
  const d = toDate(v); if (!d) return "—";
  return withTime ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : d.toLocaleDateString("pt-BR");
};
const fmtPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p || "—";
};
const waLink = (p) => {
  let d = String(p || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length <= 11) d = "55" + d;
  return `https://wa.me/${d}`;
};
const initials = (n) => {
  const p = clean(n).split(/\s+/).filter(Boolean);
  const first = (w) => (Array.from(w || "").find((ch) => /[\p{L}\p{N}]/u.test(ch)) || "");
  const ini = (first(p[0]) + (p.length > 1 ? first(p[p.length - 1]) : "")).toUpperCase();
  return /^[A-ZÀ-Ý0-9]{1,2}$/.test(ini) ? ini : (ini ? "•" : "?");
};
const icon = (n, cls = "i") => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const userName = (email) => S.users.find((u) => u.id === email)?.nome || email || "—";

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 2800);
}

/* ---------------- AUTENTICAÇÃO ---------------- */
$("btnLogin").onclick = async () => {
  $("loginMsg").textContent = "";
  if (String(firebaseConfig.apiKey).includes("COLE_AQUI")) {
    $("loginMsg").textContent = "Falta colar a configuração do Firebase no arquivo config.js.";
    return;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== "auth/popup-closed-by-user") {
      $("loginMsg").textContent = "Não foi possível entrar: " + (e.code || e.message);
    }
  }
};
$("btnLogout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  S.unsub.forEach((u) => u()); S.unsub = [];
  if (!user) { $("app").classList.add("hidden"); $("login").classList.remove("hidden"); return; }
  const email = (user.email || "").toLowerCase();
  S.me = { email, nome: user.displayName || email, foto: user.photoURL };
  try {
    if (email === ADMIN_EMAIL) {
      S.admin = true;
      await setDoc(doc(db, "users", email), { nome: S.me.nome, papel: "admin", ativo: true, dono: true }, { merge: true });
    } else {
      const snap = await getDoc(doc(db, "users", email));
      if (!snap.exists() || !snap.data().ativo) throw new Error("sem-acesso");
      S.profile = snap.data();
      S.admin = S.profile.papel === "admin";
    }
  } catch (e) {
    $("loginMsg").textContent = `A conta ${email} não tem acesso a este painel. Peça ao administrador para liberar.`;
    await signOut(auth); return;
  }
  $("login").classList.add("hidden"); $("app").classList.remove("hidden");
  $("whoName").textContent = S.me.nome;
  if (S.me.foto) { $("avatar").referrerPolicy = "no-referrer"; $("avatar").src = S.me.foto; }
  else $("avatar").outerHTML = `<span class="ini" id="avatar">${initials(S.me.nome)}</span>`;
  document.querySelectorAll(".adm").forEach((el) => el.classList.toggle("hidden", !S.admin));
  startListeners();
});

function startListeners() {
  $("loadingBar").classList.remove("hidden");
  const col = collection(db, "leads");
  const queries = S.admin ? [["todos", col]] : [["meus", query(col, where("responsavel", "==", S.me.email))]];
  if (!S.admin && S.profile?.papel === "gestor") {
    (S.profile.corretores || []).forEach((c) => queries.push(["c:" + c, query(col, where("corretor", "==", c))]));
  }
  const parts = new Map();
  let pendentes = queries.length;
  queries.forEach(([key, q]) => {
    let first = true;
    S.unsub.push(onSnapshot(q, (snap) => {
      parts.set(key, snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      const all = new Map();
      parts.forEach((arr) => arr.forEach((l) => all.set(l.id, l)));
      S.leads = [...all.values()];
      if (first) { first = false; if (--pendentes <= 0) $("loadingBar").classList.add("hidden"); }
      refreshAll();
    }, (e) => { $("loadingBar").classList.add("hidden"); toast("Erro ao carregar clientes: " + e.code); }));
  });

  S.unsub.push(onSnapshot(doc(db, "config", "listas"), (snap) => {
    const p = snap.exists() ? snap.data().produtos || [] : [];
    S.produtos = [...new Set([...PRODUTOS_BASE, ...p])];
    refreshAll();
  }, () => {}));

  if (S.admin) {
    S.unsub.push(onSnapshot(collection(db, "users"), (snap) => {
      S.users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      refreshAll();
    }));
  } else {
    S.users = [{ id: S.me.email, ...S.profile }];
  }
}

/* ---------------- NAVEGAÇÃO ---------------- */
$("tabs").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  S.view = b.dataset.v;
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  ["dash", "clientes", "equipe", "importar"].forEach((v) => $("v-" + v).classList.toggle("hidden", v !== S.view));
  window.scrollTo({ top: 0 });
  refreshAll();
};

function uniq(field) {
  return [...new Set(S.leads.map((l) => clean(l[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
function fillSelect(sel, label, items, keep = true) {
  const prev = sel.value;
  sel.innerHTML = `<option value="">${label}</option>` +
    items.map((i) => typeof i === "string" ? `<option>${esc(i)}</option>` : `<option value="${esc(i.v)}">${esc(i.t)}</option>`).join("");
  if (keep && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}
function allProdutos() { return [...new Set([...S.produtos, ...uniq("produto")])].sort((a, b) => a.localeCompare(b, "pt-BR")); }
function allCorretores() { return [...new Set([...uniq("corretor"), ...S.users.map((u) => u.apelido).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "pt-BR")); }

function refreshAll() {
  fillSelect($("fdProduto"), "Todos os produtos", allProdutos());
  fillSelect($("fdEquipe"), "Todas as equipes", uniq("equipe"));
  fillSelect($("fdCorretor"), "Todos os corretores", allCorretores());
  fillSelect($("fProduto"), "Todos os produtos", allProdutos());
  fillSelect($("fEtapa"), "Todas as etapas", ETAPAS);
  fillSelect($("fCorretor"), "Todos os corretores", allCorretores());
  fillSelect($("fOrigem"), "Todas as origens", uniq("origem"));
  fillSelect($("fFeedback"), "Feedback: todos", [{ v: "com", t: "Com feedback" }, { v: "sem", t: "Sem feedback" }]);
  const ativos = S.users.filter((u) => u.ativo);
  fillSelect($("fDesignado"), "Designação: todas", [{ v: "__none", t: "Sem designação" }, ...ativos.map((u) => ({ v: u.id, t: u.nome || u.id }))]);
  fillSelect($("bulkUser"), "Designar para…", [{ v: "__none", t: "— Remover designação —" }, ...ativos.map((u) => ({ v: u.id, t: u.nome || u.id }))]);
  fillSelect($("uApelido"), "Corretor no CRM (opcional)", uniq("corretor"));
  if (S.view === "dash") renderDash();
  if (S.view === "clientes") renderClientes();
  if (S.view === "equipe") renderEquipe();
}

/* ---------------- DASHBOARD ---------------- */
["fPeriodo", "fdProduto", "fdEquipe", "fdCorretor"].forEach((id) => $(id).onchange = renderDash);

// Paleta dos gráficos (tokens do tema claro)
const C = {
  blue: "#007AFF", green: "#34C759", orange: "#FF9500", red: "#FF3B30", indigo: "#5856D6",
  teal: "#5AC8FA", gray: "#8E8E93", grayLight: "#D1D1D6", grid: "#F0F0F3", text: "#1D1D1F", text2: "#6E6E73",
};
const ETAPA_COLOR = { Iniciados: C.blue, Conversando: C.green, Negociando: C.orange, Vendido: C.indigo, Descartados: C.grayLight };
const SERIES = [C.blue, C.green, C.orange, C.indigo, C.teal, C.gray];
const PERIODO_TXT = { all: "todo o período", 7: "últimos 7 dias", 30: "últimos 30 dias", 90: "últimos 90 dias", 365: "último ano" };

function matchFilters(l) {
  const p = $("fdProduto").value, eq = $("fdEquipe").value, c = $("fdCorretor").value;
  if (p && l.produto !== p) return false;
  if (eq && l.equipe !== eq) return false;
  if (c && l.corretor !== c) return false;
  return true;
}
function dashLeads() {
  const dias = $("fPeriodo").value;
  const limite = dias === "all" ? null : Date.now() - Number(dias) * 864e5;
  return S.leads.filter((l) => {
    if (limite) { const d = toDate(l.criadoEm); if (!d || d.getTime() < limite) return false; }
    return matchFilters(l);
  });
}
// Mesmo filtro, janela imediatamente anterior (para o comparativo dos indicadores)
function prevLeads() {
  const dias = $("fPeriodo").value; if (dias === "all") return null;
  const fim = Date.now() - Number(dias) * 864e5, ini = fim - Number(dias) * 864e5;
  return S.leads.filter((l) => {
    const d = toDate(l.criadoEm); if (!d) return false;
    const t = d.getTime(); return t >= ini && t < fim && matchFilters(l);
  });
}
function countBy(arr, f) {
  const m = new Map();
  arr.forEach((x) => { const k = (typeof f === "function" ? f(x) : x[f]) || "Não informado"; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function setupChartDefaults() {
  if (setupChartDefaults.done) return; setupChartDefaults.done = true;
  const d = Chart.defaults;
  d.font.family = getComputedStyle(document.body).fontFamily;
  d.font.size = 12;
  d.color = C.text2;
  d.borderColor = C.grid;
  d.animation.duration = 450;
  d.animation.easing = "easeOutQuart";
  Object.assign(d.plugins.tooltip, {
    backgroundColor: "rgba(255,255,255,.97)", titleColor: C.text, bodyColor: C.text2, borderColor: "#D2D2D7", borderWidth: 1,
    padding: 10, cornerRadius: 10, boxPadding: 4, usePointStyle: true, titleFont: { weight: "600" }, displayColors: true,
    callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ": " : ""}${Number(c.raw).toLocaleString("pt-BR")}` },
  });
  d.plugins.legend.display = false;
  d.elements.bar.borderSkipped = false;
}

// Valor total no centro da rosca
const centerText = {
  id: "centerText",
  afterDraw(ch, _a, opt) {
    if (!opt?.value) return;
    const { ctx } = ch, m = ch.getDatasetMeta(0).data[0]; if (!m) return;
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = C.text; ctx.font = `600 26px ${Chart.defaults.font.family}`;
    ctx.fillText(opt.value, m.x, m.y - 8);
    ctx.fillStyle = C.text2; ctx.font = `400 12px ${Chart.defaults.font.family}`;
    ctx.fillText(opt.label || "", m.x, m.y + 14); ctx.restore();
  },
};

function chart(id, cfg) {
  if (cfg.options?.indexAxis === "y") {
    const y = cfg.options.scales.y; y.ticks = { ...(y.ticks || {}), autoSkip: false,
      callback(v) { const l = String(this.getLabelForValue(v)); return l.length > 24 ? l.slice(0, 23) + "…" : l; } };
  }
  if (S.charts[id]) {
    // Atualiza no lugar para uma transição suave entre filtros
    const ch = S.charts[id];
    if (ch.config.type === cfg.type) { ch.data = cfg.data; ch.options = cfg.options; ch.update(); return; }
    ch.destroy();
  }
  S.charts[id] = new Chart($(id), cfg);
}
const axisX = { grid: { display: false }, border: { display: false }, ticks: { color: C.text2 } };
const axisY = { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { precision: 0, color: C.text2, padding: 6 } };
const hbar = (extra = {}) => ({
  responsive: true, maintainAspectRatio: false, indexAxis: "y",
  scales: { x: { ...axisY, ...(extra.x || {}) }, y: { grid: { display: false }, border: { display: false }, ticks: { color: C.text } } },
  plugins: { tooltip: { intersect: false, mode: "nearest", axis: "y", ...(extra.tooltip || {}) } },
});
const barDs = (data, color, extra = {}) => ({ data, backgroundColor: color, borderRadius: 6, barPercentage: .72, categoryPercentage: .9, maxBarThickness: 26, ...extra });

function kpi({ label, value, dot, delta, deltaGood = "up", sub }) {
  let d = "";
  if (delta != null) {
    const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const mood = deltaGood === "down" ? (dir === "up" ? " bad" : dir === "down" ? " good" : "") : "";
    d = `<span class="delta ${dir}${mood}">${delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} ${Math.abs(delta)}%</span>`;
  }
  return `<div class="kpi"><div class="l">${dot ? `<span class="dot" style="background:${dot}"></span>` : ""}${label}</div>
    <div class="v">${Number(value).toLocaleString("pt-BR")}</div><div class="s">${d}<span>${sub}</span></div></div>`;
}
const variacao = (atual, antes) => (antes == null || antes === 0 ? null : Math.round(((atual - antes) / antes) * 100));

function renderDash() {
  if (typeof Chart === "undefined") return;
  setupChartDefaults();
  const L = dashLeads(), P = prevLeads();
  const dias = $("fPeriodo").value;
  const total = L.length;
  const by = (e, arr = L) => arr.filter((l) => l.etapa === e).length;
  const ativosDe = (arr) => arr.filter((l) => l.etapa !== "Descartados" && l.etapa !== "Vendido").length;
  const desc = by("Descartados"), vend = by("Vendido"), ativos = ativosDe(L);
  const semResp = L.filter((l) => !l.responsavel).length;
  const fbs = L.filter((l) => l.ultimoFeedbackEm).length;
  const pct = (n) => (total ? `${Math.round((n / total) * 100)}% do período` : "—");
  const ref = dias === "all" ? "" : `vs. ${dias} dias anteriores`;

  $("dashSub").textContent = `${S.leads.length.toLocaleString("pt-BR")} clientes na base · exibindo ${PERIODO_TXT[dias]}`;
  $("kpis").innerHTML = [
    kpi({ label: "Leads recebidos", value: total, delta: P ? variacao(total, P.length) : null, sub: ref || `${S.leads.length.toLocaleString("pt-BR")} na base` }),
    kpi({ label: "Em atendimento", value: ativos, dot: C.green, sub: pct(ativos) }),
    kpi({ label: "Negociando", value: by("Negociando"), dot: C.orange, sub: pct(by("Negociando")) }),
    kpi({ label: "Vendidos", value: vend, dot: C.indigo, sub: pct(vend) }),
    kpi({ label: "Descartados", value: desc, dot: C.grayLight, delta: P ? variacao(desc, by("Descartados", P)) : null, deltaGood: "down", sub: pct(desc) }),
    S.admin ? kpi({ label: "Sem designação", value: semResp, dot: C.blue, sub: "aguardando corretor" })
            : kpi({ label: "Com feedback", value: fbs, dot: C.blue, sub: pct(fbs) }),
  ].join("");

  // Volume semanal
  const weeks = new Map();
  L.forEach((l) => {
    const d = toDate(l.criadoEm); if (!d) return;
    const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    const k = m.toISOString().slice(0, 10); weeks.set(k, (weeks.get(k) || 0) + 1);
  });
  const wk = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const media = wk.length ? Math.round(total / wk.length) : 0;
  $("hSemana").textContent = wk.length ? `média de ${media.toLocaleString("pt-BR")} por semana` : "";
  chart("cSemana", { type: "line",
    data: { labels: wk.map(([k]) => k.split("-").reverse().slice(0, 2).join("/")),
      datasets: [{ label: "Leads", data: wk.map((x) => x[1]), borderColor: C.blue, borderWidth: 2, backgroundColor: "rgba(0,122,255,.07)", fill: true,
        tension: .35, pointRadius: wk.length > 40 ? 0 : 2.5, pointHoverRadius: 5, pointBackgroundColor: "#fff", pointBorderColor: C.blue, pointBorderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { tooltip: { callbacks: { title: (i) => `Semana de ${i[0].label}` } } },
      scales: { x: { ...axisX, ticks: { color: C.text2, maxRotation: 0, autoSkipPadding: 18 } }, y: axisY } } });

  chart("cEtapa", { type: "bar", data: { labels: ETAPAS, datasets: [barDs(ETAPAS.map((e) => by(e)), ETAPAS.map((e) => ETAPA_COLOR[e]), { label: "Leads" })] },
    options: hbar() });

  const prod = countBy(L, "produto");
  chart("cProduto", { type: "bar", data: { labels: prod.map((x) => x[0]), datasets: [barDs(prod.map((x) => x[1]), C.blue, { label: "Leads" })] }, options: hbar() });

  const taxa = prod.map(([p, n]) => [p, Math.round((L.filter((l) => l.produto === p && l.etapa !== "Descartados").length / n) * 100)]);
  chart("cTaxa", { type: "bar", data: { labels: taxa.map((x) => x[0]), datasets: [barDs(taxa.map((x) => x[1]), C.green, { label: "Em atendimento" })] },
    options: hbar({ x: { max: 100, ticks: { callback: (v) => v + "%", color: C.text2 } }, tooltip: { callbacks: { label: (c) => ` ${c.raw}% ainda em atendimento` } } }) });

  const eq = countBy(L, "equipe");
  chart("cEquipe", { type: "doughnut", plugins: [centerText],
    data: { labels: eq.map((x) => x[0]), datasets: [{ data: eq.map((x) => x[1]), backgroundColor: SERIES, borderWidth: 3, borderColor: "#fff", hoverOffset: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "70%",
      plugins: { centerText: { value: total.toLocaleString("pt-BR"), label: "leads" },
        legend: { display: true, position: "right", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: 14, color: C.text,
          generateLabels: (ch) => ch.data.labels.map((t, i) => ({ text: `${t}  ${total ? Math.round((ch.data.datasets[0].data[i] / total) * 100) : 0}%`,
            fillStyle: SERIES[i % SERIES.length], strokeStyle: SERIES[i % SERIES.length], pointStyle: "circle", index: i, fontColor: C.text })) } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw.toLocaleString("pt-BR")} (${total ? Math.round((c.raw / total) * 100) : 0}%)` } } } } });

  const cor = countBy(L, "corretor");
  const corAtivo = cor.map(([c]) => L.filter((l) => (l.corretor || "Não informado") === c && l.etapa !== "Descartados").length);
  const corDesc = cor.map(([c]) => L.filter((l) => (l.corretor || "Não informado") === c && l.etapa === "Descartados").length);
  chart("cCorretor", { type: "bar", data: { labels: cor.map((x) => x[0]), datasets: [
    { label: "Ativos", data: corAtivo, backgroundColor: C.green, borderRadius: 4, maxBarThickness: 28 },
    { label: "Descartados", data: corDesc, backgroundColor: C.grayLight, borderRadius: 4, maxBarThickness: 28 },
  ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
    scales: { x: { ...axisX, stacked: true, ticks: { color: C.text2, autoSkip: false, maxRotation: 50, minRotation: 0 } }, y: { ...axisY, stacked: true } } } });

  const mot = countBy(L.filter((l) => l.etapa === "Descartados"), "motivoDescarte");
  chart("cMotivo", { type: "bar", data: { labels: mot.map((x) => x[0]), datasets: [barDs(mot.map((x) => x[1]), mot.map((_, i) => (i === 0 ? C.orange : "rgba(255,149,0,.45)")), { label: "Leads" })] },
    options: hbar() });

  // Feedback por corretor
  const temFb = (l) => !!l.ultimoFeedbackEm;
  const qtdFb = (l) => l.qtdFeedbacks || (temFb(l) ? 1 : 0);
  const fbCor = countBy(L, "corretor").map(([c, n]) => {
    const dele = L.filter((l) => (l.corretor || "Não informado") === c);
    return { c, n, com: dele.filter(temFb).length, regs: dele.reduce((s, l) => s + qtdFb(l), 0) };
  }).sort((a, b) => b.com - a.com || b.n - a.n);
  const totCom = L.filter(temFb).length;
  $("hFeedback").textContent = `${totCom.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} leads com feedback (${total ? Math.round((totCom / total) * 100) : 0}%)`;
  chart("cFeedback", { type: "bar", data: { labels: fbCor.map((x) => x.c), datasets: [
    { label: "Com feedback", data: fbCor.map((x) => x.com), backgroundColor: C.blue, borderRadius: 4, maxBarThickness: 28 },
    { label: "Sem feedback", data: fbCor.map((x) => x.n - x.com), backgroundColor: C.grayLight, borderRadius: 4, maxBarThickness: 28 },
  ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
    onHover: (e, el) => { e.native.target.style.cursor = el.length ? "pointer" : "default"; },
    onClick: (e, el) => { if (el.length) abrirClientes({ fCorretor: fbCor[el[0].index].c, fFeedback: "com" }); },
    plugins: { tooltip: { callbacks: { footer: (items) => {
      const x = fbCor[items[0].dataIndex];
      return `${x.n ? Math.round((x.com / x.n) * 100) : 0}% com feedback · ${x.regs} feedback(s) registrado(s)`;
    } } } },
    scales: { x: { ...axisX, stacked: true, ticks: { color: C.text2, autoSkip: false, maxRotation: 50, minRotation: 0 } }, y: { ...axisY, stacked: true } } } });

  const ori = countBy(L, "origem").slice(0, 10);
  chart("cOrigem", { type: "bar", data: { labels: ori.map((x) => x[0]), datasets: [barDs(ori.map((x) => x[1]), ori.map((_, i) => (i === 0 ? C.blue : "rgba(0,122,255,.4)")), { label: "Leads" })] },
    options: hbar() });
}

/* ---------------- CLIENTES ---------------- */
function abrirClientes(filtros) {
  ["fProduto", "fEtapa", "fCorretor", "fOrigem", "fFeedback", "fDesignado"].forEach((id) => $(id).value = "");
  $("q").value = "";
  Object.entries(filtros).forEach(([id, v]) => { if ([...$(id).options].some((o) => o.value === v)) $(id).value = v; });
  S.shown = 60;
  document.querySelector('#tabs button[data-v="clientes"]').click();
}
["q", "fProduto", "fEtapa", "fCorretor", "fOrigem", "fFeedback", "fDesignado", "fOrdem"].forEach((id) => {
  $(id).addEventListener(id === "q" ? "input" : "change", () => { S.shown = 60; renderClientes(); });
});
$("btnMore").onclick = () => { S.shown += 60; renderClientes(); };

function filteredLeads() {
  const q = norm($("q").value), qd = $("q").value.replace(/\D/g, "");
  const p = $("fProduto").value, e = $("fEtapa").value, c = $("fCorretor").value, d = $("fDesignado").value, ori = $("fOrigem").value, fb = $("fFeedback").value;
  let L = S.leads.filter((l) => {
    if (p && l.produto !== p) return false;
    if (e && l.etapa !== e) return false;
    if (c && l.corretor !== c) return false;
    if (ori && l.origem !== ori) return false;
    if (fb === "com" && !l.ultimoFeedbackEm) return false;
    if (fb === "sem" && l.ultimoFeedbackEm) return false;
    if (d === "__none" && l.responsavel) return false;
    if (d && d !== "__none" && l.responsavel !== d) return false;
    if (q) {
      const hay = norm(`${l.nome} ${l.email} ${l.telefone} ${l.telefone2}`);
      if (!hay.includes(q) && !(qd.length >= 4 && String(l.telefone).includes(qd))) return false;
    }
    return true;
  });
  const t = (x, f) => toDate(x[f])?.getTime() || 0;
  const o = $("fOrdem").value;
  L.sort(o === "antigos" ? (a, b) => t(a, "criadoEm") - t(b, "criadoEm")
    : o === "nome" ? (a, b) => clean(a.nome).localeCompare(clean(b.nome), "pt-BR")
    : o === "atualizados" ? (a, b) => t(b, "atualizadoEm") - t(a, "atualizadoEm")
    : (a, b) => t(b, "criadoEm") - t(a, "criadoEm"));
  return L;
}

const CHECK = `<span class="check"><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6 9.5 3.6"/></svg></span>`;
function renderClientes() {
  const L = filteredLeads();
  $("count").textContent = `${L.length.toLocaleString("pt-BR")} ${L.length === 1 ? "cliente" : "clientes"}` + (S.admin ? "" : S.profile?.papel === "gestor" ? " da sua equipe" : " designados a você");
  if (!L.length) { $("grid").innerHTML = `<div class="empty">${icon("inbox")}<div>Nenhum cliente encontrado</div></div>`; $("btnMore").classList.add("hidden"); return; }
  $("grid").innerHTML = L.slice(0, S.shown).map((l) => `
    <div class="ccard ${S.sel.has(l.id) ? "sel" : ""}" data-id="${esc(l.id)}" tabindex="0">
      ${S.selMode ? CHECK : ""}
      <div class="top">
        <div class="avatar">${esc(initials(l.nome))}</div>
        <div style="min-width:0;${S.selMode ? "padding-right:26px" : ""}">
          <div class="n">${esc(l.nome || "Sem nome")}</div>
          <div class="p">${fmtPhone(l.telefone)}</div>
        </div>
      </div>
      <div class="chips"><span class="status s-${esc(l.etapa)}">${esc(l.etapa || "—")}</span><span class="chip">${esc(l.produto || "Sem produto")}</span></div>
      ${l.ultimoFeedback ? `<div class="fb">${esc(l.ultimoFeedback)}</div>` : ""}
      <div class="meta"><span>${esc(l.corretor || "Sem corretor")}${S.admin && l.responsavel ? ` · ${esc(userName(l.responsavel))}` : ""}</span><span class="num">${fmtDate(l.criadoEm)}</span></div>
    </div>`).join("");
  $("btnMore").classList.toggle("hidden", L.length <= S.shown);
}

$("grid").onclick = (e) => {
  const card = e.target.closest(".ccard"); if (!card) return;
  const id = card.dataset.id;
  if (S.selMode) {
    S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
    card.classList.toggle("sel", S.sel.has(id));
    updateBulk(); return;
  }
  openLead(id);
};
$("grid").onkeydown = (e) => { if (e.key === "Enter" && e.target.classList.contains("ccard")) e.target.click(); };

/* Seleção em massa (admin) */
$("btnSelMode").onclick = () => { S.selMode = !S.selMode; S.sel.clear(); $("btnSelMode").innerHTML = icon("select") + (S.selMode ? "Concluir" : "Selecionar"); updateBulk(); renderClientes(); };
$("bulkCancel").onclick = () => { S.selMode = false; S.sel.clear(); $("btnSelMode").innerHTML = icon("select") + "Selecionar"; updateBulk(); renderClientes(); };
$("bulkAll").onclick = () => { filteredLeads().forEach((l) => S.sel.add(l.id)); updateBulk(); renderClientes(); };
function updateBulk() {
  $("bulk").classList.toggle("hidden", !S.selMode);
  $("bulkCount").textContent = `${S.sel.size.toLocaleString("pt-BR")} ${S.sel.size === 1 ? "selecionado" : "selecionados"}`;
}
$("bulkAssign").onclick = async () => {
  const u = $("bulkUser").value;
  if (!u) return toast("Escolha para quem designar.");
  if (!S.sel.size) return toast("Selecione ao menos um cliente.");
  const ids = [...S.sel];
  if (!confirm(`Designar ${ids.length} cliente(s) para ${u === "__none" ? "ninguém (remover)" : userName(u)}?`)) return;
  $("bulkAssign").classList.add("loading");
  try { await assignMany(ids, u === "__none" ? null : u); } finally { $("bulkAssign").classList.remove("loading"); }
  S.sel.clear(); updateBulk(); renderClientes();
};
async function assignMany(ids, email) {
  for (let i = 0; i < ids.length; i += 400) {
    const b = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => b.update(doc(db, "leads", id), { responsavel: email, atualizadoEm: serverTimestamp(), atualizadoPor: S.me.email }));
    await b.commit();
  }
  toast(`${ids.length} cliente(s) designado(s).`);
}

/* ---------------- CARD DO CLIENTE ---------------- */
let feedUnsub = null;
function closeModal() { $("modal").classList.add("hidden"); if (feedUnsub) { feedUnsub(); feedUnsub = null; } }
$("modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

function openLead(id) {
  const l = S.leads.find((x) => x.id === id); if (!l) return;
  const wa = waLink(l.telefone);
  const opt = (arr, cur) => {
    const list = cur && !arr.includes(cur) ? [cur, ...arr] : arr;
    return `<option value="">—</option>` + list.map((v) => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  };
  const usersOpt = `<option value="">— Sem designação —</option>` + S.users.filter((u) => u.ativo)
    .map((u) => `<option value="${esc(u.id)}" ${u.id === l.responsavel ? "selected" : ""}>${esc(u.nome || u.id)}</option>`).join("");

  const kv = (k, v) => `<div><small>${k}</small><span>${v}</span></div>`;
  $("sheet").innerHTML = `
    <div class="hd">
      <div class="avatar">${esc(initials(l.nome))}</div>
      <div style="min-width:0">
        <h3>${esc(l.nome || "Sem nome")}</h3>
        <div class="chips"><span class="status s-${esc(l.etapa)}">${esc(l.etapa || "—")}</span><span class="chip">${esc(l.produto || "Sem produto")}</span></div>
      </div>
      <button class="x" id="mClose" aria-label="Fechar"><svg viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>
    </div>
    <div class="bd">
      <div class="actions">
        ${wa ? `<a class="btn wa" href="${wa}" target="_blank" rel="noopener">${icon("chat")}WhatsApp</a>` : ""}
        ${l.telefone ? `<a class="btn tinted" href="tel:${esc(l.telefone)}">${icon("phone")}Ligar</a>` : ""}
        ${l.email ? `<a class="btn tinted" href="mailto:${esc(l.email)}">${icon("mail")}E-mail</a>` : ""}
      </div>

      <div class="group">
        <div class="kv">
          ${kv("Telefone", `<span class="num">${fmtPhone(l.telefone)}</span>`)}
          ${kv("E-mail", esc(l.email || "—"))}
          ${l.telefone2 ? kv("Telefone 2", `<span class="num">${fmtPhone(l.telefone2)}</span>`) : ""}
          ${kv("Entrada", `<span class="num">${fmtDate(l.criadoEm, true)}</span>`)}
          ${kv("Origem", esc(l.origem || "—"))}
          ${kv("Equipe", esc(l.equipe || "—"))}
          ${l.etapa === "Descartados" ? kv("Descartado em", `<span class="num">${fmtDate(l.descartadoEm, true)}</span>`) : ""}
          ${l.valorVenda ? kv("Valor da venda", `<span class="num">R$ ${Number(l.valorVenda).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>`) : ""}
          ${kv("Última atualização", `<span class="num">${fmtDate(l.atualizadoEm, true)}</span>${l.atualizadoPor ? ` · ${esc(userName(l.atualizadoPor))}` : ""}`)}
        </div>
      </div>

      <div class="group">
        <div class="gt">Atendimento</div>
        <div class="form">
          <label>Produto<select class="select" id="eProduto">${opt(allProdutos(), l.produto)}</select></label>
          <label>Etapa<select class="select" id="eEtapa">${opt(ETAPAS, l.etapa)}</select></label>
          <label id="wMotivo" class="${l.etapa === "Descartados" ? "" : "hidden"}">Motivo do descarte<select class="select" id="eMotivo">${opt(MOTIVOS, l.motivoDescarte)}</select></label>
          ${S.admin ? `
            <label>Corretor<select class="select" id="eCorretor">${opt(allCorretores(), l.corretor)}</select></label>
            <label>Acesso designado para<select class="select" id="eResp">${usersOpt}</select></label>` : `
            <label>Corretor<input class="field" value="${esc(l.corretor || "—")}" disabled></label>`}
          <div class="foot"><button class="btn primary" id="eSave">Salvar alterações</button></div>
        </div>
      </div>

      <div class="feed">
        <h4>Feedbacks</h4>
        <textarea id="fbText" placeholder="Como foi o contato? Próximo passo, objeções, visita marcada…"></textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn tinted" id="fbAdd">Adicionar feedback</button></div>
        <div class="timeline" id="fbList"><div class="skeleton" style="height:44px"></div></div>
      </div>
      ${S.admin ? `<div class="danger-zone"><button class="btn danger sm" id="eDel">Excluir cliente</button></div>` : ""}
    </div>`;
  $("modal").classList.remove("hidden");
  $("mClose").onclick = closeModal;
  $("eEtapa").onchange = () => $("wMotivo").classList.toggle("hidden", $("eEtapa").value !== "Descartados");

  $("eSave").onclick = async () => {
    const upd = { produto: $("eProduto").value, etapa: $("eEtapa").value, atualizadoEm: serverTimestamp(), atualizadoPor: S.me.email };
    upd.motivoDescarte = upd.etapa === "Descartados" ? $("eMotivo").value : "";
    if (S.admin) {
      upd.corretor = $("eCorretor").value;
      upd.responsavel = $("eResp").value || null;
      if (upd.etapa === "Descartados" && l.etapa !== "Descartados") upd.descartadoEm = serverTimestamp();
    }
    $("eSave").classList.add("loading");
    try { await updateDoc(doc(db, "leads", id), upd); toast("Cliente atualizado"); closeModal(); }
    catch (e) { $("eSave").classList.remove("loading"); toast("Não foi possível salvar: " + e.code); }
  };

  $("fbAdd").onclick = async () => {
    const texto = $("fbText").value.trim(); if (!texto) return;
    $("fbAdd").classList.add("loading");
    try {
      await addDoc(collection(db, "leads", id, "feedbacks"), { texto, autor: S.me.email, autorNome: S.me.nome, em: serverTimestamp() });
      await updateDoc(doc(db, "leads", id), { ultimoFeedback: texto.slice(0, 200), ultimoFeedbackEm: serverTimestamp(), qtdFeedbacks: increment(1), atualizadoEm: serverTimestamp(), atualizadoPor: S.me.email });
      $("fbText").value = ""; toast("Feedback registrado.");
    } catch (e) { toast("Erro ao salvar feedback: " + e.code); }
    $("fbAdd")?.classList.remove("loading");
  };

  if (S.admin) $("eDel").onclick = async () => {
    if (!confirm(`Excluir ${l.nome}? Essa ação não pode ser desfeita.`)) return;
    await deleteDoc(doc(db, "leads", id)); toast("Cliente excluído."); closeModal();
  };

  if (feedUnsub) feedUnsub();
  feedUnsub = onSnapshot(query(collection(db, "leads", id, "feedbacks"), orderBy("em", "desc")), (snap) => {
    const box = $("fbList"); if (!box) return;
    box.innerHTML = snap.empty ? `<p class="note" style="margin:0">Nenhum feedback ainda.</p>` :
      snap.docs.map((d) => { const f = d.data(); return `<div class="fitem"><div class="h">${esc(f.autorNome || f.autor)} · ${fmtDate(f.em, true)}</div><div class="t">${esc(f.texto).replace(/\n/g, "<br>")}</div></div>`; }).join("");
  }, (e) => { const box = $("fbList"); if (box) box.innerHTML = `<div class="note">Erro ao carregar feedbacks (${e.code}).</div>`; });
}

/* ---------------- ACESSOS ---------------- */
function corretoresChecks(sel = []) {
  const lista = [...new Set([...uniq("corretor"), ...sel])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return lista.map((c) => `<label class="ck"><input type="checkbox" value="${esc(c)}" ${sel.includes(c) ? "checked" : ""}><span>${esc(c)}</span></label>`).join("");
}
function toggleGestorBox() {
  const g = $("uPapel").value === "gestor";
  $("uGestor").classList.toggle("hidden", !g);
  if (g && !$("uCorretores").children.length) $("uCorretores").innerHTML = corretoresChecks();
}
$("uPapel").onchange = toggleGestorBox;

// Descartados do corretor ainda não designados à pessoa, do mais antigo para o mais novo (data de entrada)
function descartadosPara(u) {
  const t = (l) => toDate(l.criadoEm)?.getTime() || 0;
  return S.leads.filter((l) => l.corretor === u.apelido && l.etapa === "Descartados" && l.responsavel !== u.id)
    .sort((a, b) => t(a) - t(b));
}
function openAutoAssign(u) {
  const lista = descartadosPara(u);
  if (!lista.length) return toast("Nenhum descartado pendente para este corretor.");
  const nome = esc(u.nome || u.id);
  $("sheet").innerHTML = `
    <div class="hd">
      <div class="avatar">${esc(initials(u.nome || u.id))}</div>
      <div style="min-width:0"><h3>Designar descartados</h3>
        <p class="note" style="margin:4px 0 0">Descartados de <b>${esc(u.apelido)}</b> para ${nome}, do mais antigo para o mais novo.</p></div>
      <button class="x" id="mClose" aria-label="Fechar"><svg viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>
    </div>
    <div class="bd">
      <div class="form" style="padding:0;margin-bottom:12px">
        <label>Quantidade<input class="field" id="aaQtd" type="number" min="1" max="${lista.length}" value="${lista.length}"></label>
        <label>Disponíveis<input class="field" value="${lista.length} descartado(s)" disabled></label>
      </div>
      <p class="note" id="aaResumo" style="margin:0 0 12px"></p>
      <div class="group" style="max-height:260px;overflow:auto"><div id="aaLista"></div></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn plain" id="aaCancel">Cancelar</button><button class="btn primary" id="aaOk">Designar</button>
      </div>
    </div>`;
  const draw = () => {
    const n = Math.max(1, Math.min(lista.length, parseInt($("aaQtd").value, 10) || 1));
    if (String(n) !== $("aaQtd").value && $("aaQtd").value !== "") $("aaQtd").value = n;
    const sel = lista.slice(0, n);
    $("aaResumo").textContent = `${n} cliente(s), de ${fmtDate(sel[0].criadoEm)} a ${fmtDate(sel[n - 1].criadoEm)}.`;
    $("aaLista").innerHTML = sel.map((l, i) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 14px;border-bottom:1px solid var(--c-line-soft);font-size:var(--fs-footnote)">
      <span><span class="num" style="color:var(--c-text-3)">${i + 1}.</span> ${esc(l.nome || "Sem nome")}</span><span class="num" style="color:var(--c-text-3)">${fmtDate(l.criadoEm)}</span></div>`).join("");
    return sel;
  };
  draw();
  $("aaQtd").oninput = draw;
  $("modal").classList.remove("hidden");
  $("mClose").onclick = $("aaCancel").onclick = closeModal;
  $("aaOk").onclick = async () => {
    const sel = draw();
    $("aaOk").classList.add("loading");
    try { await assignMany(sel.map((l) => l.id), u.id); closeModal(); }
    catch (e) { $("aaOk").classList.remove("loading"); toast("Erro ao designar: " + e.code); }
  };
}

function openEquipe(u) {
  $("sheet").innerHTML = `
    <div class="hd">
      <div class="avatar">${esc(initials(u.nome || u.id))}</div>
      <div style="min-width:0"><h3>Equipe de ${esc(u.nome || u.id)}</h3><p class="note" style="margin:4px 0 0">Marque os corretores cujos clientes este gestor pode ver.</p></div>
      <button class="x" id="mClose" aria-label="Fechar"><svg viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>
    </div>
    <div class="bd">
      <div class="cklist" id="eqList">${corretoresChecks(u.corretores || [])}</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button class="btn plain" id="eqCancel">Cancelar</button><button class="btn primary" id="eqSave">Salvar equipe</button>
      </div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("mClose").onclick = $("eqCancel").onclick = closeModal;
  $("eqSave").onclick = async () => {
    const corretores = [...document.querySelectorAll("#eqList input:checked")].map((i) => i.value);
    $("eqSave").classList.add("loading");
    try { await updateDoc(doc(db, "users", u.id), { corretores }); toast("Equipe atualizada"); closeModal(); }
    catch (e) { $("eqSave").classList.remove("loading"); toast("Erro ao salvar: " + e.code); }
  };
}

$("btnAddUser").onclick = async () => {
  const email = $("uEmail").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Informe um e-mail válido.");
  const papel = $("uPapel").value;
  const data = { nome: $("uNome").value.trim() || email, papel, apelido: $("uApelido").value || "", ativo: true, criadoEm: serverTimestamp(), criadoPor: S.me.email };
  if (papel === "gestor") {
    data.corretores = [...document.querySelectorAll("#uCorretores input:checked")].map((i) => i.value);
    if (!data.corretores.length) return toast("Marque ao menos um corretor para o gestor.");
  }
  await setDoc(doc(db, "users", email), data, { merge: true });
  ["uEmail", "uNome"].forEach((i) => $(i).value = ""); $("uApelido").value = ""; $("uPapel").value = "corretor"; toggleGestorBox();
  toast(`Acesso liberado para ${email}.`);
};

function renderEquipe() {
  if (!S.admin) return;
  const rows = [...S.users].sort((a, b) => (b.dono ? 1 : 0) - (a.dono ? 1 : 0) || clean(a.nome).localeCompare(clean(b.nome), "pt-BR"));
  $("usersBody").innerHTML = rows.map((u) => {
    const n = S.leads.filter((l) => l.responsavel === u.id).length;
    const pend = u.apelido ? descartadosPara(u).length : 0;
    const papel = u.dono || u.papel === "admin" ? "Administrador" : u.papel === "gestor" ? "Gestor" : "Corretor";
    const cls = u.dono || u.papel === "admin" ? "s-Iniciados" : u.papel === "gestor" ? "s-Vendido" : "s-Conversando";
    const equipe = u.papel === "gestor" ? (u.corretores || []) : null;
    return `<tr data-u="${esc(u.id)}">
      <td><div class="person"><div class="avatar">${esc(initials(u.nome || u.id))}</div><div><b>${esc(u.nome || u.id)}</b><small>${esc(u.id)}</small></div></div></td>
      <td>${u.ativo ? `<span class="status ${cls}">${papel}</span>` : `<span class="status s-Descartados">Bloqueado</span>`}</td>
      <td>${equipe ? `<div style="max-width:260px"><small class="note" style="margin:0">Vê os clientes de:</small><br>${equipe.length ? esc(equipe.join(", ")) : "nenhum corretor"} <button class="btn plain sm" data-a="equipe">Editar</button></div>` : esc(u.apelido || "—")}</td>
      <td class="n">${n.toLocaleString("pt-BR")}</td>
      <td><div class="rowact">${pend ? `<button class="btn tinted sm" data-a="sync" title="Descartados de ${esc(u.apelido)}, do mais antigo ao mais novo">Designar descartados (${pend})</button>` : ""}${u.dono ? "" : `
        <button class="btn plain sm" data-a="toggle">${u.ativo ? "Bloquear" : "Reativar"}</button>
        <button class="btn danger sm" data-a="del">Remover</button>`}</div></td></tr>`;
  }).join("");
  $("prodList").innerHTML = S.produtos.map((p) => `<span class="chip">${esc(p)}</span>`).join("");
}
$("usersBody").onclick = async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const id = b.closest("tr").dataset.u; const u = S.users.find((x) => x.id === id);
  if (b.dataset.a === "equipe") return openEquipe(u);
  if (b.dataset.a === "toggle") { await updateDoc(doc(db, "users", id), { ativo: !u.ativo }); toast(u.ativo ? "Acesso bloqueado." : "Acesso reativado."); }
  if (b.dataset.a === "del") {
    if (!confirm(`Remover o acesso de ${u.nome || id}? Os clientes dele ficarão sem designação.`)) return;
    await assignMany(S.leads.filter((l) => l.responsavel === id).map((l) => l.id), null);
    await deleteDoc(doc(db, "users", id)); toast("Acesso removido.");
  }
  if (b.dataset.a === "sync") openAutoAssign(u);
};
$("btnAddProd").onclick = async () => {
  const p = $("pNome").value.trim(); if (!p) return;
  const extra = [...new Set([...S.produtos.filter((x) => !PRODUTOS_BASE.includes(x)), p])];
  await setDoc(doc(db, "config", "listas"), { produtos: extra }, { merge: true });
  $("pNome").value = ""; toast("Produto adicionado.");
};

/* ---------------- IMPORTAÇÃO ---------------- */
const COLS = {
  criadoEm: "Leads created at", nome: "Leads clientName", telefone: "Leads clientPhone", telefone2: "Leads clientPhoneTwo",
  email: "Leads clientEmail", vendidoEm: "Leads soldDate", valorVenda: "Leads soldValue", produto: "Products productName",
  equipe: "Company teams name", corretor: "Users nickName", etapa: "Step leads name", origem: "Lead tag tag",
  motivoDescarte: "Reason for dropping out label", descartadoEm: "Leads discards discarded at", codigoExterno: "Leads externalCode",
};
$("file").onchange = async (e) => {
  const f = e.target.files[0]; S.importRows = null; $("btnImport").disabled = true;
  if (!f) return;
  $("dropName").textContent = f.name;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: false, raw: false });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: false, dateNF: "yyyy-mm-dd hh:mm:ss" });
    if (!rows.length || !(COLS.telefone in rows[0])) throw new Error("Não encontrei a coluna de telefone (Leads clientPhone).");
    S.importRows = rows;
    $("importLog").textContent = `${rows.length} linhas encontradas. Clique em Importar.`;
    $("btnImport").disabled = false;
  } catch (err) { $("importLog").textContent = "Erro ao ler o arquivo: " + err.message; }
};
function leadFromRow(r) {
  const o = {};
  for (const [k, col] of Object.entries(COLS)) o[k] = clean(r[col]);
  o.telefone = o.telefone.replace(/\D/g, "");
  o.telefone2 = o.telefone2.replace(/\D/g, "");
  o.email = o.email.toLowerCase();
  o.valorVenda = Number(String(o.valorVenda).replace(/[^\d.,-]/g, "").replace(",", ".")) || 0;
  if (o.etapa === "Descartado") o.etapa = "Descartados";
  if (o.vendidoEm && o.etapa !== "Descartados") o.etapa = "Vendido";
  return o;
}
// Arrastar e soltar
["dragenter", "dragover"].forEach((ev) => $("drop").addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => $("drop").addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.remove("over"); }));
$("drop").addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0]; if (!f) return;
  const dt = new DataTransfer(); dt.items.add(f); $("file").files = dt.files; $("file").dispatchEvent(new Event("change"));
});
const setProg = (v) => { $("importProg").classList.toggle("hidden", v == null); $("importProg").firstElementChild.style.width = (v || 0) + "%"; };

$("btnImport").onclick = async () => {
  if (!S.importRows) return;
  $("btnImport").disabled = true; setProg(0);
  const overwrite = $("overwrite").checked;
  const existing = new Map(S.leads.map((l) => [l.id, l]));
  let novos = 0, atualizados = 0, ignorados = 0;
  const ops = [];
  for (const r of S.importRows) {
    const o = leadFromRow(r);
    if (!o.telefone && !o.email) { ignorados++; continue; }
    const id = o.telefone || ("email_" + o.email.replace(/[^a-z0-9]/g, "_"));
    const cur = existing.get(id);
    const data = { ...o, importadoEm: serverTimestamp() };
    if (cur) {
      if (!overwrite) { delete data.produto; delete data.etapa; delete data.corretor; delete data.motivoDescarte; }
      atualizados++;
    } else {
      data.responsavel = null; data.atualizadoEm = serverTimestamp(); novos++;
    }
    ops.push([id, data]);
  }
  try {
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      ops.slice(i, i + 400).forEach(([id, data]) => b.set(doc(db, "leads", id), data, { merge: true }));
      await b.commit();
      const feito = Math.min(i + 400, ops.length);
      setProg(Math.round((feito / ops.length) * 100));
      $("importLog").textContent = `Gravando ${feito.toLocaleString("pt-BR")} de ${ops.length.toLocaleString("pt-BR")}…`;
    }
    setTimeout(() => setProg(null), 800);
    $("importLog").textContent = `Importação concluída.\n${novos} novos · ${atualizados} atualizados · ${ignorados} ignorados (sem telefone e e-mail).`;
    toast("Importação concluída.");
  } catch (err) { setProg(null); $("importLog").textContent = "Erro na importação: " + (err.code || err.message); }
  $("btnImport").disabled = false;
};
