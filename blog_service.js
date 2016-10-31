const fs = require('fs');
const http = require('http');
const url = require('url');
const qstring = require('querystring');

const SERVER_PORT = 3000;

function getRequestTarget(req) {
    // routing logic
    let target = `.${req.url}`;

    target = target.replace(/\.\./g, ''); // no directory traversal

    if (target === './auth') {
        target += '/';
    } 

    if (target === './auth/') {
        target = './auth.html'; // I'm assuming we can't have an auth directory for now
    } else if (target.endsWith('/')) {
        target += 'index.html'; // landing page
    }
    
    return target;
}

function requestHandler(req, res) {
    // main request handling logic
    let target = getRequestTarget(req);

    let articleList;
    fs.readdir('.', (err, files) => {
        if (err) throw err;
        articleList = files.filter((name) => {
            return name.endsWith('.art');
        });
    });

    let outputStream = fs.createReadStream(target);

    outputStream.on('error', (err) => {
        res.writeHead(404, 'Not Found');
        res.write("Much like U2, we still haven't found what you're looking for.");
        res.end();
    });

    res.writeHead(200);
    outputStream.pipe(res);
}

// start the server
http.createServer(requestHandler)
    .listen(SERVER_PORT,() => {
        console.log(`The blog service is alive on port ${SERVER_PORT}!`);
    });