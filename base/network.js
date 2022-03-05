
var main=(()=>{
    (typeof(window)==='undefined')? logger=(...args)=>logTool.emitter.emit('log', 'net', ...args):'';
    if (typeof(fetch)==='undefined') fetch=require('node-fetch');
    if (typeof(FormData)==='undefined') FormData = require('form-data');
    if (typeof(URL)==='undefined') URL = require('url').URL;
    if (typeof(URLSearchParams)==='undefined') URLSearchParams = require('url').URLSearchParams;
    
    async function doFetch(queryObj, url){
        if (!url) url=queryObj.request.url;
        if (url===undefined){
            queryObj.response.data='url undefined';
            return queryObj;
        };
        if(queryObj.request.header.method==='GET' && ! /\?/.test(url)){
            url=url+'?'+objToParam(queryObj.request.data, url);
        };
        queryObj.request.url=url;
        queryObj=await headerMaker(queryObj); //request header
        let header=queryObj.request.header;
        let fetching;
        try { fetching = await fetch(url, header) } catch (e) { console.log("network error" + url); debugger};    //pending resolve
        if (typeof(logger)!=='undefined') logger(url);
        let res=headerReceiver(queryObj, fetching);    //response header
        let data;
        try{
            data = await fetching.text();
            data = JSON.parse(data);
        }catch(e){};
        //console.log(data);
        res.response.data=data;
        res=redirectionCheck(res);
        return res;
    };
    async function redirectionCheck(res){    //需求：拿到重定向URL 或 置空
        let redirectSetting=res.request.header.redirect;
        let redirectURL;
        let {net}=res.response;
        if (!redirectSetting) redirectSetting='follow';
        if (redirectSetting==='follow'){
            if (net.redirected) redirectURL=net.url;
        }else if(redirectSetting==='manual'){
            if (typeof(window)!=="undefined"){   //前端自动(follow)跳转才能得到重定向URL
                if ((!net.status &&!res.response.data) || net.type==="opaqueredirect") redirectURL=true;
            }else{  //后端通常需要配合cookies等跳转，所以跳转一次需重新设置(manual)
                if (net.status>299&&net.status<400){
                    if (res.response.headers.location) redirectURL=res.response.headers.location;
                };
            };
        };
        res.response.redirectURL=redirectURL;
        return res;
    };

    async function headerMaker(queryObj){
        let header=queryObj.request.header;
        if (!header.headers) header.headers={};
        if (!header.credentials || header.credentials!=='omit'){
            let allCookieObj=queryObj.response.allCookieObj;
            if (allCookieObj) queryObj=cookieGetter(queryObj);  //node-fetch
            let origin=new URL(queryObj.request.url).origin;
            header.headers["Referer"]=origin;
            header.headers["origin"]=origin;
        };  //生成所需的 cookieObj
        if (queryObj.request.cookieObj){  //转化为 cookie 字符串
            let cookie='';
            for (let [cookieName, detailObj] of Object.entries(queryObj.request.cookieObj)){
                cookie+=(cookieName+'='+detailObj.value+'; ');
            };
            cookie=cookie.replace(/; $/,'');
            header.headers.cookie=cookie;
        };
        if (queryObj.request.header.method==='GET') return queryObj;
        if((queryObj.request.header['Content-Type']).toLowerCase()=='json'){
            header.headers['Content-Type']='application/json';
            header.body=JSON.stringify(queryObj.request.data);
        }else if((queryObj.request.header['Content-Type']).toLowerCase()=='x-www-form-urlencoded'){
            header.headers['Content-Type']='application/x-www-form-urlencoded';
            let arr=[];
            for (let [k,v] of Object.entries(queryObj.request.data)){
                if (typeof(v)=='object'){
                    arr.push(encodeURIComponent(k)+'='+encodeURIComponent(JSON.stringify(v)));
                }else{
                    arr.push(encodeURIComponent(k)+'='+encodeURIComponent(v));
                };
            };
            header.body=arr.join('&');
        } else if ((queryObj.request.header['Content-Type']).toLowerCase() == 'form data') {
            let bodyData;
            if (queryObj.request.data instanceof FormData) {
                bodyData = queryObj.request.data;
            } else {
                bodyData = new FormData();
                for (let [k, v] of Object.entries(queryObj.request.data)){
                    if (typeof(v)=='object'){
                        bodyData.append(`${k}`,`${JSON.stringify(v)}`);
                    }else if (v=='$$blob'){ //extension 前后端传递，blob→formData:
                        let file=queryObj.request.file;
                        let data =await fetch (file.url);
                        let blobData=await data.blob();
                        queryObj.request.file.size=blobData.size;
                        bodyData.append(k, blobData, file.name);
                    }else{
                        bodyData.append(`${k}`,`${v}`);
                    };
                };
            };
            header.body=bodyData;
        };
        return queryObj;
    };

    function headerReceiver(res, fetching){
        let headerObj={};
        let {redirected,status,statusText,ok}=fetching;
        let origin = new URL(fetching.url).origin;
        res.response.net={
            redirected,status,statusText,ok,origin,
            url:fetching.url,
        };
        if (fetching.headers.raw){	//兼容node-fetch
            headerObj=fetching.headers.raw();
            for (let [k,v] of Object.entries(headerObj)){
                headerObj[k]=v.join('\n');
            };
        }else{
            for (let [k,v] of fetching.headers.entries()){
                headerObj[k]=v;
            };
        };
        res.response.headers=headerObj;
        if (headerObj['set-cookie']) res=cookieSetter(res); //node-fetch
        return res;
    };

    function objToParam(obj){
        let arr=[];
        for (let [k,v] of Object.entries(obj)){
            if (typeof(v)=='object'){
                arr.push(encodeURIComponent(k)+'='+encodeURIComponent(JSON.stringify(v)));
            }else{
                if (v!==undefined) arr.push(encodeURIComponent(k)+'='+encodeURIComponent(v));
            };
        };
        return arr.join('&');
    };

    function paramToObj(url){
        let params=new URL(url).searchParams;
        let obj={};
        for (let [k,v] of params.entries()){
            obj[k]=v;
        };
        return obj;
    };

    //for node-fetch especially

    function cookieGetter(queryObj){  //读取所需的cookies，准备新的请求
        let allCookieObj=queryObj.response.allCookieObj;
        let cookieObj=(queryObj.request.cookieObj)?queryObj.request.cookieObj:{};
        let found=false;
        let reqDomain=new URL(queryObj.request.url).host;
        let reqPath=new URL(queryObj.request.url).pathname;
        let {domainMain,domainSub}=domainChecker(reqDomain);
        if (allCookieObj[domainMain]===undefined) return queryObj;
        if (allCookieObj[domainMain][domainSub]===undefined)  return queryObj;
        for (let [path, target] of Object.entries(allCookieObj[domainMain][domainSub])){
            if (!!reqPath.match(path)){
                found=true;
                Object.assign(cookieObj, target);
            };
        };
        if (!found) return queryObj;
        if (domainSub!=='www'){
            if (allCookieObj[domainMain]['www'] && allCookieObj[domainMain]['www']['/']){
                Object.assign(cookieObj, allCookieObj[domainMain]['www']['/']);
            };
        };
        queryObj.request.cookieObj=cookieObj;
        return queryObj;
    };

    function domainChecker(domain){ //判断域名归属
        let domainInfo=domain.split('.');
        let domainMain=domainInfo[domainInfo.length-2]+'.'+domainInfo[domainInfo.length-1];
        domainInfo.pop();
        domainInfo.pop();
        let domainSub=domainInfo.join('.') || 'www';
        return {domainMain,domainSub};
    };

    function cookieSetter(res){   //请求完毕后，暂存得到的cookies
        let allCookieObj=res.response.allCookieObj || {};   //读取现有 cookie or 重置
        let resCookie = res.response.headers['set-cookie'].split('\n');
        if (!Array.isArray(resCookie)) return res;
        let resDomain=new URL(res.response.net.url).host;
        let cookieObj={};
        resCookie.forEach((cookieString) => {
            let cookieInfo = cookieString.split(';');
            //extract cookie name, value, and extra data
            let cookieBody = cookieInfo[0].split('=');
            let cookieName=cookieBody[0];
            let value=cookieBody[1];
            cookieObj[cookieName]={};
            cookieObj[cookieName].value=value;
            for (let i=1; i<cookieInfo.length; i++){
                let cookieBody = cookieInfo[i].split('=');
                let k=cookieBody[0].trim();
                let v=cookieBody[1];
                cookieObj[cookieName][k]=v;
            };
            //extract domain & sub-domain & path
            let domain=cookieInfo.find((str)=>!!str.match(/Domain=/gi));
            domain= (domain)? domain.replace(/Domain=(\.)?/gi,'').trim(): resDomain;
            let {domainMain,domainSub}=domainChecker(domain);
            let path=cookieInfo.find((str)=>!!str.match(/Path=/gi));
            path=(path) ? path.replace(/.*Path=(.*)/gi, (match,p1)=>{
                if (p1==='/') return p1;
                return p1.replace(/\/$/,'');    //去掉末尾的/
            }) : '/';
            if (allCookieObj[domainMain]===undefined) allCookieObj[domainMain]={};
            if (allCookieObj[domainMain][domainSub]===undefined) allCookieObj[domainMain][domainSub]={};
            if (allCookieObj[domainMain][domainSub][path]===undefined) allCookieObj[domainMain][domainSub][path]={};
            Object.assign(allCookieObj[domainMain][domainSub][path], cookieObj);
        });
        res.response.cookieObj=cookieObj;
        res.response.allCookieObj=allCookieObj;
        return res;
    };

    return {
        doFetch,
        objToParam,
        paramToObj,
    };
})();

//for browser
if (typeof(window)!=='undefined'){
    window.doFetch=main.doFetch;
    window.objToParam=main.objToParam;
    window.paramToObj=main.paramToObj;
};

// for commonJS
if (typeof(exports)!=='undefined') exports.main = main;