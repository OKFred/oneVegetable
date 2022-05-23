
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
	let res;
	if (msg.request.url){ try { res = await doFetch(msg) } catch (e) { res=msg}}
	else res=msg;
	if (callback) res=await callback(res);
	if (support&&!msg.response.status) await support();
	return res;
};

async function handleStorage(obj){
	let type, value, query;
	let entryArr=Object.entries(obj)[0];
	let key=entryArr[0];
	let {oldValue, newValue}=entryArr[1];
	if (newValue){
		type='write';
		value=newValue;
		query={[key]:value};
	}else if (oldValue){
		type='remove';
		value=oldValue;
		query=key;
	};
	return console.log(type, query);
};

async function handleSyncStorage(obj){
	let type, value;
	let entryArr=Object.entries(obj)[0];
	let key=entryArr[0];
	let {oldValue, newValue}=entryArr[1];
	if (newValue){
		type='write';
		value=newValue;
	}else if (oldValue){
		type='remove';
		value=oldValue;
	};
	if (key === 'loginData') {
		let users = {};
		let userConfig = await read(null);
		if (userConfig && userConfig.users) users=userConfig.users;
		let { user_nick } = value;
		delete users[user_nick];
		if (type === 'write') {
			users[user_nick] = value;
		}
		return await write({ users });
	}
	return;
};

async function syncData(paramArr, type, loginId){
	let fn=type==='read'? read:type==='write'?write:type==='remove'?remove:'';
	if(!fn) return console.log('未读写支持类型');
	return await fn(...paramArr);
};

async function sendConfig(msg, sender) {
	await taskMa.checkLogin();
	let data=Object.assign({}, {configData: await read(null, "sync")}, {pageData:sender}, users.default);
	if (!msg) return data;
	msg.response.data=data;
	return msg;
};

function handleRequestHeaders(){	//CORS in dev mode
	return [
		(details) => {
			if (!/localhost/gi.test(details.initiator)) return;
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

function handleResponseHeaders(){   //handle CORS requests when in dev & on the extension page
    return [
		(details) => {
            if (!/localhost|chrome-extension/gi.test(details.initiator)) return;
            let {responseHeaders}=details;
			responseHeaders=responseHeaders.filter((headerObj)=>(!/access-control-allow-origin/gi.test(headerObj.name)));
			responseHeaders.push({name:"Access-Control-Allow-Origin",value:"*"});
			return {responseHeaders};
		},
		{urls: ["<all_urls>"]},
		["blocking", "responseHeaders", "extraHeaders"]
    ]
}

function handleUninstall(){	//退订链接
	return [
		'https://chrome.google.com/webstore/detail/aepfdoldflokikbbcpnfifkacpfakmjc',
		()=>{console.log('In case you want to try out the latest version')}
	]
};