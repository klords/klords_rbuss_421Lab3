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
        this.fragmentList = [];
        this.mediaSearchQueue = [];
        this.userRole = 'visitor';
        this.userName = 'Visitor';
        this.target = '';
        this.statusCode = 200;
        this.responseHeader = {};
        this.responseBody = [];
        this.errorMessage = '';
        this.loadQueue = [];
        this.routeMap = {};
        this.initListeners();
        this.initRouteMap();
    }

    initListeners() {
        this.on('articlesLoaded',   this.getFragments);
        this.on('fragmentsLoaded',	this.getMedia);
        this.on('mediaLoaded',      this.getRequestTarget);
        this.on('targetAcquired',   this.generatePayload);
        this.on('payloadLoaded',    this.generateHeader);
        this.on('responseReady',    this.sendResponse);
    }

    initRouteMap() {
        this.routeMap['./auth']             = './blogs/auth.html';
        this.routeMap['./createArticle']    = './blogs/createArticle.html';
        this.routeMap['./createFragment']   = './blogs/createFragment.html';
        this.routeMap['./delete']           = './blogs/delete.html';
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

    getFragments() {
    	fs.readdir('./blogs', (err, files) => {
            if (err) throw err;
            this.fragmentList = files.filter((name) => {
                return name.endsWith('.frag.html');
            });
            this.emit('fragmentsLoaded');
        });
    }

    getMedia() {
        this.findMediaRefs(this.mediaSearchQueue);
    }

    findMediaRefs(searchQueue) {
        if (searchQueue.length === 0) {
            this.emit('mediaLoaded');
            return;
        }
        let searchObj = searchQueue.pop();
        let articleObj = null;
        for (let article of this.articleList) {
            if (article.name === searchObj.article)
                articleObj = article;
        }
        fs.readFile(`./blogs/${searchObj.file}`, 'utf8', (err, data) => {
            if (err) {
                this.sendError(500);
                return;
            }
            let searchExp = new RegExp('src=["\']([\\w\\d\/\\\\_.]+)["\']', 'g');
            let matches;
            while ((matches = searchExp.exec(data)) !== null) {
                articleObj.Media.push(matches[1]);
            }
            this.findMediaRefs(searchQueue);
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
            articleObj.Media = [];
            if (articleObj.Fragments) {
                for (let fragment of articleObj.Fragments) {
                    this.mediaSearchQueue.push({article: currentArticle,
                                           file: fragment});
                }
            }
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

        this.parseRequestCookie();

        // do first async task
        this.getArticles();
    }

    parseRequestCookie() {
        this.userRole = 'visitor';
    	this.userName = 'Visitor';
    	if (!this.req.headers.cookie)
    		return;
		let cookieList = this.req.headers.cookie.split(';');
        let cookies = {};
        for (let cookie of cookieList) {
            let cookieVals = cookie.trim().split('=');
            cookies[cookieVals[0]] = cookieVals[1];
        }
        if (cookies.Role)
        	this.userRole = cookies.Role;
        if (cookies.UserName)
        	this.userName = cookies.UserName;
    }

    getContentType() {
        let target = this.target.toLowerCase();
        if (target.endsWith('.png'))
            return 'image/png';
        return 'text/html';
    }

    getRequestTarget() {
        // routing and authentication logic
        let validRoles = ['reviewer', 'author'];
        let targetObj = url.parse(this.req.url);
        let queryObj = null;

        if (targetObj.query) {
            queryObj = qstring.parse(targetObj.query);
        } else if (this.req.requestData) {
            queryObj = qstring.parse(this.req.requestData);
        }
        let newRole = '';
        if (queryObj && queryObj.role) {
             newRole = queryObj.role.toLowerCase();
        }
        let target = `.${targetObj.pathname}`;
        target = target.replace(/\.\./g, ''); // no directory traversal

        switch (target) {
            case './':
                target += 'landing';
                break;
            case './auth':
                if (queryObj) {  
                    if (queryObj.username === queryObj.password && validRoles.includes(newRole)) {
                        this.userRole = newRole;
                        this.userName = queryObj.username;
                        this.statusCode = 302;
                        this.responseHeader = {
                            'Location': '/'
                        };
                        this.emit('payloadLoaded');
                        return;
                    } else if (!validRoles.includes(newRole)) {
                        this.errorMessage = "Invalid Role selected.";
                    } else if (queryObj.username !== queryObj.password) {
                        this.errorMessage = "Invalid username/password.";
                    }
                }
                break;
            case './createFragment':
                if (queryObj) {
                    let writeOptions = {flag: 'wx'};
                    fs.writeFile(`./blogs/${queryObj.fragName}.frag.html`, queryObj.fragContent, writeOptions, (err) => {
                        if (err) {
                            this.target = './createFragment';
                            this.errorMessage = 'A fragment with that name already exists!';
                            this.emit('targetAcquired');
                            return;
                        }
                        this.statusCode = 302;
                        this.responseHeader = {
                            'Location': '/'
                        };
                        this.emit('payloadLoaded');
                        return;
                    });
                    return;
                }
                break;
            case './createArticle':
            	if (queryObj) {
            		let data = this.createArticle(queryObj);
            		let writeOptions = {flag: 'wx'};
                    fs.writeFile(`./${queryObj.title}.art`, data, writeOptions, (err) => {
                        if (err) {
                            this.target = './createArticle';
                            this.errorMessage = 'An article with that name already exists!';
                            this.emit('targetAcquired');
                            return;
                        }
                        this.statusCode = 302;
                        this.responseHeader = {
                            'Location': '/'
                        };
                        this.emit('payloadLoaded');
                        return;
                    });
                    return;
                }
            	break;
            case './delete':
                if (this.req.requestData) { // form submission
                    queryObj = qstring.parse(this.req.requestData);
                    this.deleteArticles(queryObj);                    
                    this.statusCode = 302;
                    this.responseHeader = {
                        'Location': '/'
                    };
                    this.emit('payloadLoaded');
                    return;
                }
                break;
            case './quit':
                this.userRole = 'visitor';
                this.userName = 'Visitor';
                this.statusCode = 302;
                this.responseHeader = {
                    'Location': '/'
                };
                this.emit('payloadLoaded');
                return;
        }            

        this.target = target;
        this.emit('targetAcquired');
    }

    createArticle(queryObj) {
    	let newArticleData = "{\"Title\":\"" + queryObj.title + "\",\"Author\":\"" + this.userName + "\",\"Public\":\"" + queryObj.pubpriv + "\",\"Fragments\":[";
    	if (queryObj.frag) {
            if (queryObj.frag.constructor == ''.constructor) {
                newArticleData += "\"" + queryObj.frag + "\"";
            } else {
                for (let x = 0; x < queryObj.frag.length; x++)  {
                    if (x == queryObj.frag.length - 1)
                        newArticleData += "\"" + queryObj.frag[x] + "\"";
                    else
                        newArticleData += "\"" + queryObj.frag[x] + "\",";
                }
            }
    		newArticleData += "]}";
    		return newArticleData;
    	}
    	newArticleData += "]}";
    	return newArticleData;
    }

    deleteArticles(queryObj) {
        let toDeleteList = [`./${queryObj.del_article}`];
        if (queryObj.del_unref) {
            toDeleteList = toDeleteList.concat(queryObj.del_unref);
        }
        this.deleteFile(toDeleteList);
    }

    deleteFile(deletionList) {
        if (deletionList.length === 0)
            return;
        fs.unlink(deletionList.pop(), (err) => {
            if (err)
                console.log(err);
            this.deleteFile(deletionList);
        });
    }

    canAccess(articleObj) {
        if (this.userRole === 'reviewer')
            return true;
        if (articleObj.Public === 'yes')
            return true;
        if (this.userRole === 'author' && articleObj.Author === this.userName)
            return true;
        return false;
    }

    canDelete(articleObj) {
        if (this.userRole === 'author' && 
            articleObj.Author === this.userName &&
            articleObj.Public === 'no')
            return true;
        return false;
    }

    generateHeader() {
        // set user cookies
        let expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + 7); // 1 week expiration
        this.responseHeader['Set-Cookie'] = [];
        this.responseHeader['Set-Cookie'].push(`Role=${this.userRole}; Expires=${expireDate.toUTCString()}; Path=/; HttpOnly;`);
        this.responseHeader['Set-Cookie'].push(`UserName=${this.userName}; Expires=${expireDate.toUTCString()}; Path=/; HttpOnly;`);

        // set content type
        this.responseHeader['Content-Type'] = this.getContentType();

        this.emit('responseReady');
    }

    generatePayload() {
        let headerPath  = './blogs/header.html';
        let introPath   = './blogs/intro.html';
        let footerPath  = './blogs/footer.html';

        if (this.target === './landing') {
            this.loadQueue.push({name:headerPath, type:"file"});
            this.loadQueue.push({name:introPath, type:"file"});
            for (let x of this.articleList) {
                this.loadQueue.push({name:x.name, type:"article"});
            }
            this.loadQueue.push({name:footerPath, type:"file"});
        } else if (this.target.endsWith('.art')) {
            let targetArticle = this.articleList.filter((article) => {
                return this.target.endsWith(article.name);
            })[0];
            if (this.canAccess(targetArticle)) {
                this.loadQueue.push({name:headerPath, type:"file"});
                for (let fragment of targetArticle.Fragments) {
                    this.loadQueue.push({name:`./blogs/${fragment}`, type:"file"});
                }
                this.loadQueue.push({name:footerPath, type:"file"});
            } else {
                this.sendError(403);
                return;
            }
        } else if (Object.keys(this.routeMap).includes(this.target)) {
            this.loadQueue.push({name:headerPath, type:"file"});
            this.loadQueue.push({name:this.routeMap[this.target], type:"file"});
            this.loadQueue.push({name:footerPath, type:"file"});
        } else
            this.loadQueue.push({name:this.target, type:"file"});
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
            data = this.processSSIs(data);
            this.responseBody.push(data);
            if (this.loadQueue.length > 0) {
                this.processLoadQueue(this.loadQueue.pop());
            } else {
                this.emit('payloadLoaded');
            }
        });
    }

    processSSIs(data) {
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
        if (tempStr.includes('[*create_article*]')) {
            let newAnchor = "";
            if (this.userRole === 'author')
                newAnchor = "<a href='/createArticle'>Create Article</a>";
            tempStr = tempStr.replace('[*create_article*]', newAnchor);
            data = Buffer.from(tempStr);
        }
        if (tempStr.includes('[*user_status*]')) {
            let newUserStatus = "";
            if (this.userRole === 'visitor')
                newUserStatus = "Welcome, Visitor!";
            else
                newUserStatus = `Hello, ${this.userName}! You are logged in as ${this.userRole}.`;
            tempStr = tempStr.replace('[*user_status*]', newUserStatus);
            data = Buffer.from(tempStr);	
        }
        if (tempStr.includes('[*create_fragment*]')) {
            let newAnchor = '';
            if (this.userRole === 'author' && 
                this.target === './landing')
                newAnchor = "<a href='/createFragment'>Create New Fragment</a>";
            tempStr = tempStr.replace('[*create_fragment*]', newAnchor);
            data = Buffer.from(tempStr);
        }
        if (tempStr.includes('[*error_message*]')) {
            let newError = this.errorMessage;
            if (newError !== '')
                newError = `<div class="error">${this.errorMessage}</div>`;
            tempStr = tempStr.replace('[*error_message*]', newError);
            data = Buffer.from(tempStr);
        }
        if (tempStr.includes('[*fragment_list*]')) {
            let newFragList = "";
            for (let x of this.fragmentList) {
                newFragList += "<div class=\"checkbox\"><input type=\"checkbox\" name=\"frag\" value=\"" + x + "\"> " + x.split(".")[0] + "</div>";
            }
            tempStr = tempStr.replace('[*fragment_list*]', newFragList);
            data = Buffer.from(tempStr);
        }
        let testReg = new RegExp('\\[\\*del_');
        if (testReg.test(tempStr)) {
            let deletionArticle = '';
            let urlObj = url.parse(this.req.url);
            if (urlObj.query) {
                let queryObj = qstring.parse(urlObj.query);
                if (queryObj.del_name && queryObj.del_name.endsWith('.art'))
                    deletionArticle = queryObj.del_name;
            }
            if (tempStr.includes('[*del_article*]')) {
                tempStr = tempStr.replace('[*del_article*]', deletionArticle);
            }
            if (tempStr.includes('[*del_article_name*]')) {
                tempStr = tempStr.replace('[*del_article_name*]', deletionArticle.replace('.art', ''));
            }
            if (tempStr.includes('[*del_associations*]')) {
                let unreferencedFiles = this.getUnreferencedFiles(deletionArticle);
                let fileSelectionList = '';
                if (unreferencedFiles.length > 0) {
                    fileSelectionList = '<div><p>The following files are not referenced by other applications and may be safely deleted if desired:</p>';
                    for (let file of unreferencedFiles) {
                        fileSelectionList += "<div class=\"checkbox\"><input type=\"checkbox\" name=\"del_unref\" value=\"" + file + "\"> " + file + "</div>"; 
                    }
                    fileSelectionList += '</div>';
                }
                tempStr = tempStr.replace('[*del_associations*]', fileSelectionList);
            }
            data = Buffer.from(tempStr);
        }
        return data;
    }

    getUnreferencedFiles(targetArticle) {
        let unrefFiles = [];
        let found = false;
        let articleObj = null;
        for (let article of this.articleList)
            if (article.name === targetArticle) {
                articleObj = article;
                break;
            }
        if (!articleObj) // article doesn't exist
            return unrefFiles;
        if (articleObj.Fragments) {
            for (let fragment of articleObj.Fragments) {
                found = false;
                for (let article of this.articleList) {
                    if (article.name !== articleObj.name &&
                        article.Fragments &&
                        article.Fragments.includes(fragment))
                        found = true;
                }
                if (!found)
                    unrefFiles.push(`./blogs/${fragment}`);
            }
        }
        if (articleObj.Media) {
            for (let media of articleObj.Media) {
                found = false;
                for (let article of this.articleList) {
                    if (article.name !== articleObj.name &&
                        article.Media &&
                        article.Media.includes(media))
                        found = true;
                }
                if (!found)
                    unrefFiles.push(`./${media}`);
            }
        }
        return unrefFiles;
    }

    loadArticleLinks(article) {
        fs.readFile(article, 'utf8', (err, data) => {
            if (err) {
                this.sendError(404);
                return;
            }
            let obj = JSON.parse(data);
            let title = obj.Title;
            if (this.canAccess(obj))
                title = "<div><a href=\'" + article + "\'>" + title + "</a>";
            else
            	title = "<div>" + title + "</div>";
            if (this.canDelete(obj))
                title += "&nbsp;&nbsp;<a href=\'delete?del_name=" + article + "\'>Delete</a></div>";
            else
            	title += "</div>";
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