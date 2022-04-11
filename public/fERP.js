"use strict";

console.log('To make it easy to do business everywhere!');
window.baseData = {};	//全局数据

function handler(msg){	//数据分发
    if (!msg ||!msg.response) return console.log("where are you from ?");
    console.log(msg, msg.info.for);
    globalQuery.distribute(msg);
};

var globalQuery=(()=>{	//⭐全局数据配置⭐
	function distribute(msg){
		if (msg.info.for=='读取配置清单'){
			configReady(msg);
		}
	};
	function queryConfig(goHome){
		let queryObj={
			request:{data:{}},
			response:{data:{}},
			info:{
				for:"读取配置清单",
				type:"configuration",
			},
		};
		if (goHome) queryObj.info.tab="Home";
		bgConnect(queryObj);
	};
	setTimeout(queryConfig,0);
	
	function configReady(msg){	//⭐全局配置数据⭐
		console.log('配置清单已就位');
		let data=msg.response.data;
        let { configData } = data;
        if (!configData) return console.log('config data missing');
		Object.assign(baseData, configData);
		if (/localhost/gi.test(location.origin)) {
			let s = document.createElement('script');
			s.innerHTML = `var baseData=${JSON.stringify(baseData)}`;
			s.setAttribute('id', 'baseData');
			document.body.appendChild(s);
		}; //for debug purposes
        return console.log('yas');
	};

	return {
		distribute,
		queryConfig,
	};
})();




