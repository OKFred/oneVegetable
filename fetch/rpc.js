var rpc=[
    {
		"request": {
			"header":{"method":"GET"},
			'url':	'https://i.alibaba.com/ajax/setLanguage.do',
			"data": {
				"language":"",
			}
		},
		"response": {
			"data": {}
		},
		"info": {
			"type": "ma",
			"for": "国际站语言切换",
		}
    },
	{
		"request": {
			"header":{"method":"GET"},
			"url":	'https://crosstrade.alibaba.com/ecology/ajax/registeAndCreateApp.json',
			"data": {
				"json": {
					"isvName":'',
					"isvPhone":'',
					"isvEmail":'',
					"callbackUrl":''
				},
				"_tb_token_": ''
			}
		},
		"response": {
			"data": {}
		},
		"info": {
			"type": "ma",
			"for": "国际站开发者注册"
		}
	},{
		"request": {
			"header":{"method":"GET"},
			"url":	'https://crosstrade.alibaba.com/ecology/ajax/listApp.json',
			"data": {
				"_tb_token_": ''
			}
		},
		"response": {
			"data": {}
		},
		"info": {
			"type": "ma",
			"for": "国际站获取AppKey"
		}
	},{
		"request": {
			"header":{"method":"GET"},
			"url":	'https://crosstrade.alibaba.com/ecology/ajax/getAppSecret.json',
			"data": {
				"_tb_token_": '',
				"appKey": ''
			}
		},
		"response": {
			"data": {}
		},
		"info": {
			"type": "ma",
			"for": "国际站获取AppSecret"
		}
	},
	{
		"request": {
			"header":{"method":"GET"},
			'url':	'https://oauth.alibaba.com/authorize',
			'data':{
				'response_type':'code',
				'view':'web',
				'sp':'ICBU',
				'client_id':'',	//appKey
				'state':'',	//appKey
			}
		},
		"response": {
			"data": {}
		},
		"info": {
			"type": "ma",
			"for": "国际站获取授权码"
		}
	},
	{
		"request": {
			"url":	'',
			"header": {
				"method":"POST",
				"Content-Type": "x-www-form-urlencoded"
			},
			"data": {
				"_csrf_token_": '',
				"action": "/tac/authorize_action",
				"event_submit_do_auth": "event_submit_do_auth",
				"agreement": true,
				"view": "web",
				"agreementsign": '',
				"response_type": "code",
				"state": '',
				"sp": "ICBU",
				"client_id": '',
				"timestamp": ''
			}
		},
		"response": {
			"data": {}
		},
		"info": {
			"type": "ma",
			"for": "国际站自动授权"
		}
	},
	{
		"request": {
			'url':	'https://oauth.alibaba.com/token',
			"header": {
				"method":"POST",
				"Content-Type": "x-www-form-urlencoded"
			},
			"data": {
				'code': '',
				'grant_type': 'authorization_code',
				'client_id': '',
				'client_secret': '',
				'sp': 'icbu'
			}
		},
		"response": {
			"data": {}
		},
		"info": {
			"type": "ma",
			"for": "国际站查询授权令牌"
		}
	},
	{
		"request": {
			'url':	'https://gw.api.taobao.com/router/rest',
			"header": {
				"method":"POST",
			"Content-Type": "x-www-form-urlencoded"
			},
			"data": {}
		},
		"response": {
			"data": {}
		},
		"info": {
			"type": "ma",
			"for": "国际站调用API"
		}
	},
	{
		"request": {
			'url':	'https://accounts.alibaba.com/user/get_account_profile.htm',
			"header": {"method":"GET"},
			"data": {
				'ctoken': ''
			}
		},
		"response": {
			"data": {
				// email: "abc@gmail.com",
				// hasLoginMobile: false,
				// hasSecurityMobile: false,
				// loginId: "memberId",
				// portraitUrl: "https://sc02.alicdn.com/kf/?.jpg",
			}
		},
		"info": {
			"type": "ma",
			"for": "国际站查询账号ID"
		}
	},
	{
		"request": {
			'url':	'https://profile.alibaba.com/profile/my_profile.htm',
			"header": {"method":"GET"},
			"data": ""
		},
		"response": {
			"data": ""//html string
		},
		"info": {
			"type": "ma",
			"for": "国际站查询账号邮箱"
		}
	},
	{
		"request": {
			'url': 'https://query.aliyun.com/rest/erp.register',
			"header": {"method":"GET"},
			"data": {
				'app_key': '',
				'app_secret': '',
				'code': '',
				'access_token' : '',
				'call_back_url': ''
			}
		},
		"response": {
			"data": {}
		},
		"info": {
			"type": "aliyun",
			"for": "国际站保存令牌"
		}
	},
]

if (typeof(exports)!=='undefined') exports.main = rpc;