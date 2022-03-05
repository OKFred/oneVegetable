"use strict";

var aliyun=(()=>{
	let _data={
		_tb_token_:'', 
		app_key:'',
		appKey:'', 
		app_secret:'',
		appSecret:'',
		code:'',
		access_token:'',
		authHtml:'',
		authUrl:'',
		method:'',	
		callbackUrl:'',
		developer:'',
		email:'',
		tel:'',
	};
	
	function developerWriteTokenQuery(dataObj){
		let What='国际站保存令牌';
		let queryObj=prepareMsg(What);
		queryObj.request.data = dataObj;
		return queryObj;
	};
	
	function developerWriteTokenCheck(msg){
		let {status,result}=msg.response.data;
		msg.response.status=status;
		msg.response.result=result;
		return msg;
	};

	return {
		developerWriteTokenQuery,
		developerWriteTokenCheck,
	};
})();

if (typeof(exports)!=='undefined') exports.main = aliyun;