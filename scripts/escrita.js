/**
 * Escrita na Mesa — módulo para Foundry VTT (v12/v13)
 * Escreva na cena com fonte, cor, tamanho, giro e moldura opcional. Todos veem.
 * Jogadores sem permissão de desenhar escrevem através do GM conectado.
 * Funciona em qualquer sistema. Reconhece os textos criados pelo módulo Fiasco: Mesa.
 */

const MOD = "escrita-na-mesa";
const { DialogV2 } = foundry.applications.api;

const esc = (s) => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Fontes que vêm com o módulo (licenças em assets/fontes). */
const FONTES_MESA = {
  "Special Elite":    { arquivo: "special-elite",    rotulo: "Máquina de escrever" },
  "Permanent Marker": { arquivo: "permanent-marker", rotulo: "Caneta pincel" },
  "Caveat":           { arquivo: "caveat",           rotulo: "Letra de mão" },
  "Alfa Slab One":    { arquivo: "alfa-slab-one",    rotulo: "Cartaz" },
  "Rye":              { arquivo: "rye",              rotulo: "Faroeste" }
};

const CORES_MESA = [
  { cor: "#efe5cf", nome: "Creme" },
  { cor: "#ffffff", nome: "Branco" },
  { cor: "#1b1b1b", nome: "Preto" },
  { cor: "#d0342c", nome: "Vermelho" },
  { cor: "#e8a92e", nome: "Mostarda" },
  { cor: "#8fc1e3", nome: "Azul" }
];

const SOCKET = `module.${MOD}`;
const PADRAO_ESCRITA = { fonte: "Special Elite", cor: "#efe5cf", tamanho: 48, moldura: false, molduraCor: "#1b1b1b", molduraLargura: 4 };

function registrarFontes() {
  CONFIG.fontDefinitions ??= {};
  for (const [familia, f] of Object.entries(FONTES_MESA)) {
    if (CONFIG.fontDefinitions[familia]) continue;
    CONFIG.fontDefinitions[familia] = { editor: true, fonts: [{ urls: [`modules/${MOD}/assets/fontes/${f.arquivo}.woff2`] }] };
  }
}

/** Garante a fonte carregada no navegador (para medir e para a prévia). */
async function carregarFonte(familia, tamanho = 32) {
  try { await document.fonts.load(`${tamanho}px "${familia}"`); } catch { /* segue com a fonte reserva */ }
}

/* Reconhece os textos deste módulo e também os criados pelo módulo do Fiasco. */
const ehTexto = (d) => !!(d?.flags?.[MOD]?.texto || d?.flags?.["fiasco-mesa"]?.texto);
const autorId = (d) => d?.author?.id ?? d?._source?.author ?? d?.author;
const gmAtivo = () => game.users.activeGM ?? game.users.find((u) => u.isGM && u.active);
const podeDesenhar = () => game.user.isGM || game.user.can("DRAWING_CREATE");

function ultimaEscrita() {
  try { return { ...PADRAO_ESCRITA, ...game.settings.get(MOD, "ultimaEscrita") }; } catch { return { ...PADRAO_ESCRITA }; }
}

/** Calcula o tamanho da caixa para o texto não quebrar linha. */
function medirTexto(texto, fonte, tamanho) {
  const style = new PIXI.TextStyle({ fontFamily: fonte, fontSize: tamanho });
  const m = PIXI.TextMetrics.measureText(texto, style);
  return { w: Math.ceil(m.width + tamanho * 0.8), h: Math.ceil(m.height + tamanho * 0.5) };
}

/** Monta os dados do Desenho de texto, centrado no ponto (cx, cy). */
function dadosDesenho({ texto, fonte, cor, tamanho, giro = 0, moldura = false, molduraCor = "#1b1b1b", molduraLargura = 4 }, cx, cy) {
  const { w, h } = medirTexto(texto, fonte, tamanho);
  const folga = moldura ? Math.round(tamanho * 0.3) : 0;
  const W = w + folga * 2, H = h + folga * 2;
  return {
    x: Math.round(cx - W / 2), y: Math.round(cy - H / 2),
    shape: { type: "r", width: W, height: H },
    rotation: normalizarGiro(giro),
    text: texto, fontFamily: fonte, fontSize: tamanho, textColor: cor, textAlpha: 1,
    fillType: CONST.DRAWING_FILL_TYPES.NONE,
    strokeWidth: moldura ? Math.max(1, Number(molduraLargura) || 4) : 0,
    strokeColor: molduraCor, strokeAlpha: moldura ? 1 : 0
  };
}

const normalizarGiro = (g) => ((Math.round(Number(g) || 0) % 360) + 540) % 360 - 180;

/** O ponto (coordenadas da cena) está dentro do texto, levando o giro em conta? */
function pontoNoTexto(d, ponto) {
  const cx = d.x + d.shape.width / 2, cy = d.y + d.shape.height / 2;
  const a = -((d.rotation ?? 0) * Math.PI) / 180;
  const dx = ponto.x - cx, dy = ponto.y - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= d.shape.width / 2 && Math.abs(ly) <= d.shape.height / 2;
}

/** Último texto (de cima) sob o ponto que este usuário pode editar. */
function textoEm(ponto) {
  return canvas.scene.drawings.contents.filter((d) => ehTexto(d)
    && (game.user.isGM || autorId(d) === game.user.id) && pontoNoTexto(d, ponto)).pop();
}

/* Quem não tem permissão de desenhar pede ao GM conectado, que cria o texto em nome dele. */
function pedirAoGM(acao, dados) {
  if (!gmAtivo()) return ui.notifications.warn("Escrita na Mesa: é preciso um GM conectado para escrever na mesa.");
  game.socket.emit(SOCKET, { acao, dados, usuario: game.user.id, cena: canvas.scene.id });
}

const CAMPOS_TEXTO = ["x", "y", "shape", "rotation", "text", "fontFamily", "fontSize", "textColor", "textAlpha", "fillType", "strokeWidth", "strokeColor", "strokeAlpha"];
const filtrar = (d) => Object.fromEntries(CAMPOS_TEXTO.filter((k) => k in d).map((k) => [k, d[k]]));

function registrarSocket() {
  game.socket.on(SOCKET, async (msg) => {
    if (!game.user.isGM || gmAtivo()?.id !== game.user.id) return;
    const scene = game.scenes.get(msg.cena);
    if (!scene || !game.users.get(msg.usuario)) return;
    if (msg.acao === "criarTexto") {
      await scene.createEmbeddedDocuments("Drawing", [{ ...filtrar(msg.dados), author: msg.usuario, flags: { [MOD]: { texto: true } } }]);
      return;
    }
    const doc = scene.drawings.get(msg.dados?._id);
    if (!ehTexto(doc) || autorId(doc) !== msg.usuario) return;
    if (msg.acao === "editarTexto") await doc.update(filtrar(msg.dados));
    if (msg.acao === "apagarTexto") await doc.delete();
  });
}

async function criarTexto(dados) {
  if (!podeDesenhar()) return pedirAoGM("criarTexto", dados);
  await canvas.scene.createEmbeddedDocuments("Drawing", [{ ...dados, author: game.user.id, flags: { [MOD]: { texto: true } } }]);
}

async function editarTexto(doc, dados) {
  if (podeDesenhar() && doc.isOwner) return doc.update(dados);
  pedirAoGM("editarTexto", { ...dados, _id: doc.id });
}

async function apagarTexto(doc) {
  if (podeDesenhar() && doc.isOwner) return doc.delete();
  pedirAoGM("apagarTexto", { _id: doc.id });
}

/** Janela de escrever/editar, com prévia ao vivo. */
async function dialogoTexto(existente) {
  const css = (c, padrao) => (c ? (c.css ?? String(c)) : padrao);
  const base = existente
    ? {
      texto: existente.text, fonte: existente.fontFamily, cor: css(existente.textColor, "#efe5cf"), tamanho: existente.fontSize,
      giro: existente.rotation ?? 0,
      moldura: (existente.strokeWidth ?? 0) > 0 && (existente.strokeAlpha ?? 1) > 0,
      molduraCor: css(existente.strokeColor, "#1b1b1b"), molduraLargura: existente.strokeWidth || 4
    }
    : { texto: "", giro: 0, ...ultimaEscrita() };

  const nossas = Object.entries(FONTES_MESA)
    .map(([f, o]) => `<option value="${f}" ${f === base.fonte ? "selected" : ""}>${o.rotulo} (${f})</option>`).join("");
  const outras = Object.keys(CONFIG.fontDefinitions ?? {}).filter((f) => !FONTES_MESA[f]).sort()
    .map((f) => `<option value="${esc(f)}" ${f === base.fonte ? "selected" : ""}>${esc(f)}</option>`).join("");
  const amostras = CORES_MESA
    .map((c) => `<button type="button" class="escrita-amostra" data-cor="${c.cor}" title="${c.nome}" style="background:${c.cor}"></button>`).join("");

  const content = `
    <div class="escrita-form escrita-janela">
      <textarea name="texto" rows="3" placeholder="Escreva aqui. Enter quebra a linha." autofocus>${esc(base.texto)}</textarea>
      <label>Fonte
        <select name="fonte"><optgroup label="Escrita na Mesa">${nossas}</optgroup>${outras ? `<optgroup label="Outras">${outras}</optgroup>` : ""}</select>
      </label>
      <div class="escrita-linha">
        <label>Cor <input type="color" name="cor" value="${base.cor}"></label>
        <div class="escrita-amostras">${amostras}</div>
      </div>
      <label>Tamanho <span class="escrita-tam-valor">${base.tamanho}</span>
        <input type="range" name="tamanho" min="12" max="200" step="2" value="${base.tamanho}">
      </label>
      <label>Giro <span class="escrita-giro-valor">${base.giro}°</span>
        <div class="escrita-linha escrita-giro">
          <button type="button" data-giro="-15" title="Girar 15° para a esquerda"><i class="fas fa-rotate-left"></i></button>
          <input type="range" name="giro" min="-180" max="180" step="1" value="${base.giro}">
          <button type="button" data-giro="15" title="Girar 15° para a direita"><i class="fas fa-rotate-right"></i></button>
          <button type="button" data-giro="0" title="Deixar reto">0°</button>
        </div>
      </label>
      <div class="escrita-linha escrita-moldura">
        <label class="check"><input type="checkbox" name="moldura" ${base.moldura ? "checked" : ""}> Moldura</label>
        <label>Cor <input type="color" name="molduraCor" value="${base.molduraCor}"></label>
        <label class="escrita-moldura-larg">Espessura <input type="range" name="molduraLargura" min="1" max="20" step="1" value="${base.molduraLargura}"></label>
      </div>
      <div class="escrita-previa"><span></span></div>
    </div>`;

  const ler = (form) => ({
    texto: form.elements.texto.value.replace(/\s+$/, ""),
    fonte: form.elements.fonte.value,
    cor: form.elements.cor.value,
    tamanho: Number(form.elements.tamanho.value) || 48,
    giro: Number(form.elements.giro.value) || 0,
    moldura: form.elements.moldura.checked,
    molduraCor: form.elements.molduraCor.value,
    molduraLargura: Number(form.elements.molduraLargura.value) || 4
  });

  const buttons = [{ action: "ok", label: existente ? "Salvar" : "Escrever", icon: "fas fa-pen-nib", default: true, callback: (ev, btn) => ler(btn.form) }];
  if (existente) buttons.push({ action: "apagar", label: "Apagar", icon: "fas fa-trash" });
  buttons.push({ action: "cancelar", label: "Cancelar" });

  for (const f of Object.keys(FONTES_MESA)) carregarFonte(f);

  return DialogV2.wait({
    window: { title: existente ? "Escrita na Mesa: editar texto" : "Escrita na Mesa" },
    position: { width: 420 },
    content,
    buttons,
    rejectClose: false,
    render: (event, arg) => {
      const root = arg instanceof HTMLElement ? arg : arg?.element;
      const form = root?.querySelector("form") ?? root;
      if (!form?.elements?.texto) return;
      const previa = root.querySelector(".escrita-previa span");
      const tamValor = root.querySelector(".escrita-tam-valor");
      const atualizar = () => {
        const v = ler(form);
        previa.textContent = v.texto || "Seu texto aqui";
        previa.style.fontFamily = `"${v.fonte}", sans-serif`;
        previa.style.color = v.cor;
        previa.style.fontSize = `${Math.min(v.tamanho, 64)}px`;
        previa.style.transform = `rotate(${v.giro}deg)`;
        previa.style.border = v.moldura ? `${Math.max(1, Math.round(v.molduraLargura / 2))}px solid ${v.molduraCor}` : "none";
        previa.style.padding = v.moldura ? "0.15em 0.4em" : "0";
        tamValor.textContent = v.tamanho;
        giroValor.textContent = `${v.giro}°`;
        root.querySelectorAll(".escrita-moldura input:not([name='moldura'])").forEach((i) => { i.disabled = !v.moldura; });
      };
      const giroValor = root.querySelector(".escrita-giro-valor");
      root.querySelectorAll("[data-giro]").forEach((b) => b.addEventListener("click", () => {
        const passo = Number(b.dataset.giro);
        form.elements.giro.value = passo === 0 ? 0 : normalizarGiro(Number(form.elements.giro.value) + passo);
        atualizar();
      }));
      form.addEventListener("input", atualizar);
      form.elements.fonte.addEventListener("change", async () => { await carregarFonte(form.elements.fonte.value); atualizar(); });
      root.querySelectorAll(".escrita-amostra").forEach((b) => b.addEventListener("click", () => { form.elements.cor.value = b.dataset.cor; atualizar(); }));
      carregarFonte(base.fonte).then(atualizar);
      atualizar();
    }
  });
}

/** Abre a janela no ponto clicado: edita o texto que está ali (se for seu) ou cria um novo. */
async function escreverEm(ponto) {
  const alvo = textoEm(ponto);

  const res = await dialogoTexto(alvo);
  if (res === "apagar" && alvo) return apagarTexto(alvo);
  if (!res || typeof res !== "object") return;
  if (!res.texto.trim()) return ui.notifications.warn("Escrita na Mesa: o texto está vazio.");

  await game.settings.set(MOD, "ultimaEscrita", { fonte: res.fonte, cor: res.cor, tamanho: res.tamanho, moldura: res.moldura, molduraCor: res.molduraCor, molduraLargura: res.molduraLargura });
  await carregarFonte(res.fonte, res.tamanho);

  if (alvo) {
    const cx = alvo.x + alvo.shape.width / 2, cy = alvo.y + alvo.shape.height / 2;
    return editarTexto(alvo, dadosDesenho(res, cx, cy));
  }
  return criarTexto(dadosDesenho(res, ponto.x, ponto.y));
}

/* Modo escrita: o próximo clique na mesa abre a janela. Esc cancela. */
let modoEscrita = false;
let avisoEscrita = null;

function alternarEscrita(ligar = !modoEscrita) {
  if (ligar && !canvas.ready) return ui.notifications.warn("Escrita na Mesa: abra uma cena antes.");
  modoEscrita = ligar;
  document.body.classList.toggle("escrita-ativa", ligar);
  avisoEscrita?.remove();
  avisoEscrita = null;
  if (ligar) {
    avisoEscrita = document.createElement("div");
    avisoEscrita.className = "escrita-aviso";
    avisoEscrita.innerHTML = `<i class="fas fa-pen-nib"></i> Clique na mesa onde quer escrever, ou num texto seu para editar. <b>Esc</b> cancela. Para girar um texto: <b>Shift + rodinha</b> em cima dele.`;
    document.body.append(avisoEscrita);
  }
}

function registrarModoEscrita() {
  document.addEventListener("pointerdown", (ev) => {
    if (!modoEscrita || ev.button !== 0 || !canvas.ready || ev.target !== canvas.app.view) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const ponto = canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
    alternarEscrita(false);
    escreverEm(ponto);
  }, true);

  document.addEventListener("keydown", (ev) => {
    if (modoEscrita && ev.key === "Escape") alternarEscrita(false);
  }, true);

  // Shift + rodinha do mouse sobre um texto seu: gira 15° por clique da rodinha
  const giroPendente = new Map();
  document.addEventListener("wheel", (ev) => {
    if (!ev.shiftKey || !canvas.ready || ev.target !== canvas.app.view) return;
    const alvo = textoEm(canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY }));
    if (!alvo) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const delta = ev.deltaY || ev.deltaX;
    if (!delta) return;
    const p = giroPendente.get(alvo.id) ?? { giro: alvo.rotation ?? 0, timer: null };
    p.giro = normalizarGiro(p.giro + (delta > 0 ? 15 : -15));
    clearTimeout(p.timer);
    p.timer = setTimeout(() => { giroPendente.delete(alvo.id); editarTexto(alvo, { rotation: p.giro }); }, 150);
    giroPendente.set(alvo.id, p);
  }, { capture: true, passive: false });

  // Textos da mesa não mostram a moldura de seleção do Foundry, só quando estão selecionados
  Hooks.on("refreshDrawing", (drawing) => {
    if (!ehTexto(drawing.document) || !drawing.frame) return;
    drawing.frame.visible = !!drawing.controlled;
  });

  Hooks.on("canvasTearDown", () => { if (modoEscrita) alternarEscrita(false); });

  // Botão na barra de controles de Tokens (v12: lista; v13: objeto)
  Hooks.on("getSceneControlButtons", (controls) => {
    const tool = { name: "escritaEscrever", title: "Escrever na mesa (Alt+T)", icon: "fas fa-pen-nib", button: true };
    if (Array.isArray(controls)) {
      controls.find((c) => c.name === "token")?.tools.push({ ...tool, onClick: () => alternarEscrita() });
    } else {
      const grupo = controls.tokens ?? controls.token;
      if (grupo?.tools) grupo.tools.escritaEscrever = { ...tool, order: Object.keys(grupo.tools).length + 1, onChange: () => alternarEscrita() };
    }
  });

  game.keybindings.register(MOD, "escrever", {
    name: "Escrever na mesa",
    hint: "Liga o modo de escrita: o próximo clique na mesa abre a janela de texto.",
    editable: [{ key: "KeyT", modifiers: ["Alt"] }],
    onDown: () => { alternarEscrita(); return true; }
  });
}

/* ------------------------------------------------------------------ */
/*  Inicialização                                                      */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  game.settings.register(MOD, "ultimaEscrita", { scope: "client", config: false, type: Object, default: { ...PADRAO_ESCRITA } });
  registrarFontes();
  registrarModoEscrita();
  const api = { alternarEscrita, escreverEm };
  game.modules.get(MOD).api = api;
  globalThis.EscritaNaMesa = api;
});

Hooks.once("ready", () => {
  registrarSocket();
  for (const f of Object.keys(FONTES_MESA)) carregarFonte(f);
});
