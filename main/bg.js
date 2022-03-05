"use strict";
console.log('日志已启用');
chrome.runtime.onConnect.addListener(handleConnection);
chrome.webRequest.onBeforeSendHeaders.addListener(...handleRequestHeaders());
var users = {
	default: {
		maData:{
			language: "en_US"
		},
	}
};

var rpcDataStr=JSON.stringify(rpc);
function prepareMsg(What){
    let rpcData=JSON.parse(rpcDataStr);
	return rpcData.find((obj)=>obj.info.for === What);
};  //查找RPC