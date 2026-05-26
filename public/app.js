"use strict";

const FROTA_DEF = [
  {
    tipo: "porta-avioes",
    quantidade: 1,
    tamanho: 5,
    forma: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ],
    label: "Porta-aviões",
  },
  {
    tipo: "encouracado",
    quantidade: 2,
    tamanho: 4,
    forma: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    label: "Encouraçado",
  },
  {
    tipo: "hidroaviao",
    quantidade: 3,
    tamanho: 3,
    forma: [
      [0, 0],
      [1, -1],
      [2, 0],
    ],
    label: "Hidroavião",
  },
  {
    tipo: "submarino",
    quantidade: 4,
    tamanho: 1,
    forma: [[0, 0]],
    label: "Submarino",
  },
  {
    tipo: "cruzador",
    quantidade: 3,
    tamanho: 2,
    forma: [
      [0, 0],
      [1, 0],
    ],
    label: "Cruzador",
  },
];

const LARGURA = 10;
const ALTURA = 10;
const COLUNAS = "ABCDEFGHIJ";

let socket = null;
let meuId = null;
let meuNome = "";
let oponenteNome = "";
let rotacao = "horizontal";

let navioSelecionado = null;
let naviosAParaColocar = [];
let naviosColocados = [];
let previewCelulas = [];

let meuTabuleiro = null;
let inimigoAcertos = new Set();
let inimigoAgua = new Set();
let inimigoCelulasAfundadas = new Set();
let meuTurno = false;

function mostrarTela(id) {
  document
    .querySelectorAll(".tela")
    .forEach((t) => t.classList.remove("ativa"));
  document.getElementById(id).classList.add("ativa");
}

function chave(x, y) {
  return `${x},${y}`;
}

function rotacionarForma(forma, rot) {
  if (rot === "horizontal") return forma;
  const rotada = forma.map(([dx, dy]) => [dy, dx]);
  const minX = Math.min(...rotada.map(([dx]) => dx));
  const minY = Math.min(...rotada.map(([, dy]) => dy));
  return rotada.map(([dx, dy]) => [dx - minX, dy - minY]);
}

function celulasDaForma(forma, ox, oy, rot) {
  const f = rotacionarForma(forma, rot);
  return f.map(([dx, dy]) => ({ x: ox + dx, y: oy + dy }));
}

function dentroDaGrade(celulas) {
  return celulas.every(
    (c) => c.x >= 0 && c.x < LARGURA && c.y >= 0 && c.y < ALTURA,
  );
}

function seSobrepoe(celulas) {
  const usadas = new Set();
  for (const n of naviosColocados) {
    for (const c of n.celulas) usadas.add(chave(c.x, c.y));
  }
  return celulas.some((c) => usadas.has(chave(c.x, c.y)));
}

function adicionarLog(texto) {
  const log = document.getElementById("log-batalha");
  if (!log) return;
  const item = document.createElement("div");
  item.className = "log-item";
  item.textContent = texto;
  log.prepend(item);
}

function criarCelulaCabecalho(texto) {
  const div = document.createElement("div");
  div.className = "cabecalho";
  div.textContent = texto;
  return div;
}

function conectar(nome) {
  socket = new WebSocket(`ws://${window.location.host}`);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "entrar", nome }));
  });

  socket.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    tratarMensagem(msg);
  });

  socket.addEventListener("close", () => {
    if (document.getElementById("tela-fim").classList.contains("ativa")) return;
    alert("Conexão encerrada com o servidor.");
  });

  socket.addEventListener("error", () => {
    alert(
      "Erro de conexão. Verifique se o servidor está rodando em localhost:8080.",
    );
  });
}

function enviar(obj) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
  }
}

function tratarMensagem(msg) {
  switch (msg.type) {
    case "aguardando":
      meuId = msg.jogadorId;
      meuNome = msg.nome;
      document.getElementById("msg-aguardando").textContent =
        "Aguardando segundo jogador...";
      document.getElementById("info-nome").textContent =
        `Conectado como: ${msg.nome}`;
      mostrarTela("tela-aguardando");
      break;

    case "partida_iniciada":
      meuId = msg.meuId;
      meuNome = msg.meuNome;
      oponenteNome = msg.oponenteNome;
      iniciarPosicionamento(msg.frota);
      break;

    case "tabuleiro_aceito":
      document.getElementById("btn-confirmar").disabled = true;
      document.getElementById("btn-confirmar").textContent =
        "Aguardando oponente...";
      adicionarLog("Tabuleiro enviado. Aguardando oponente...");
      break;

    case "oponente_pronto":
      document.getElementById("status-oponente-pos").textContent =
        `${oponenteNome} finalizou o posicionamento.`;
      break;

    case "batalha_iniciada":
      iniciarBatalha(msg.turnoDeId);
      break;

    case "resultado_disparo":
      processarResultadoDisparo(msg);
      break;

    case "fim_de_partida":
      processarFimDePartida(msg);
      break;

    case "oponente_desconectou":
      alert(`${oponenteNome} desconectou. A partida foi encerrada.`);
      mostrarTela("tela-login");
      break;

    case "erro":
      adicionarLog(`[erro] ${msg.texto}`);
      console.error("[servidor]", msg.texto);
      break;
  }
}

function iniciarPosicionamento() {
  naviosColocados = [];
  previewCelulas = [];
  navioSelecionado = null;
  rotacao = "horizontal";

  naviosAParaColocar = [];
  for (const entrada of FROTA_DEF) {
    for (let i = 0; i < entrada.quantidade; i++) {
      naviosAParaColocar.push({
        tipo: entrada.tipo,
        forma: entrada.forma,
        label: entrada.label,
      });
    }
  }

  document.getElementById("btn-horizontal").classList.add("ativo");
  document.getElementById("btn-vertical").classList.remove("ativo");
  document.getElementById("status-oponente-pos").textContent = "";
  document.getElementById("btn-confirmar").disabled = true;
  document.getElementById("btn-confirmar").textContent =
    "Confirmar posicionamento";

  renderizarListaFrota();
  renderizarTabuleiroPos();
  mostrarTela("tela-posicionamento");
}

function renderizarListaFrota() {
  const lista = document.getElementById("lista-frota");
  lista.innerHTML = "";

  const contagem = {};
  for (const n of naviosAParaColocar) {
    contagem[n.tipo] = (contagem[n.tipo] || 0) + 1;
  }

  for (const def of FROTA_DEF) {
    const qtd = contagem[def.tipo] || 0;
    const item = document.createElement("div");
    item.className = "frota-item" + (qtd === 0 ? " colocado" : "");
    if (navioSelecionado && navioSelecionado.tipo === def.tipo)
      item.classList.add("selecionado");

    if (qtd > 0) {
      item.addEventListener("click", () => selecionarNavio(def.tipo));
    }

    item.innerHTML = `<span class="frota-tipo">${def.label}</span><span class="frota-qtd">${qtd > 0 ? qtd + " restante" + (qtd !== 1 ? "s" : "") : "✓ colocado"}</span>`;
    lista.appendChild(item);
  }
}

function selecionarNavio(tipo) {
  const idx = naviosAParaColocar.findIndex((n) => n.tipo === tipo);
  if (idx === -1) return;
  navioSelecionado = { ...naviosAParaColocar[idx], indice: idx };
  renderizarListaFrota();
}

function renderizarTabuleiroPos() {
  const tab = document.getElementById("tabuleiro-posicionamento");
  tab.innerHTML = "";
  tab.style.gridTemplateColumns = `30px repeat(${LARGURA}, 1fr)`;

  const mapaNavios = {};
  for (const n of naviosColocados) {
    for (const c of n.celulas) {
      mapaNavios[chave(c.x, c.y)] = n.tipo;
    }
  }

  const mapaPreview = new Set(previewCelulas.map((c) => chave(c.x, c.y)));
  const previewValido =
    previewCelulas.length > 0 &&
    dentroDaGrade(previewCelulas) &&
    !seSobrepoe(previewCelulas);

  tab.appendChild(criarCelulaCabecalho(""));
  for (let x = 0; x < LARGURA; x++)
    tab.appendChild(criarCelulaCabecalho(COLUNAS[x]));

  for (let y = 0; y < ALTURA; y++) {
    tab.appendChild(criarCelulaCabecalho(String(y + 1)));
    for (let x = 0; x < LARGURA; x++) {
      const div = document.createElement("div");
      div.className = "celula";
      const k = chave(x, y);

      if (mapaPreview.has(k)) {
        div.classList.add(
          previewValido ? "preview-valido" : "preview-invalido",
        );
      } else if (mapaNavios[k]) {
        div.classList.add("navio");
        div.title = mapaNavios[k];
      }

      div.addEventListener("mouseenter", () => {
        if (!navioSelecionado) return;
        previewCelulas = celulasDaForma(navioSelecionado.forma, x, y, rotacao);
        renderizarTabuleiroPos();
      });

      div.addEventListener("click", () => {
        if (!navioSelecionado) return;
        const celulas = celulasDaForma(navioSelecionado.forma, x, y, rotacao);
        if (!dentroDaGrade(celulas)) {
          adicionarLog("Navio fora dos limites!");
          return;
        }
        if (seSobrepoe(celulas)) {
          adicionarLog("Posição ocupada!");
          return;
        }

        naviosColocados.push({ tipo: navioSelecionado.tipo, celulas });
        naviosAParaColocar.splice(navioSelecionado.indice, 1);
        navioSelecionado = null;
        previewCelulas = [];

        renderizarListaFrota();
        renderizarTabuleiroPos();

        if (naviosAParaColocar.length === 0) {
          document.getElementById("btn-confirmar").disabled = false;
        }
      });

      tab.appendChild(div);
    }
  }
}

function iniciarBatalha(turnoDeId) {
  meuTurno = turnoDeId === meuId;
  meuTabuleiro = { navios: naviosColocados, acertos: new Set(), afundados: [] };
  inimigoAcertos = new Set();
  inimigoAgua = new Set();
  inimigoCelulasAfundadas = new Set();

  document.getElementById("info-partida").textContent =
    `${meuNome} vs ${oponenteNome}`;
  atualizarStatusTurno();
  renderizarMeuTabuleiro();
  renderizarTabuleiroInimigo();
  mostrarTela("tela-batalha");
  adicionarLog("Batalha iniciada!");
}

function atualizarStatusTurno() {
  const el = document.getElementById("status-turno");
  el.textContent = meuTurno
    ? "Sua vez de atacar!"
    : `Vez de ${oponenteNome}`;
  el.className = "status-turno " + (meuTurno ? "meu-turno" : "turno-oponente");

  const tabInimigo = document.getElementById("tabuleiro-inimigo");
  tabInimigo.classList.toggle("clicavel", meuTurno);
  tabInimigo.classList.toggle("bloqueado", !meuTurno);
}

function renderizarMeuTabuleiro() {
  const tab = document.getElementById("tabuleiro-meu");
  tab.innerHTML = "";
  tab.style.gridTemplateColumns = `30px repeat(${LARGURA}, 1fr)`;

  const mapaNavios = {};
  for (const n of meuTabuleiro.navios) {
    for (const c of n.celulas) mapaNavios[chave(c.x, c.y)] = n.tipo;
  }

  const afundadasCelulas = new Set();
  for (const n of meuTabuleiro.navios) {
    const ks = n.celulas.map((c) => chave(c.x, c.y));
    if (ks.every((k) => meuTabuleiro.acertos.has(k))) {
      ks.forEach((k) => afundadasCelulas.add(k));
    }
  }

  tab.appendChild(criarCelulaCabecalho(""));
  for (let x = 0; x < LARGURA; x++)
    tab.appendChild(criarCelulaCabecalho(COLUNAS[x]));

  for (let y = 0; y < ALTURA; y++) {
    tab.appendChild(criarCelulaCabecalho(String(y + 1)));
    for (let x = 0; x < LARGURA; x++) {
      const div = document.createElement("div");
      div.className = "celula";
      const k = chave(x, y);

      if (afundadasCelulas.has(k)) {
        div.classList.add("afundado");
        div.textContent = "X";
      } else if (meuTabuleiro.acertos.has(k) && mapaNavios[k]) {
        div.classList.add("acertado");
        div.textContent = "X";
      } else if (meuTabuleiro.acertos.has(k)) {
        div.classList.add("agua");
        div.textContent = "•";
      } else if (mapaNavios[k]) {
        div.classList.add("navio");
      }

      tab.appendChild(div);
    }
  }
}

function renderizarTabuleiroInimigo() {
  const tab = document.getElementById("tabuleiro-inimigo");
  tab.innerHTML = "";
  tab.style.gridTemplateColumns = `30px repeat(${LARGURA}, 1fr)`;

  tab.appendChild(criarCelulaCabecalho(""));
  for (let x = 0; x < LARGURA; x++)
    tab.appendChild(criarCelulaCabecalho(COLUNAS[x]));

  for (let y = 0; y < ALTURA; y++) {
    tab.appendChild(criarCelulaCabecalho(String(y + 1)));
    for (let x = 0; x < LARGURA; x++) {
      const div = document.createElement("div");
      div.className = "celula";
      const k = chave(x, y);

      if (inimigoCelulasAfundadas.has(k)) {
        div.classList.add("afundado");
        div.textContent = "X";
      } else if (inimigoAcertos.has(k)) {
        div.classList.add("acertado");
        div.textContent = "X";
      } else if (inimigoAgua.has(k)) {
        div.classList.add("agua");
        div.textContent = "•";
      }

      const jaDisparado =
        inimigoAcertos.has(k) ||
        inimigoAgua.has(k) ||
        inimigoCelulasAfundadas.has(k);
      if (!jaDisparado) {
        div.addEventListener("click", () => {
          if (!meuTurno) return;
          enviar({ type: "disparar", x, y });
          meuTurno = false;
          atualizarStatusTurno();
        });
      }

      tab.appendChild(div);
    }
  }
}

function processarResultadoDisparo(msg) {
  const { atiradorId, disparo, turnoDeId } = msg;
  const fui = atiradorId === meuId;

  if (fui) {
    if (disparo.acertou) {
      inimigoAcertos.add(chave(disparo.x, disparo.y));
      if (disparo.afundou && disparo.celulasAfundadas) {
        for (const c of disparo.celulasAfundadas)
          inimigoCelulasAfundadas.add(chave(c.x, c.y));
      }
    } else {
      inimigoAgua.add(chave(disparo.x, disparo.y));
    }
  } else {
    meuTabuleiro.acertos.add(chave(disparo.x, disparo.y));
    if (disparo.afundou) meuTabuleiro.afundados.push(disparo.tipoNavio);
  }

  const pos = `${COLUNAS[disparo.x]}${disparo.y + 1}`;
  const quem = fui ? "Você" : oponenteNome;
  let logMsg = `${quem} atacou ${pos}: `;
  if (!disparo.acertou) logMsg += "ÁGUA";
  else if (disparo.afundou) logMsg += `AFUNDOU ${disparo.tipoNavio}!`;
  else logMsg += "ACERTOU!";
  adicionarLog(logMsg);

  meuTurno = turnoDeId === meuId;
  atualizarStatusTurno();
  renderizarMeuTabuleiro();
  renderizarTabuleiroInimigo();
}

function processarFimDePartida(msg) {
  const { disparo, vencedorId, vencedorNome } = msg;
  const fui = msg.atiradorId === meuId;

  if (fui) {
    if (disparo.acertou) inimigoAcertos.add(chave(disparo.x, disparo.y));
    else inimigoAgua.add(chave(disparo.x, disparo.y));
    if (disparo.celulasAfundadas) {
      for (const c of disparo.celulasAfundadas)
        inimigoCelulasAfundadas.add(chave(c.x, c.y));
    }
  } else {
    meuTabuleiro.acertos.add(chave(disparo.x, disparo.y));
  }

  renderizarMeuTabuleiro();
  renderizarTabuleiroInimigo();

  const venceu = vencedorId === meuId;
  document.getElementById("resultado-texto").textContent = venceu
    ? `Vitória, ${meuNome}! Você afundou toda a frota de ${oponenteNome}.`
    : `${vencedorNome} venceu. Sua frota foi destruída.`;

  mostrarTela("tela-fim");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-entrar").addEventListener("click", () => {
    const nome =
      document.getElementById("input-nome").value.trim() || "Almirante";
    conectar(nome);
  });

  document.getElementById("input-nome").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-entrar").click();
  });

  document.getElementById("btn-horizontal").addEventListener("click", () => {
    rotacao = "horizontal";
    document.getElementById("btn-horizontal").classList.add("ativo");
    document.getElementById("btn-vertical").classList.remove("ativo");
  });

  document.getElementById("btn-vertical").addEventListener("click", () => {
    rotacao = "vertical";
    document.getElementById("btn-vertical").classList.add("ativo");
    document.getElementById("btn-horizontal").classList.remove("ativo");
  });

  document
    .getElementById("tabuleiro-posicionamento")
    .addEventListener("mouseleave", () => {
      previewCelulas = [];
      renderizarTabuleiroPos();
    });

  document.getElementById("btn-confirmar").addEventListener("click", () => {
    if (naviosAParaColocar.length > 0) return;
    enviar({ type: "enviar_tabuleiro", navios: naviosColocados });
    document.getElementById("btn-confirmar").disabled = true;
    document.getElementById("btn-confirmar").textContent =
      "Aguardando oponente...";
  });

  document
    .getElementById("btn-jogar-novamente")
    .addEventListener("click", () => {
      if (socket) socket.close();
      mostrarTela("tela-login");
      document.getElementById("input-nome").value = "";
    });
});
