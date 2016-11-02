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
            if (this.articleList.length > 0) {
                let tempArticles = this.articleList;
                this.articleList = [];
                this.loadArticleData(tempArticles);
            } else
                this.emit('articlesLoaded');
        });
    }

    loadArticleData(articleNames) {
        if (articleNames.length === 0) {
            this.emit('articlesLoaded');
            return;
        }
        let currentArticle = articleNames.pop();
        fs.readFile(currentArticle, 'utf8', (err, data) => {
            if (err) {
                this.sendError(500);
                return;
            }
            let articleObj = JSON.parse(data);
            articleObj.name = currentArticle;
            this.articleList.push(articleObj);
            this.loadArticleData(articleNames);
        });
    }

    handleRequest(req, res) {
        this.req = req;
        this.res = res;

        let requestData = '';
        if (this.req.method === 'POST') {
            this.req.on('data', (data) => {
                requestData += data.toString();
            });

            this.req.on('end', () => {
                this.req.requestData = requestData;
            });
        }

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
        // routing and authentication logic
        let targetObj = url.parse(this.req.url);
        let queryObj = null;
        if (targetObj.query) {
            queryObj = qstring.parse(targetObj.query);
        } else if (this.req.requestData) {
            queryObj = qstring.parse(this.req.requestData);
        }
        let target = `.${targetObj.href}`;
        target = target.replace(/\.\./g, ''); // no directory traversal

        switch (target) {
            case './':
                target = './blogs/landing.html';
                break;
            case './auth':
                if (queryObj  && queryObj.username == queryObj.password) {
                    this.userRole = 'reviewer';
                    target = './blogs/landing.html';
                } else {
                    target = './blogs/auth.html';
                }
                break;
            case './quit':
                this.userRole = 'visitor';
                this.statusCode = 302;
                this.responseHeader = {
                    'Location': './blogs/landing.html'
                };
                this.emit('payloadLoaded');
                return;
        }            

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

        this.emit('responseReady');
    }

    generatePayload() {
        let headerPath = './blogs/header.html';
        let footerPath = './blogs/footer.html';

        if (this.target === './blogs/landing.html') {
            this.loadQueue.push({name:headerPath, type:"file"});
            for (let x of this.articleList) {
                this.loadQueue.push({name:x.name, type:"article"});
            }
            this.loadQueue.push({name:footerPath, type:"file"});
        } else if (this.target.endsWith('.art')) {
            let targetArticle = this.articleList.filter((article) => {
                return this.target.endsWith(article.name);
            })[0];
            if ((this.userRole === 'visitor' && targetArticle.Public === 'yes') || (this.userRole === 'reviewer')) {
                this.loadQueue.push({name:headerPath, type:"file"});
                for (let fragment of targetArticle.Fragments) {
                    this.loadQueue.push({name:`./blogs/${fragment}`, type:"file"});
                }
                this.loadQueue.push({name:footerPath, type:"file"});
            } else {
                this.sendError(403);
                return;
            }
        } else if (this.target === './blogs/auth.html') {
            this.loadQueue.push({name:headerPath, type:"file"});
            this.loadQueue.push({name:this.target, type:"file"});
            this.loadQueue.push({name:footerPath, type:"file"});
        } else {
            this.loadQueue.push({name:this.target, type:"file"});
        }
        this.loadQueue.reverse();
        this.processLoadQueue(this.loadQueue.pop());
    }

    processLoadQueue(currentObject) {
        if (currentObject.type === "file") {
            this.loadFile(currentObject.name);
        } else if (currentObject.type === "article") {
            this.loadArticleLinks(currentObject.name);
        }
    }

    loadFile(fileName) {
        fs.readFile(fileName, (err, data) => {
            if (err) {
                this.sendError(404);
                return;    
            }
            let tempStr = data.toString();
            if (tempStr.includes('[*login_logout*]')) {
                let newAnchor = "<a href='/";
                if (this.userRole === 'visitor')
                    newAnchor += "auth'>Auth";
                else
                    newAnchor += "quit'>Quit";
                newAnchor += "</a>";
                tempStr = tempStr.replace('[*login_logout*]', newAnchor);
                data = Buffer.from(tempStr);
            }
            this.responseBody.push(data);
            if (this.loadQueue.length > 0) {
                this.processLoadQueue(this.loadQueue.pop());
            } else {
                this.emit('payloadLoaded');
            }
        });
    }

    loadArticleLinks(article) {
        fs.readFile(article, 'utf8', (err, data) => {
            if (err) {
                this.sendError(404);
                return;
            }
            let obj = JSON.parse(data);
            let title = obj.Title;
            if (this.userRole === "visitor" && obj.Public === "yes") {
                title = "<a href=\'" + article + "\'>" + title + "</a>";
            } else if (this.userRole === "reviewer") {
                title = "<a href=\'" + article + "\'>" + title + "</a>";
            }
            this.responseBody.push(Buffer.from(title)); 
            if (this.loadQueue.length > 0) {
                this.processLoadQueue(this.loadQueue.pop());
            } else {
                this.emit('payloadLoaded');
            }
        });
    }

    sendError(statusCode) {
        this.statusCode = statusCode;
        this.responseBody = [];
        let target = `./blogs/${statusCode}.html`;
        if (fs.exists(target)) {
            this.target = target;
            this.emit('targetAcquired');
        } else {
            this.emit('payloadLoaded');
        }
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