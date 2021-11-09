var ma=(()=>{
    let data={
        TBToken:'',
		CToken:'',
    };
    
	function languageQuery(language,ctoken){
		let What='国际站语言切换';
		let queryObj=prepareMsg(What);
        queryObj.request.data.language=language;
        queryObj.request.data.ctoken=ctoken;
		return queryObj;
	};
    
	function languageCheck(msg){
        let status,result;
        let data=msg.response.data;
        if (msg.response.net.redirected){
            status=0;
            result='未登录';
        }else if (!data || data.errorMessage){
            status=false;
            result='语言切换失败';
        }else if(data.status){
            status=true;
            result='语言切换成功';
        };
        msg.response.result=result;
        msg.response.status=status;
        return msg;
	};
	return {
		data,
		languageCheck,
		languageQuery,
	}
})();