const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Configuração de CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cert-Pem, X-Key-Pem, X-Soap-Action');

  // 1. Responder a requisições GET (Health Check do Render)
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Proxy SEFAZ is live!');
    return;
  }

  // 2. Responder a requisições OPTIONS (CORS)
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 3. Processar requisições POST (Captura de Notas)
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const certPem = decodeURIComponent(req.headers['x-cert-pem'] || '');
        const keyPem = decodeURIComponent(req.headers['x-key-pem'] || '');
        const soapAction = req.headers['x-soap-action'];

        if (!certPem || !keyPem || certPem === 'undefined' || certPem === '') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Certificado ou Key ausentes nos headers' }));
          return;
        }

        const options = {
          hostname: 'www1.nfe.fazenda.gov.br',
          port: 443,
          path: '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
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

        const sefazReq = https.request(options, (sefazRes) => {
          let responseData = '';
          sefazRes.on('data', d => { responseData += d; });
          sefazRes.on('end', () => {
            res.writeHead(sefazRes.statusCode, { 'Content-Type': 'application/xml' });
            res.end(responseData);
          });
        });

        sefazReq.on('error', (e) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Erro SEFAZ', details: e.message }));
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
    res.end('Método não permitido');
  }
});

// Importante: Escutar em 0.0.0.0 para o Render conseguir detectar a porta
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy Relay ON na porta ${PORT}`);
});
