"use strict";

/* 重载RPC & 查找对象 */
var rpcDataStr=(typeof(rpc)!=='undefined'&&rpc)? JSON.stringify(rpc):'';
function prepareMsg(What){  //有RPC就查RPC，没有就交由后台处理
	if(rpcDataStr && What!=='后台任务'){
		let rpcData=JSON.parse(rpcDataStr);
		return rpcData.find((obj)=>obj.info.for === What);
	}else if(typeof(agent)!=='undefined' && What==='外包'){
		return {
			"request": {"header":{"method":"GET"},"data":{}},
			"response": {"data": {}},
			"info": {"type": "agent","for": "外包"}
		}
	};
	return {
		"request": {"data":""},
		"response": {"data": {}},
		"info": {"type": "background","for": "后台任务"}
	};
};

/* 定义通信端口 */
var Port = chrome.runtime.connect({name: 'cRM'});
Port.onMessage.addListener((msg)=>handler(msg));/* 接收 */
function bgConnect(obj){	/* 发送 */
	try{ Port.postMessage(obj) }catch(e){ fatalError(e) };
};

function fatalError(e){
	Port='';
	let info=' >>数据出错，刷新或重开浏览器试试？';
	if (typeof(boots)!=='undefined') boots.showModal(info,'严重问题','static');
	console.trace(e);
};