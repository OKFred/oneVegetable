console.log('papa');

var BG = chrome.extension.getBackgroundPage();	/* talk with bg */
var Check1=document.getElementById("option1");
var Check5 = document.getElementById("option5");
var label5=document.getElementById("label5");
var inputUserEmail=document.getElementById("inputUserEmail");
var divBeforeLogin=document.getElementById("divBeforeLogin");
var divAfterLogin=document.getElementById("divAfterLogin");
var divBeforeAuth=document.getElementById("divBeforeAuth");
var divAfterAuth=document.getElementById("divAfterAuth");
var erpLoginURL=document.getElementById("erpLoginURL");

(async function preCheck() {
	let userConfig = await BG.read(null, "sync");
	let { userEmail, appData, needQRcode } = userConfig;
	let domArr=[Check1];
	let setArr=[needQRcode];
	domArr.forEach((dom, index)=>setArr[index] ? dom.setAttribute('checked',''): dom.removeAttribute('checked'));
	if (userEmail) inputUserEmail.value = userEmail;
	let loginStatus = await BG.taskMa.checkLogin();
	if (loginStatus) {
		divBeforeLogin.setAttribute("hidden", "");
		divAfterLogin.removeAttribute("hidden");
	} else {
		divAfterLogin.setAttribute("hidden", "");
		divBeforeLogin.removeAttribute("hidden");
	};
	if (appData) {
		console.log("已完成授权");
		divBeforeAuth.setAttribute("hidden", "");
		divAfterAuth.removeAttribute("hidden");
		erpLoginURL.setAttribute("href", "https://it.fred.wiki");
		//erpLoginURL.setAttribute("href", chrome.extension.getURL("/public/index.html"));
	} else {
		divAfterAuth.setAttribute("hidden", "");
		divBeforeAuth.removeAttribute("hidden");
	}
	return;
})();

Check1.addEventListener('click', async()=>{
	return await BG.write({ "needQRcode": Check1.checked},"sync");
});	/* 监听 二维码 开关 */

Check5.addEventListener('click', ()=>{
	if (Check5.checked){
		BG.users.default.maData.language='zh_CN';
		label5.innerText='中文界面';
	}else{
		BG.users.default.maData.language='en_US';
		label5.innerText='English page';
	};
	BG.taskMa.changeLanguage();
});

inputUserEmail.addEventListener('change', async(e) => {
	let value = e.target.value.trim();
	return BG.write({
		"userEmail": value,
		"status": value?true:false,
	}, "sync");
});