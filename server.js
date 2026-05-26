const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORTA = 8080;
const LARGURA = 10;
const ALTURA = 10;

const FROTA = [
  { tipo: 'porta-avioes', quantidade: 1, tamanho: 5, forma: [[0,0],[1,0],[2,0],[3,0],[4,0]] },
  { tipo: 'encouracado',  quantidade: 2, tamanho: 4, forma: [[0,0],[1,0],[2,0],[3,0]] },
  { tipo: 'hidroaviao',   quantidade: 3, tamanho: 3, forma: [[0,0],[1,1],[2,0]] },
  { tipo: 'submarino',    quantidade: 4, tamanho: 1, forma: [[0,0]] },
  { tipo: 'cruzador',     quantidade: 3, tamanho: 2, forma: [[0,0],[1,0]] }
];

function gerarListaNavios() {
  const lista = [];
  for (const entrada of FROTA) {
    for (let i = 0; i < entrada.quantidade; i++) {
      lista.push({ tipo: entrada.tipo, forma: entrada.forma });
    }
  }
  return lista;
}

const publicDir = path.join(__dirname, 'public');
const partidas = new Map();
const filaEspera = []; 
let proximaPartidaId = 1;
let proximoJogadorId = 1;


function obterTipo(caminho) {
  const ext = path.extname(caminho);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

const servidorHttp = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const seguro = path.normalize(url).replace(/^(\.\.[/\\])+/, '');
  const completo = path.join(publicDir, seguro);
  fs.readFile(completo, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': obterTipo(completo) });
    res.end(data);
  });
});

const servidorWs = new WebSocket.Server({ server: servidorHttp });


function enviar(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

//
class Partida {
  constructor(id, ws1, ws2) {
    this.id = id;
    this.jogadores = [
      { ws: ws1, id: ws1._jogadorId, nome: ws1._nome, tabuleiro: null, prontoParaBatalha: false },
      { ws: ws2, id: ws2._jogadorId, nome: ws2._nome, tabuleiro: null, prontoParaBatalha: false }
    ];
    this.fase = 'posicionamento'; 
    this.turnoIdx = 0;
    this.vencedor = null;

    ws1._partidaId = id;
    ws2._partidaId = id;

    this.iniciar();
  }

  iniciar() {
    const listaNavios = gerarListaNavios();
    for (const j of this.jogadores) {
      enviar(j.ws, {
        type: 'partida_iniciada',
        partidaId: this.id,
        meuId: j.id,
        meuNome: j.nome,
        oponenteNome: this.oponente(j.ws).nome,
        fase: 'posicionamento',
        frota: listaNavios,
        largura: LARGURA,
        altura: ALTURA
      });
    }
  }

  oponente(ws) {
    return this.jogadores.find(j => j.ws !== ws);
  }

  jogador(ws) {
    return this.jogadores.find(j => j.ws === ws);
  }

  receberTabuleiro(ws, navios) {
    const j = this.jogador(ws);
    if (!j || this.fase !== 'posicionamento') return;
    if (j.tabuleiro) { enviar(ws, { type: 'erro', texto: 'Tabuleiro já enviado.' }); return; }

    const valido = this.validarNavios(navios);
    if (!valido.ok) {
      enviar(ws, { type: 'erro', texto: valido.motivo });
      return;
    }

    j.tabuleiro = { navios, acertos: new Set(), afundados: [] };
    enviar(ws, { type: 'tabuleiro_aceito' });
    enviar(this.oponente(ws).ws, { type: 'oponente_pronto' });

    if (this.jogadores.every(j => j.tabuleiro !== null)) {
      this.iniciarBatalha();
    }
  }

  validarNavios(navios) {
    const ocupadas = new Set();
    const esperados = gerarListaNavios();

    if (navios.length !== esperados.length) {
      return { ok: false, motivo: `Número de navios incorreto. Esperado: ${esperados.length}, recebido: ${navios.length}` };
    }

    const contagem = {};
    for (const n of navios) {
      contagem[n.tipo] = (contagem[n.tipo] || 0) + 1;
    }
    for (const entrada of FROTA) {
      if ((contagem[entrada.tipo] || 0) !== entrada.quantidade) {
        return { ok: false, motivo: `Quantidade incorreta de ${entrada.tipo}` };
      }
    }

    for (const navio of navios) {
      const entrada = FROTA.find(f => f.tipo === navio.tipo);
      if (!entrada) return { ok: false, motivo: `Tipo desconhecido: ${navio.tipo}` };
      if (navio.celulas.length !== entrada.forma.length) {
        return { ok: false, motivo: `Tamanho incorreto para ${navio.tipo}: esperado ${entrada.forma.length}, recebido ${navio.celulas.length}` };
      }
      for (const c of navio.celulas) {
        if (c.x < 0 || c.x >= LARGURA || c.y < 0 || c.y >= ALTURA) {
          return { ok: false, motivo: 'Navio fora dos limites do tabuleiro.' };
        }
        const chave = `${c.x},${c.y}`;
        if (ocupadas.has(chave)) return { ok: false, motivo: 'Navios sobrepostos.' };
        ocupadas.add(chave);
      }
    }
    return { ok: true };
  }

  iniciarBatalha() {
    this.fase = 'batalha';
    this.turnoIdx = 0;
    for (const j of this.jogadores) {
      enviar(j.ws, {
        type: 'batalha_iniciada',
        turnoDeId: this.jogadores[this.turnoIdx].id
      });
    }
  }

  receberDisparo(ws, x, y) {
    if (this.fase !== 'batalha') return;
    const atirador = this.jogador(ws);
    const alvo = this.oponente(ws);

    if (this.jogadores[this.turnoIdx].ws !== ws) {
      enviar(ws, { type: 'erro', texto: 'Não é o seu turno.' });
      return;
    }
    if (x < 0 || x >= LARGURA || y < 0 || y >= ALTURA) {
      enviar(ws, { type: 'erro', texto: 'Posição fora do tabuleiro.' });
      return;
    }

    const chave = `${x},${y}`;
    if (alvo.tabuleiro.acertos.has(chave)) {
      enviar(ws, { type: 'erro', texto: 'Posição já disparada.' });
      return;
    }

    alvo.tabuleiro.acertos.add(chave);

    let navioAtingido = null;
    let afundou = false;
    for (const navio of alvo.tabuleiro.navios) {
      if (navio.celulas.some(c => c.x === x && c.y === y)) {
        navioAtingido = navio;
        afundou = navio.celulas.every(c => alvo.tabuleiro.acertos.has(`${c.x},${c.y}`));
        if (afundou) alvo.tabuleiro.afundados.push(navio.tipo);
        break;
      }
    }

    const resultado = {
      x, y,
      acertou: !!navioAtingido,
      afundou,
      tipoNavio: navioAtingido ? navioAtingido.tipo : null,
      celulasAfundadas: afundou ? navioAtingido.celulas : null
    };

    const totalCelulas = alvo.tabuleiro.navios.reduce((s, n) => s + n.celulas.length, 0);
    const ganhou = alvo.tabuleiro.acertos.size >= totalCelulas &&
      alvo.tabuleiro.navios.every(n => n.celulas.every(c => alvo.tabuleiro.acertos.has(`${c.x},${c.y}`)));

    if (ganhou) {
      this.fase = 'fim';
      this.vencedor = atirador.id;
      for (const j of this.jogadores) {
        enviar(j.ws, {
          type: 'fim_de_partida',
          vencedorId: atirador.id,
          vencedorNome: atirador.nome,
          disparo: resultado,
          atiradorId: atirador.id
        });
      }

      partidas.delete(this.id);
      return;
    }

    this.turnoIdx = 1 - this.turnoIdx;

    for (const j of this.jogadores) {
      enviar(j.ws, {
        type: 'resultado_disparo',
        atiradorId: atirador.id,
        disparo: resultado,
        turnoDeId: this.jogadores[this.turnoIdx].id
      });
    }
  }

  jogadorDesconectou(ws) {
    if (this.fase === 'fim') return;
    const outro = this.oponente(ws);
    if (outro) {
      enviar(outro.ws, { type: 'oponente_desconectou' });
    }
    partidas.delete(this.id);
  }
}

servidorWs.on('connection', (ws) => {
  ws._jogadorId = proximoJogadorId++;
  ws._nome = null;
  ws._partidaId = null;

  console.log(`Conexão ${ws._jogadorId}`);

  ws.on('message', (dados) => {
    let msg;
    try { msg = JSON.parse(dados.toString()); } catch { enviar(ws, { type: 'erro', texto: 'Mensagem inválida.' }); return; }

    if (msg.type === 'entrar') {
      ws._nome = (msg.nome || '').trim() || `Jogador ${ws._jogadorId}`;
      filaEspera.push(ws);
      enviar(ws, { type: 'aguardando', jogadorId: ws._jogadorId, nome: ws._nome, posicaoNaFila: filaEspera.length });

      if (filaEspera.length >= 2) {
        const ws1 = filaEspera.shift();
        const ws2 = filaEspera.shift();
        const id = proximaPartidaId++;
        const partida = new Partida(id, ws1, ws2);
        partidas.set(id, partida);
        console.log(`Partida ${id} iniciada entre ${ws1._nome} e ${ws2._nome}`);
      }
      return;
    }

    const partida = partidas.get(ws._partidaId);
    if (!partida) { enviar(ws, { type: 'erro', texto: 'Sem partida ativa.' }); return; }

    if (msg.type === 'enviar_tabuleiro') {
      partida.receberTabuleiro(ws, msg.navios);
      return;
    }

    if (msg.type === 'disparar') {
      partida.receberDisparo(ws, msg.x, msg.y);
      return;
    }

    enviar(ws, { type: 'erro', texto: 'Tipo de mensagem desconhecido.' });
  });

  ws.on('close', () => {
    const idx = filaEspera.indexOf(ws);
    if (idx !== -1) filaEspera.splice(idx, 1);

    if (ws._partidaId) {
      const partida = partidas.get(ws._partidaId);
      if (partida) partida.jogadorDesconectou(ws);
    }
    console.log(`Desconexão ${ws._jogadorId}`);
  });
});

servidorHttp.listen(PORTA, () => {
  console.log(`Servidor rodando em http://localhost:${PORTA}`);
});
