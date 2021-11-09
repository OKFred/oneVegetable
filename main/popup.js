console.log('papa');

var BG = chrome.extension.getBackgroundPage();	/* talk with bg */
var Check5=document.getElementById("option5");
var label5=document.getElementById("label5");

Check5.addEventListener('click', ()=>{
	if (Check5.checked){
		BG.bgData.language='zh_CN';
		label5.innerText='中文界面';
	}else{
		BG.bgData.language='en_US';
		label5.innerText='English page';
	};
	BG.checkLogin();
});