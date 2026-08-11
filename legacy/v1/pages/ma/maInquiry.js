console.log('hi develper');
var baseData = {};

(function createQrDiv(){
    let qrCodeZone=document.createElement('div');
    qrCodeZone.setAttribute('id','qrzone');
    qrCodeZone.setAttribute('style','position:fixed; right: 66px; bottom:66px; z-index:9999;');
    qrCodeZone.addEventListener('click', function(){
        if (this.style.display === "none"){
            this.style.display = "block";
        } else {
            this.style.display = "none";
        }
    });
    document.body.appendChild(qrCodeZone);
})();

function handler(msg) {	//消息处理
    if (!msg) return console.log("where are you from ?");
    console.log(msg, msg.info.for);
	if (msg.info.for=='读取配置清单') configReady(msg);
	else if (msg.info.for=='国际站获取额外信息') customerInfoReady(msg)
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
    if (!baseData.maData.status) return console.log(false, '账号未登录');
    let memberId = getMemberId();
    getCustomerInfo(memberId)
    return;
};

function getMemberId() {
    let htmlCodes = document.children[0].innerHTML.split("\n");
    let memberId;
    for (let i = 0; i < htmlCodes.length; i++){
        let matches = /window.contactLoginId='(.*)';$/.exec(htmlCodes[i]);
        if (!!matches) {
            memberId = matches[1];
            break;
        };
    };
    console.log(memberId);
    return memberId;
};

function getCustomerInfo(memberId){
    let queryObj = prepareMsg('后台任务');
	let { TBToken } = baseData.maData;
    queryObj.request.args = [memberId,TBToken];
	queryObj.request.ns=['ma','aliCRMQuery'];
	queryObj.response.cb=['ma','aliCRMCheck'];
	bgConnect(queryObj);
};

function customerInfoReady(msg) {
	let { status, result } = msg.response;
	if (!status) return console.log(result);
	baseData.clientData = result;
	myQR.prepareQR();
	return;
}

var myQR=(()=>{
	let MyQRCode, QRData;
	function prepareQR(){
		let {contacts,companyName,country,email,mobileNumber, phoneNumber}= baseData.clientData;
		let today=new Date().Format('yyyy-MM-dd hh:mm');
		QRData="BEGIN:VCARD"
			+"\nVERSION:2.1"
			+"\nNICKNAME:"+today
			+"\nN:;"+contacts;
			if (phoneNumber)QRData+=("\nTEL;CELL:"+"+"+phoneNumber);
			if (mobileNumber)QRData+=("\nTEL;HOME;VOICE:"+"+"+mobileNumber);
			QRData+=("\nEMAIL;WORK;INTERNET:"+email
			+"\nADR:;;;;;;"+country
			+"\nORG:"+companyName
			+"\nEND:VCARD");
			(baseData.configData.needQRcode)? makeCode(QRData): false;
	};

	function makeCode(QRData){
		if (MyQRCode) return;
		try{
				MyQRCode = new QRCode(document.getElementById("qrzone"),{
				text: QRData,
				width: 200,
				height: 200,
				colorDark : "#000000",
				colorLight : "#ffffff",
				correctLevel : QRCode.CorrectLevel.L
			})
		}catch(e){console.log(e)};
	};
	return {
		prepareQR,
		makeCode,
	};
})();