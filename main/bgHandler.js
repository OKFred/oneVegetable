
function handleConnection(port){	//通信管理
	let sender=port.sender;
	if (port.name != 'cRM') return console.log('where r u from?', sender);
	port.onMessage.addListener(async(msg)=>{
		console.log(`收到 ${port.name} 需求：`, msg);
		let res=await handle(msg, sender);
		if (res===null) return;
		try{
			port.postMessage(res);
		}catch(e){
			console.log('连接已关闭：'+e);
		};
	});
};

async function handle(msg, sender){
	if (!msg.info.type) return console.log('where r u from?', msg);
	if (msg.info.type==="configuration") return sendConfig(msg,sender);
	else if (msg.info.type==="extension") return await taskMa.checkLogin();
	else return await netTask(msg);
};

async function netTask(msg){
	let callback, support;
	let args=msg.request.args||[];	//arguments
	let ns=msg.request.ns;	//namespaces
	let cb=msg.response.cb;	//callbacks
	let sp=msg.response.sp;	//supports
	if (msg.info.type==='background'){
		let info=msg.info;
		let scope=(typeof(window)!=="undefined")? window: global;
		let findFunc=(arr)=>{let func=scope; for (let i=0; i<arr.length; i++) func=func[arr[i]]; return func};
		let writeList=(arr)=>(arr.length>0) && /^(wiki|ma|orion|caesar|aliyun|task|syncData|takeNote)/.test(arr[0]);
		let myFunc=(ns && writeList(ns))? findFunc(ns): null; //后台函数
		let data=(myFunc)? await myFunc(...args):null;
		(data && data.response)? msg=data : msg.response.data=data;	//兼容模式
		msg.info=Object.assign({}, info, msg.info);
		callback=(cb && writeList(cb))? findFunc(cb): null;	//回调函数
		support=(sp && writeList(sp))? findFunc(sp): null;	//支援函数
	};
	//msg=customAPI(msg);
	let res;
	if (msg.request.url){ try { res = await doFetch(msg) } catch (e) { res=msg}}
	else res=msg;
	if (callback) res=await callback(res);
	if (support&&!msg.response.status) await support();
	return res;
};
function customAPI(msg){
	let {caesarData, orionData, aliyunData}=users.default;
	if (msg.info.type==='wiki'){
		let newURL=new URL(aliyunData.server);
		let oldURL=new URL(msg.request.url);
		oldURL.hostname=newURL.hostname;
		oldURL.port=newURL.port;
		oldURL.protocol=newURL.protocol;
		msg.request.url=oldURL.toString();
		return msg;	//2021-10-19 停服，且高可用需要
	}else if (msg.info.type==='caesar'){
		let Apis=caesarData.Apis;
		let ApiData=Apis.find((obj)=>obj.name==msg.info.for);
		msg.request.url=(ApiData)?ApiData.url:'';
		return msg;	//凯撒动态API，根据Session决定
	}else if (msg.info.type==='orion'){
		if (!msg.request.header || msg.request.header.method==='GET') return msg;
		let CToken=orionData.CToken;
		msg.request.header.headers["x-csrf-token"]=CToken;
		return msg;	//猎户座CSRF Token
	};
	return msg;
};

async function syncData(paramArr, type, loginId){
	let fn=type==='read'? read:type==='write'?write:type==='remove'?remove:'';
	if(!fn) return console.log('未读写支持类型');
	return await fn(...paramArr);
};

async function sendConfig(msg, sender){
	let data=Object.assign({}, {configData: await read(null, "sync")}, {pageData:sender}, users.default);
	if (!msg) return data;
	msg.response.data=data;
	return msg;
};

function handleRequestHeaders(){	//CORS 伪装
	return [
		(details) => {
			if (!/localhost|127.0.0.1|fred.wiki|cloud-ide-router.alibaba-inc.com/gi.test(details.initiator)) return;
			//if (!/^chrome-extension/.test(details.initiator)) return;
			let {requestHeaders, url}=details;
			let origin=new URL(url).origin;
			requestHeaders = requestHeaders.filter((obj) => !/origin|referer|referrer/gi.test(obj.name));
			requestHeaders.push({"name":"Origin","value":origin},{"name":"Referer","value":origin});
			return {requestHeaders};
		},
		{urls: ["<all_urls>"]},
		["blocking", "requestHeaders", "extraHeaders"]
	]
};

function handleResponseHeaders(){   //handle CORS requests when dev
    return [
		(details) => {
            if (!/localhost|127.0.0.1|fred.wiki|cloud-ide-router.alibaba-inc.com/gi.test(details.initiator)) return;
            let {responseHeaders}=details;
			responseHeaders=responseHeaders.filter((headerObj)=>(!/access-control-allow-origin/gi.test(headerObj.name)));
			responseHeaders.push({name:"Access-Control-Allow-Origin",value:"*"});
			return {responseHeaders};
		},
		{urls: ["<all_urls>"]},
		["blocking", "responseHeaders", "extraHeaders"]
    ]
}