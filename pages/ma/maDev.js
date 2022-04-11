"use strict";

console.log('hi develper');
var baseData = {
	loginData:{	//授权信息暂存
		app_key:'', appKey:'', 
		app_secret: '', appSecret: '',
		access_token: '', accessToken: '',
		code:'', method:'',
	},
	authData: {	//用于请求授权
		authHtml: '',
		authUrl: '',
		callbackUrl:'https://www.aliyun.com',
		userName:'ABBA',
		userTel: '8613456789011',
		userEmail:'',
		maxTrial:2,
	}
};

function handler(msg){	//消息处理
    if (!msg) return console.log("where are you from ?");
    console.log(msg, msg.info.for);
	if (msg.info.for=='读取配置清单') configReady(msg);
	else if (msg.info.for=='国际站查询账号ID') accountMIDReady(msg)
	else if (msg.info.for=='国际站查询账号邮箱') accountEmailReady(msg)
	else if (msg.info.for=='国际站开发者注册') registerReady(msg)
	else if (msg.info.for=='国际站获取AppKey') appKeyReady(msg)
	else if (msg.info.for=='国际站获取AppSecret') appSecretReady(msg)
	else if (msg.info.for=='国际站获取授权码') codeReady(msg)
	else if (msg.info.for=='国际站自动授权') authReady(msg)
	else if (msg.info.for=='国际站查询授权令牌') getTokenReady(msg)
	else if (msg.info.for=='国际站服务续期') serviceRenewReady(msg)
	else if (msg.info.for=='国际站调用API') apiReady(msg)
	else if (msg.info.for=='国际站保存令牌') saveTokenReady(msg)
	else if (msg.info.for=='浏览器保存授权信息') saveTokenReady(msg)
	else console.log('what did you send?');
};

function configCheck(){	//⭐全局配置数据⭐
	let queryObj={
		request:{data:{}},
		response:{data:{}},
		info:{for:"读取配置清单", type:"configuration"},
	};
	bgConnect(queryObj);
}; configCheck();

function configReady(msg) {
	let {data}=msg.response;
	console.log('配置清单已就位');
	Object.assign(baseData,data);
	if (!baseData.maData.status) return queryResult(false, 'Not Logged In--账号未登录');
	if (baseData.configData.status) baseData.authData.userEmail = baseData.configData.userEmail;
	accountMIDCheck();
	return console.log(data);
};

function accountMIDCheck() {
	let queryObj = prepareMsg('后台任务');
	let { CToken } = baseData.maData;
	queryObj.request.args=[CToken];
	queryObj.request.ns=['ma','accountMemberIdQuery'];
	queryObj.response.cb=['ma','accountMemberIdCheck'];
	bgConnect(queryObj);
};

function accountMIDReady(msg) {
	let { status, result } = msg.response;
	if (!status ||!baseData.configData.userEmail) return accountEmailCheck();
	if (result.loginId) baseData.authData.userName = result.loginId;
	Object.assign(baseData.authData, result);
	return getAppKey();
};

function accountEmailCheck() {
	let queryObj=prepareMsg('后台任务');
	queryObj.request.ns=['ma','accountEmailQuery'];
	queryObj.response.cb=['ma','accountEmailCheck'];
	bgConnect(queryObj);
};

function accountEmailReady(msg) {
	let { status, result } = msg.response;
	if (!status) return getAppKey();
	baseData.authData.userEmail = result;
	getAppKey();
};

function registration(){	//国际站开发者注册
	let queryObj=prepareMsg('后台任务');
	let { callbackUrl, userName, userTel, userEmail } = baseData.authData;
	let userInfo = { userEmail, userName, userTel };
	let { TBToken } = baseData.maData;
	queryObj.request.args=[userInfo, callbackUrl, TBToken];
	queryObj.request.ns=['ma','developerRegisterQuery'];
	queryObj.response.cb=['ma','developerRegisterCheck'];
	bgConnect(queryObj);
};

function registerReady(msg) {
	baseObj.authData.maxTrial--;
	let { status, result } = msg.response;
	if (!status) queryResult(status, result);
	getAppKey();
};

function getAppKey(){	//国际站获取AppKey
	let queryObj=prepareMsg('后台任务');
	let { TBToken } = baseData.maData;
	queryObj.request.args=[TBToken];
	queryObj.request.ns=['ma','developerAppKeyQuery'];
	queryObj.response.cb=['ma','developerAppKeyCheck'];
	bgConnect(queryObj);
};

function appKeyReady(msg) {
	let {status, result}=msg.response;
	if (!status && baseObj.authData.maxTrial>0) return registration();
	baseData.loginData['app_key']=baseData.loginData['appKey']=result;
	getAppSecret();
	return console.log(result);
};

function getAppSecret(){	//国际站获取AppSecret
	let queryObj=prepareMsg('后台任务');
	let {appKey}=baseData.loginData;
	let { TBToken } = baseData.maData;
	queryObj.request.args=[appKey, TBToken];
	queryObj.request.ns=['ma','developerAppSecretQuery'];
	queryObj.response.cb=['ma','developerAppSecretCheck'];
	bgConnect(queryObj);
};

function appSecretReady(msg) {
	let {status, result}=msg.response;
	if (status){
		baseData.loginData['app_secret']=baseData.loginData['appSecret']=result;
		getACode();
	};
	return console.log(result);
};

function getACode(){	//国际站获取授权码
	let queryObj=prepareMsg('后台任务');
	let {appKey}=baseData.loginData;
	queryObj.request.args=[appKey];
	queryObj.request.ns=['ma','developerCodeQuery'];
	queryObj.response.cb=['ma','developerCodeCheck'];
	bgConnect(queryObj);
};

function codeReady(msg) {
	let {status, result}=msg.response;
	if (status){
		baseData.loginData['code']=result.code;
		queryForToken();
		console.log("请求令牌");
	}else{
		baseData.authData['authUrl']=msg.request.url;
		baseData.authData['authHtml']=msg.response.data;
		autoAuth();
		console.log("需要重新授权");
	};
	return;
};

function autoAuth(){	//国际站自动授权
	let queryObj=prepareMsg('后台任务');
	let { appKey} = baseData.loginData;
	let { authHtml, authUrl } = baseData.authData;
	queryObj.request.args=[appKey,authHtml,authUrl];
	queryObj.request.ns=['ma','developerAutoAuthQuery'];
	queryObj.response.cb=['ma','developerAutoAuthCheck'];
	bgConnect(queryObj);
};

function authReady(msg) {
	let {status, result}=msg.response;
	if (status){
		baseData.loginData['code']=result.code;
		queryForToken();
	};
	return console.log(result);
};

async function queryForToken(){	//国际站查询授权信息
	let queryObj=prepareMsg('后台任务');
	let { appKey,appSecret,code } = baseData.loginData;
	queryObj.request.args=[appKey,appSecret,code ];
	queryObj.request.ns=['ma','developerTokenQuery'];
	queryObj.response.cb=['ma','developerTokenCheck'];
	bgConnect(queryObj);
};

function getTokenReady(msg) {
	let {status, result}=msg.response;
	if (status) {
		baseData.loginData['accessToken'] = result.access_token;
		Object.assign(baseData.loginData, result);
		bindToDom();
		renewService();
	};
	return console.log('查询授权：',result);
};

function renewService() {
	let queryObj=prepareMsg('后台任务');
	let { appKey } = baseData.loginData;
	let { CToken, TBToken } = baseData.maData;
	queryObj.request.args=[appKey,TBToken,CToken ];
	queryObj.request.ns=['ma','developerRenewalQuery'];
	queryObj.response.cb=['ma','developerRenewalCheck'];
	bgConnect(queryObj);
};

function serviceRenewReady(msg) {
	let { result } = msg.response;
	console.log(result);
	saveToken();
};

function saveToken() {
	let { loginData, authData, configData } = baseData;
	let queryObj = prepareMsg('后台任务');
	let dataSaveObj = { ...loginData, ...authData };
	queryObj.request.args=[[{"loginData": dataSaveObj},"sync"],"write"];
	queryObj.request.ns=['syncData'];
	queryObj.info.for="浏览器保存授权信息";
	bgConnect(queryObj);
	if (!configData.needCloudService) return;
	queryObj = prepareMsg('后台任务');
	queryObj.request.args=[dataSaveObj];
	queryObj.request.ns=['aliyun','developerWriteTokenQuery'];
	queryObj.response.cb=['aliyun','developerWriteTokenCheck'];
	bgConnect(queryObj);
};

function saveTokenReady(msg) {
	let { status, result } = msg.response;
	if (!status) return console.log(result);
};

function bindToDom() {
	queryResult(true, 'API ready--授权成功');	//demo，可有可无
	try{	//绑定API查询到DOM
		let apiRows=document.querySelectorAll("table")[1].tBodies[0].children;
		for (let i=0;  i< 24; i++){
			let index=apiRows[i].childElementCount;
			let host=apiRows[i].children[index-2];
			let method=apiRows[i].children[index-1].innerText;
			host.addEventListener('dblclick', function () {
				baseData.loginData['method'] = method;
				queryAPI();
			})
		};
	}catch(e){console.log('refresh needed')};
};

async function queryAPI(){
	let queryObj=prepareMsg('后台任务');
	queryObj.request.args=[baseData.loginData/* , baseData.paramObj */];
	queryObj.request.ns=['ma','developerAPIQuery'];
	queryObj.response.cb=['ma','developerAPICheck'];
	bgConnect(queryObj);
};

function apiReady(msg) {
	let {status, result}=msg.response;
	return console.log(status, result);
};

(function queryResultPreparation() {
	let theFather = document.body;
	let theChild = document.createElement('div');
	theChild.setAttribute("id", "queryResponse");
	theChild.setAttribute("style", "position:fixed; right: 66px; top:66px; font-size:33px;");
	theFather.appendChild(theChild);
})();

function queryResult(status, info){
	let QueryInfo=document.getElementById("queryResponse");	/* 提示信息 */
	if (status){
		QueryInfo.innerHTML=`<b style='color:green'>${info}</b>`;
	}else{
		QueryInfo.innerHTML=`<b style='color:orangered'>${info}</b>`;
	};
};