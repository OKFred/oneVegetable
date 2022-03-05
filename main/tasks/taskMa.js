"use strict";
//handle events for MyAlibaba

var taskMa = (() => {
	async function checkLogin() {
		let url = "https://i.alibaba.com";
		let netCheck = await fetch(url, { "redirect": "manual" });
		if (!netCheck.ok) {
			console.log("未登录");
			return false;
		};
		let TBToken, CToken, status;
		let cookieArr = await cookie("check", { url });
		try {
			TBToken = cookieArr.find(obj => obj.name == '_tb_token_').value;	/* 公共参数 MA 登录token */
			CToken = cookieArr.find(obj => obj.name == 'xman_us_t').value.split('&')[0].replace('ctoken=', '');
		} catch (e) {
			console.log('未登录');
		};
		if (!TBToken || !CToken) status = false;
		else {
			status = true;
			users.default.maData.TBToken = TBToken;
			users.default.maData.CToken = CToken;
		};
		users.default.maData.status = status;
		return status;
	}; checkLogin();

	async function changeLanguage() {
		let loginCheck = await checkLogin();
		if (!loginCheck) return false;
		let { language, CToken } = users.default.maData;
		let queryObj = ma.languageQuery(language, CToken);
		queryObj = await doFetch(queryObj);
		let res = ma.languageCheck(queryObj);
		let { status } = res.response;
		if (status === 0) return console.log("重定向。未登录");
		console.log('当前语言是： ' + language);
		return queryObj;
	};

	return {
		checkLogin,
		changeLanguage,
	}
})();