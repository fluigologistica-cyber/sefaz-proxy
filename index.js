const https = require('https');
const http = require('http');

/**
 * SEFAZ Proxy Relay
 * 
 * Este servidor atua como uma ponte (relay) entre o Base44 (que tem limitações de mTLS)
 * e a SEFAZ Nacional. Ele recebe o envelope SOAP via HTTP POST comum e repassa para 
 * a SEFAZ usando o Certificado Digital (mTLS).
 */

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Configuração de CORS para permitir chamadas do Base44
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cert-Pem, X-Key-Pem, X-Soap-Action');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        // O Base44 envia o Certificado e a Key nos Headers (ou você pode chumbar no código do proxy por segurança)
        const certPem = req.headers['x-cert-pem']?.replace(/\\n/g, '\n');
        const keyPem = req.headers['x-key-pem']?.replace(/\\n/g, '\n');
        const soapAction = req.headers['x-soap-action'];

        if (!certPem || !keyPem) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Certificado ou Key não fornecidos nos headers' }));
          return;
        }

        // Configuração da chamada mTLS para a SEFAZ
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
          // Importante: A SEFAZ exige TLS 1.2
          secureProtocol: 'TLSv1_2_method',
          rejectUnauthorized: false // Em produção, o ideal é validar a CA da SEFAZ
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
          console.error('Erro na conexão com SEFAZ:', e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Erro ao conectar na SEFAZ', details: e.message }));
        });

        sefazReq.write(body);
        sefazReq.end();

      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Erro interno no Proxy', details: err.message }));
      }
    });
  } else {
    res.writeHead(405);
    res.end('Método não permitido');
  }
});

server.listen(PORT, () => {
  console.log(`Proxy Relay rodando na porta ${PORT}`);
});
