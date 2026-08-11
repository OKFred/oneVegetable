"use strict";
console.log('日志已启用');
chrome.runtime.onConnect.addListener(handleConnection);
chrome.webRequest.onHeadersReceived.addListener(...handleResponseHeaders());
chrome.webRequest.onBeforeSendHeaders.addListener(...handleRequestHeaders());
chrome.storage.local.onChanged.addListener(handleStorage);
chrome.storage.sync.onChanged.addListener(handleSyncStorage);
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