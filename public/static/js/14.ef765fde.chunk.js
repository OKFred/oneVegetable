(this["webpackJsonperp-dashboard"]=this["webpackJsonperp-dashboard"]||[]).push([[14],{356:function(e,t,r){"use strict";var o=r(12),n=r(3),i=r(5),a=r(2),c=r(0),s=r(9),l=r(66),d=r(14),b=r(53),h=r(8),u=r(6),p=r(10),j=r(89),g=r(18),m=r(85),f=r(48),O=r(52);function x(e){return Object(f.a)("MuiLink",e)}var v=Object(O.a)("MuiLink",["root","underlineNone","underlineHover","underlineAlways","button","focusVisible"]),y=r(1),k=["className","color","component","onBlur","onFocus","TypographyClasses","underline","variant"],w={primary:"primary.main",textPrimary:"text.primary",secondary:"secondary.main",textSecondary:"text.secondary",error:"error.main"},C=Object(u.a)(m.a,{name:"MuiLink",slot:"Root",overridesResolver:function(e,t){var r=e.ownerState;return[t.root,t["underline".concat(Object(h.a)(r.underline))],"button"===r.component&&t.button]}})((function(e){var t=e.theme,r=e.ownerState,o=Object(d.b)(t,"palette.".concat(function(e){return w[e]||e}(r.color)))||r.color;return Object(a.a)({},"none"===r.underline&&{textDecoration:"none"},"hover"===r.underline&&{textDecoration:"none","&:hover":{textDecoration:"underline"}},"always"===r.underline&&{textDecoration:"underline",textDecorationColor:"inherit"!==o?Object(b.a)(o,.4):void 0,"&:hover":{textDecorationColor:"inherit"}},"button"===r.component&&Object(n.a)({position:"relative",WebkitTapHighlightColor:"transparent",backgroundColor:"transparent",outline:0,border:0,margin:0,borderRadius:0,padding:0,cursor:"pointer",userSelect:"none",verticalAlign:"middle",MozAppearance:"none",WebkitAppearance:"none","&::-moz-focus-inner":{borderStyle:"none"}},"&.".concat(v.focusVisible),{outline:"auto"}))})),S=c.forwardRef((function(e,t){var r=Object(p.a)({props:e,name:"MuiLink"}),n=r.className,d=r.color,b=void 0===d?"primary":d,u=r.component,m=void 0===u?"a":u,f=r.onBlur,O=r.onFocus,v=r.TypographyClasses,w=r.underline,S=void 0===w?"always":w,N=r.variant,_=void 0===N?"inherit":N,R=Object(i.a)(r,k),F=Object(j.a)(),T=F.isFocusVisibleRef,D=F.onBlur,M=F.onFocus,z=F.ref,B=c.useState(!1),V=Object(o.a)(B,2),K=V[0],A=V[1],L=Object(g.a)(t,z),W=Object(a.a)({},r,{color:b,component:m,focusVisible:K,underline:S,variant:_}),J=function(e){var t=e.classes,r=e.component,o=e.focusVisible,n=e.underline,i={root:["root","underline".concat(Object(h.a)(n)),"button"===r&&"button",o&&"focusVisible"]};return Object(l.a)(i,x,t)}(W);return Object(y.jsx)(C,Object(a.a)({className:Object(s.a)(J.root,n),classes:v,color:b,component:m,onBlur:function(e){D(e),!1===T.current&&A(!1),f&&f(e)},onFocus:function(e){M(e),!0===T.current&&A(!0),O&&O(e)},ref:L,ownerState:W,variant:_},R))}));t.a=S},462:function(e,t,r){"use strict";r.r(t);var o=r(12),n=r(0),i=r(22),a=r(85),c=r(356),s=r(87),l={enUS:{about:{thanks:"Thanks for the following stacks and libraries:",introduction:"To download the latest version, please visit:",link:"https://chrome.google.com/webstore/detail/aepfdoldflokikbbcpnfifkacpfakmjc",copyright:"hiFred \xae\xa92022 No Rights Reserved"},common:{yes:"OK",no:"Cancel",netFail:"request failed"}},zhCN:{about:{thanks:"\u611f\u8c22\u4ee5\u4e0b\u6280\u672f\u6808&\u5f00\u6e90\u5e93\uff1a",introduction:"\u83b7\u53d6\u6700\u65b0\u7248\uff0c\u8bf7\u8bbf\u95ee\uff1a",link:"https://chrome.google.com/webstore/detail/aepfdoldflokikbbcpnfifkacpfakmjc",copyright:"hiFred \xa9\xae2022 No Rights Reserved"},common:{yes:"\u786e\u5b9a",no:"\u53d6\u6d88",netFail:"\u8bf7\u6c42\u5931\u8d25"}}},d=r(1);t.default=function(){var e=Object(i.c)((function(e){return e.localization})),t=Object(n.useState)(l[e.locale]),r=Object(o.a)(t,2),b=r[0],h=r[1];return Object(n.useEffect)((function(){h(l[e.locale])}),[e.locale]),Object(d.jsxs)(s.a,{title:"Services--\u670d\u52a1",children:[Object(d.jsx)(a.a,{variant:"body1",children:b.about.thanks}),Object(d.jsxs)("div",{style:{display:"flex",flexFlow:"column"},children:[Object(d.jsxs)("div",{style:{display:"flex",flexFlow:"row",alignItems:"left",justifyContent:"flex-start",paddingTop:"20px"},children:[Object(d.jsx)("a",{href:"https://developer.mozilla.org/en-US/docs/Web/JavaScript",target:"_blank",rel:"noreferrer",children:Object(d.jsx)("img",{src:"https://img.alicdn.com/imgextra/i3/O1CN01rRMNuS2002S1XSiQ5_!!6000000006786-55-tps-128-128.svg",alt:"javascript",width:"128",height:"128"})}),Object(d.jsx)("a",{href:"https://www.w3schools.com/css/",target:"_blank",rel:"noreferrer",children:Object(d.jsx)("img",{src:"https://img.alicdn.com/imgextra/i2/O1CN01SC7SPK1YO1xDRPhRS_!!6000000003048-55-tps-128-128.svg",alt:"css3",width:"128",height:"128"})}),Object(d.jsx)("a",{href:"https://www.w3.org/html/",target:"_blank",rel:"noreferrer",children:Object(d.jsx)("img",{src:"https://img.alicdn.com/imgextra/i4/O1CN01WPc4111OnXrbN8Uuz_!!6000000001750-55-tps-128-128.svg",alt:"html5",width:"128",height:"128"})}),Object(d.jsx)("a",{href:"https://git-scm.com/",target:"_blank",rel:"noreferrer",children:Object(d.jsx)("img",{src:"https://img.alicdn.com/imgextra/i2/O1CN01b1kvg21SKTBQ4BW9r_!!6000000002228-55-tps-64-64.svg",alt:"git",width:"128",height:"128"})}),Object(d.jsx)("a",{href:"https://reactjs.org/",target:"_blank",rel:"noreferrer",children:Object(d.jsx)("img",{src:"https://img.alicdn.com/imgextra/i4/O1CN01OvjOs71NKrROfR6yO_!!6000000001552-55-tps-128-128.svg",alt:"react",width:"128",height:"128"})}),Object(d.jsx)("a",{href:"https://redux.js.org",target:"_blank",rel:"noreferrer",children:Object(d.jsx)("img",{src:"https://img.alicdn.com/imgextra/i3/O1CN01zJwy7m21BmDMfQgGo_!!6000000006947-55-tps-128-128.svg",alt:"redux",width:"128",height:"128"})})]}),Object(d.jsxs)("div",{style:{display:"flex",flexFlow:"row",alignItems:"left",justifyContent:"flex-start",paddingTop:"20px"},children:[Object(d.jsx)("a",{href:"https://codedthemes.gitbook.io/berry/",target:"_blank",rel:"noreferrer",children:Object(d.jsx)("img",{src:"https://img.alicdn.com/imgextra/i3/O1CN01Ej5V1x266LbIi4dsp_!!6000000007612-55-tps-46-55.svg",alt:"berry",width:"108",height:"128"})}),Object(d.jsx)("div",{style:{paddingRight:"20px"}}),Object(d.jsx)("a",{href:"https://mui.com/",target:"_blank",rel:"noreferrer",children:Object(d.jsx)("img",{src:"https://img.alicdn.com/imgextra/i3/O1CN01irAoMt1dFOZ2K6EKR_!!6000000003706-55-tps-30-32.svg",alt:"mui",width:"128",height:"128"})})]})]}),Object(d.jsx)("div",{style:{paddingTop:"50px"}}),Object(d.jsx)(a.a,{variant:"body1",children:b.about.introduction}),Object(d.jsx)(c.a,{href:b.about.link,target:"_blank",children:b.about.link}),Object(d.jsx)("div",{style:{paddingTop:"50px"}}),Object(d.jsx)(a.a,{variant:"body1",children:b.about.copyright})]})}}}]);
//# sourceMappingURL=14.ef765fde.chunk.js.map