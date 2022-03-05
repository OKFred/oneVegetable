(()=>{
	let queryObj={
		"request": {"data":{}},
		"response": {"data":{}},
		"info": {
			"type": "extension",
			"for": "MA就绪"
		}
	};
	chrome.runtime.connect({name: 'cRM'}).postMessage(queryObj);
})();