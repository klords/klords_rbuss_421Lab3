// module imports
const fs = require('fs');
const http = require('http');
const url = require('url');
const qstring = require('querystring');
const EventEmitter = require('events');

// constants
const SERVER_PORT = 3000;

// class declarations
class BlogResponder extends EventEmitter {
    constructor() {
        super();
        this.req = null;
        this.res = null;
        this.articleList = [];
        this.userRole = 'visitor';
        this.target = '';
        this.statusCode = 200;
        this.responseHeader = {};
        this.responseBody = [];
        this.loadQueue = [];
        this.initListeners();
    }

    initListeners() {
        this.on('articlesLoaded', this.getRequestTarget);
        this.on('targetAcquired', this.generatePayload);
        this.on('payloadLoaded', this.generateHeader);
        this.on('responseReady', this.sendResponse);
    }

    getArticles() {
        fs.readdir('.', (err, files) => {
            if (err) throw err;
            this.articleList = files.filter((name) => {
                return name.endsWith('.art');
            });
            this.emit('articlesLoaded');
        });
    }

    handleRequest(req, res) {
        this.req = req;
        this.res = res;

        this.userRole = this.getUserRole();

        // do first async task
        this.getArticles();
    }

    getUserRole() {
        if (!this.req.headers.cookie)
            return 'visitor';
        let cookieList = this.req.headers.cookie.split(';');
        let cookies = {};
        for (let cookie of cookieList) {
            let cookieVals = cookie.split('=');
            cookies[cookieVals[0]] = cookieVals[1];
        }
        if (cookies.Role)
            return cookies.Role;
        return 'visitor';
    }

    getContentType() {
        let target = this.target.toLowerCase();
        if (target.endsWith('.png'))
            return 'image/png';
        return 'text/html';
    }

    getRequestTarget() {
        // routing logic
        let target = `.${this.req.url}`;
        target = target.replace(/\.\./g, ''); // no directory traversal

        if (target === './auth')
            target += '/';

        if (target === './auth/')
            target = './auth.html'; // I'm assuming we can't have an auth directory for now
        else if (target.endsWith('/'))
            target += 'index.html'; // landing page

        this.target = target;
        this.emit('targetAcquired');
    }

    generateHeader() {
        // set user cookie
        let expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + 7); // 1 week expiration
        this.responseHeader['Set-Cookie'] = [`Role=${this.userRole}; Expires=${expireDate.toUTCString()}; Path=/; HttpOnly;`];

        // set content type
        this.responseHeader['Content-Type'] = this.getContentType();
    }

    generateResponse() {
        // if target is landing page
            // populate queue with [header, article data, footer]
        // if target is blog (article file)
            // if user has access
                // populate queue with [header, linked article fragments, footer]
            // else
                // send 403
        // if target is auth page
            // populate queue with [header, auth form, footer]
        // if target is anything else (direct file access)
            // populate queue with [file]
    }

    loadFragment(fragPath) {
        let outputStream = fs.createReadStream(this.target);

        outputStream.on('error', (err) => {
            this.statusCode = 404;
            this.responseHeader['Content-Type'] = 'text/html';
            this.responseBody = "Much like U2, we still haven't found what you're looking for.";
            this.emit('responseReady');
        });

        outputStream.on('data', (chunk) => {
            this.responseBody.push(Buffer.from(chunk));
        });

        outputStream.on('end', () => {
            this.emit('payloadLoaded');
        });
    }

    sendResponse() {
        this.res.writeHead(this.statusCode, this.responseHeader);
        this.res.end(Buffer.concat(this.responseBody));
    }
}

// start the server
http.createServer((req, res) => {
        let responder = new BlogResponder();
        responder.handleRequest(req, res);
    })
    .listen(SERVER_PORT,() => {
        console.log(`The blog service is alive on port ${SERVER_PORT}!`);
    });