const https = require('https');
const http = require('http');
const PORT = process.env.PORT || 3000;

// CORRECAO: hosts/paths permitidos passam a ser configuraveis via header,
// com fallback para NF-e (comportamento original preservado).
// Isso evita que qualquer destino arbitrario seja aceito (validacao de
// allowlist) enquanto generaliza o proxy para outros DF-e (CT-e, etc).
const DESTINOS_PERMITIDOS = {
  'nfe': {
    hostname: 'www1.nfe.fazenda.gov.br',
    path: '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  },
  'nfe-evento': {
    hostname: 'www.nfe.fazenda.gov.br',
    path: '/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
  'cte': {
    hostname: 'www1.cte.fazenda.gov.br',
    path: '/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
  },
};

const server = http.createServer((req, res) => {
  // Configuracao de CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cert-Pem, X-Key-Pem, X-Soap-Action, X-Destino');

  // 1. Responder a requisicoes GET (Health Check do Render)
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Proxy SEFAZ is live!');
    return;
  }

  // 2. Responder a requisicoes OPTIONS (CORS)
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 3. Processar requisicoes POST (Captura de Notas)
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const certPem = decodeURIComponent(req.headers['x-cert-pem'] || '');
        const keyPem = decodeURIComponent(req.headers['x-key-pem'] || '');
        const soapAction = req.headers['x-soap-action'];

        // CORRECAO: novo header opcional X-Destino seleciona o alvo.
        // Se ausente, mantem 'nfe' como default — comportamento original
        // preservado para nao quebrar nada que ja esta em producao.
        const destinoKey = (req.headers['x-destino'] || 'nfe').toLowerCase();
        const destino = DESTINOS_PERMITIDOS[destinoKey];

        if (!destino) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Destino invalido: ' + destinoKey + '. Validos: ' + Object.keys(DESTINOS_PERMITIDOS).join(', ') }));
          return;
        }

        if (!certPem || !keyPem || certPem === 'undefined' || certPem === '') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Certificado ou Key ausentes nos headers' }));
          return;
        }

        const options = {
          hostname: destino.hostname,
          port: 443,
          path: destino.path,
          method: 'POST',
          cert: certPem,
          key: keyPem,
          headers: {
            'Content-Type': 'application/soap+xml;charset=UTF-8',
            'SOAPAction': soapAction,
            'Content-Length': Buffer.byteLength(body)
          },
          secureProtocol: 'TLSv1_2_method',
          rejectUnauthorized: false
        };

        console.log('[Proxy] -> ' + destinoKey + ' (' + destino.hostname + destino.path + ')');

        const sefazReq = https.request(options, (sefazRes) => {
          let responseData = '';
          sefazRes.on('data', d => { responseData += d; });
          sefazRes.on('end', () => {
            res.writeHead(sefazRes.statusCode, { 'Content-Type': 'application/xml' });
            res.end(responseData);
          });
        });

        sefazReq.on('error', (e) => {
          console.error('[Proxy] Erro ao conectar em ' + destino.hostname + ': ' + e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Erro SEFAZ (' + destinoKey + ')', details: e.message }));
        });

        sefazReq.write(body);
        sefazReq.end();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Erro Proxy', details: err.message }));
      }
    });
  } else {
    res.writeHead(405);
    res.end('Metodo nao permitido');
  }
});

// Importante: Escutar em 0.0.0.0 para o Render conseguir detectar a porta
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy Relay ON na porta ${PORT}`);
});
