console.log('日志已启用');

var bgData={
	language:"en_US"
}
function prepareMsg(What){
	loadRPC();
	return rpcData.find((obj)=>obj.info.for === What);
};

function checkLogin(){
	chrome.cookies.getAll({'url':'https://i.alibaba.com'}, cookieArr => {
		try{
			ma.data.TBToken=cookieArr.find(obj=>obj.name=='_tb_token_').value;	/* 公共参数 MA 登录token */
			ma.data.CToken=cookieArr.find(obj=>obj.name=='xman_us_t').value.split('&')[0].replace('ctoken=','');
		}catch(e){
			return console.log('未登录');
		};
		console.log('已登录');
		changeLanguage();
	});
};
async function changeLanguage(){
	let queryObj=ma.languageQuery(bgData.language, ma.data.CToken);
	queryObj=await doFetch(queryObj);
	let res=ma.languageCheck(queryObj);
	let {status}=res.response;
	if (status===0) return console.log("重定向。未登录");
	console.log('当前语言是： '+bgData.language);
	return queryObj;
};