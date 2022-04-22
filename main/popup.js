console.log('papa');

var BG = chrome.extension.getBackgroundPage();	/* talk with bg */
var Welcome=document.getElementById("Welcome");
var spanNeedLogin=document.getElementById("spanNeedLogin");
var Check1=document.getElementById("option1");
var Check5 = document.getElementById("option5");
var Check6 = document.getElementById("option6");
var label1=document.getElementById("label1");
var label5=document.getElementById("label5");
var label6=document.getElementById("label6");
var inputUserEmail=document.getElementById("inputUserEmail");
var divBeforeLogin=document.getElementById("divBeforeLogin");
var divAfterLogin=document.getElementById("divAfterLogin");
var divBeforeAuth=document.getElementById("divBeforeAuth");
var divAfterAuth=document.getElementById("divAfterAuth");
var btnERPAuth=document.getElementById("btnERPAuth");
var btnERPLogin = document.getElementById("btnERPLogin");
var btnClearAuth = document.getElementById("btnClearAuth");
var selectCurrentAccount = document.getElementById("selectCurrentAccount");
var ERPAuthURL = 'https://activity.alibaba.com/pc/developer.html';
var ERPLoginURL = chrome.extension.getURL("/public/index.html");

(async function preCheck() {
	Welcome.innerText=chrome.i18n.getMessage("Welcome");
	spanNeedLogin.innerText=chrome.i18n.getMessage("MALoginFirst");
	let userConfig = await BG.read(null, "sync");
	let { userEmail, loginData, userLocale, needQRcode, needCloudService } = userConfig;
	let domArr=[Check1, Check5, Check6];
	let setArr=[needQRcode, userLocale==='zh_CN', needCloudService];
	domArr.forEach((dom, index)=>setArr[index] ? dom.setAttribute('checked',''): dom.removeAttribute('checked'));
	if (userEmail) inputUserEmail.value = userEmail;
	inputUserEmail.setAttribute('placeholder', chrome.i18n.getMessage("ERPDeveloperEmail"));
	label1.innerText = chrome.i18n.getMessage("MAQrCode");
	label5.innerText = chrome.i18n.getMessage("MALanguage");
	if (needCloudService) {
		label6.innerText = chrome.i18n.getMessage("ERPCloudService");
		inputUserEmail.removeAttribute('hidden');
	}else label6.innerText = chrome.i18n.getMessage("ERPLocalHost");
	let maStatus = await BG.taskMa.checkLogin();
	if (maStatus) {
		divBeforeLogin.setAttribute("hidden", "");
		divAfterLogin.removeAttribute("hidden");
		if (userLocale === 'zh_CN') BG.taskMa.changeLanguage(); //默认值是英语，如果设置了就切换
	} else {
		divAfterLogin.setAttribute("hidden", "");
		divBeforeLogin.removeAttribute("hidden");
	};
	if (loginData) {
		console.log("已完成授权");
		let userConfig = await BG.read(null);
		if (userConfig && userConfig.users) {
			for (let k of Object.keys(userConfig.users)) {
				let option = document.createElement('option');
				option.value = k;
				option.innerText = k;
				selectCurrentAccount.appendChild(option);
				if (k === loginData.user_nick) option.setAttribute('selected', '');
			}
		}
		divBeforeAuth.setAttribute("hidden", "");
		divAfterAuth.removeAttribute("hidden");
		btnERPLogin.innerText = '🚀' + chrome.i18n.getMessage("ERPLogin");
		btnClearAuth.innerText = '🗑' + chrome.i18n.getMessage("ERPAuthClear");
	} else {
		divAfterAuth.setAttribute("hidden", "");
		divBeforeAuth.removeAttribute("hidden");
		btnERPAuth.innerText = '🔑' + chrome.i18n.getMessage("ERPAuth");
	}
	return;
})();

Check1.addEventListener('click', async()=>{
	return await BG.write({ "needQRcode": Check1.checked},"sync");
});	// 询盘二维码

Check5.addEventListener('click', async()=>{
	if (Check5.checked){
		BG.users.default.maData.language='zh_CN';
		label5.innerText=chrome.i18n.getMessage("MALanguageCN");
	}else{
		BG.users.default.maData.language='en_US';
		label5.innerText=chrome.i18n.getMessage("MALanguageEN");
	};
	BG.taskMa.changeLanguage();
	return await BG.write({ "userLocale": Check5.checked ? 'zh_CN' : 'en_US' }, "sync");
}); //语言切换

Check6.addEventListener('click', async()=>{
	if (Check6.checked){
		label6.innerText = chrome.i18n.getMessage("ERPCloudService");
		inputUserEmail.removeAttribute('hidden');
	}else{
		label6.innerText=chrome.i18n.getMessage("ERPLocalHost");
		inputUserEmail.setAttribute('hidden','');
	};
	return await BG.write({ "needCloudService": Check6.checked},"sync");
}); //是否需要云服务

inputUserEmail.addEventListener('change', async(e) => {
	let value = e.target.value.trim();
	return BG.write({
		"userEmail": value,
		"status": value?true:false,
	}, "sync");
});

btnERPAuth.addEventListener('click', async () => {
	window.open(ERPAuthURL);
});	// 授权开始

btnERPLogin.addEventListener('click', async () => {
	window.open(ERPLoginURL);
});	// 登录系统

btnClearAuth.addEventListener('click',  async() => {
	await BG.remove('loginData', "sync"); //清除
	return setTimeout(changeUser, 1000);
});	// 授权清除

selectCurrentAccount.addEventListener('change',  (e) => {
	let user_nick = e.target.value;
	return changeUser(user_nick);
}) //更换账号

async function changeUser(user_nick) {
	let userConfig = await BG.read(null);
	if (userConfig && userConfig.users) {
		let loginData=userConfig.users[user_nick] || Object.values(userConfig.users)[0];
		await BG.write({ loginData }, "sync");
	}
	return location.reload();
}