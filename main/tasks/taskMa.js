"use strict";
//handle events for MyAlibaba

var taskMa = (() => {
    async function checkLogin() {
        let url = "https://i.alibaba.com/index.htm";
        let netCheck = await fetch(url);
        if (!netCheck.ok) {
            console.log("未登录");
            return false;
        }
        let TBToken, CToken, status;
        let cookieArr = await cookie("check", { url });
        try {
            TBToken = cookieArr.find(
                (obj) => obj.name == "_tb_token_",
            ).value; /* 公共参数 MA 登录token */
            //CToken = cookieArr.find(obj => obj.name == 'xman_us_t').value.split('&')[0].replace('ctoken=', '');
            let CTokenArr = cookieArr.find((obj) => obj.name == "xman_us_t").value.split("&");
            let CTokenKV = CTokenArr.find((str) => /ctoken/gi.test(str));
            CToken = CTokenKV?.split("=")?.[1];
        } catch (e) {
            console.log("未登录");
        }
        if (!TBToken || !CToken) status = false;
        else {
            status = true;
            users.default.maData.TBToken = TBToken;
            users.default.maData.CToken = CToken;
        }
        users.default.maData.status = status;
        return status;
    }
    checkLogin();

    async function changeLanguage() {
        let { language, CToken } = users.default.maData;
        let cookieArr = await cookie("check", { url: "https://i.alibaba.com" });
        for (let cookieObj of cookieArr) {
            let execResult = /tr_TR|en_US|zh_HK/g.exec(cookieObj.value);
            if (execResult) {
                let { hostOnly, session, ...res } = cookieObj;
                let url = `https://www${cookieObj.domain}`;
                let value = cookieObj.value.replace(/tr_TR|en_US|zh_HK/g, language);
                await cookie("create", { ...res, url, value });
            }
        }
        let queryObj = ma.languageQuery(language, CToken);
        queryObj = await doFetch(queryObj);
        let res = ma.languageCheck(queryObj);
        let { status } = res.response;
        if (status === 0) return console.log("重定向。未登录");
        console.log("当前语言是： " + language);
        return queryObj;
    }

    async function changeLanguageAgainAndAgain() {
        let loginCheck = await checkLogin();
        if (!loginCheck) return false;
        for (let i = 0; i < 2; i++) {
            await changeLanguage(); 
        }
        return { info: { for: "maData" }, data: users.default.maData };
    }

    return {
        checkLogin,
        changeLanguage,
        changeLanguageAgainAndAgain,
    };
})();
