(this["webpackJsonperp-dashboard"]=this["webpackJsonperp-dashboard"]||[]).push([[12],{312:function(e,t,r){"use strict";r.d(t,"a",(function(){return n}));var n={enUS:{folder:{currentFolder:"please select",needFolderName:"please input name for new folder",addNewFolder:"add new folder",folderNull:"folder not found",dataNull:"data not found",folderRequired:"please select a folder to continue"},table:{tableHeader:"Products",categoryName:"category name",productId:"product id",subject:"subject",status:"status",display:"display",id:"id",is_rts:"RTS",is_specific:"specific",owner_member_display_name:"owner",product_type:"type",smart_edit:"smart edit",attributes:"attributes",keywords:"keywords",price:"price",payment_methods:"payment methods",min_order_quantity:"MOQ(min. order quantity)",unit_type:"unit type",gmt_create:"date create",gmt_modified:"date modified",score:"score",tag:"tag",customInfo:"custom info"},tableToolbar:{menuHide:"hide menu",menuShow:"show menu",productScore:"scores",productDisplayOn:"in-stock",productDisplayOff:"out-stock",productUpdate:"update",productEdit:"edit",productCopy:"copy"},form:{KeyInformation:"key information",ProductAttributes:"product attributes",productService:"product service",subject:"128 letters max.",category:"click to change category",keywords:"3 keywords max. Comma(,) separated",price:"set price (range)",payment_methods:"payment methods such as T/T, L/C, etc.",min_order_quantity:"optional",attributes:"add or delete",attributeMissing:"attribute missing",attributeDuplicated:"attribute duplicated",pleaseSelect:"please select",selectOrInput:"select or input",pieces:"pieces"},steps:{first:"Edit Attributes",second:"Edit Contents",finally:"Preview & Publish",previous:"Previous",next:"Next",complete:"Complete",addProduct:"Add Product",uneditable:"product is currently uneditable",productIdError:"product id error, pls go back & try again",categoryError:"category error, pls try again",editPrice:"Edit Price",editAll:"Edit All",editDone:"Edit Done",nullNotAllowed:"empty value is not allowed",MOQError:"MOQ should be greater than the previous one",PriceError:"price should be smaller than the previous one",add:"Add",remove:"Remove",cloud:"Cloud",selectFromCloud:"Select from Cloud",choosePhotos:"Choose Photos",uploadPhotos:"Upload Photos",removePhotos:"double click to remove the photo",productDescriptionTip:"Tips: \u2460 If it cannot be updated, please remove ALL contents and try again. \u2461Click the red button below \ud83d\udc47 to unlock photo resizing",mainPhotoRequired:"Need at least one photo",descriptionOverflow:"description length shall be smaller than 60k letters",panel1:"subject, keywords, price, MOQ...",panel2:"all kinds of attributes...",panel3:"additional information...",addAttributes:"Add Attributes",clearAttributes:"Clear Attributes",modificationNull:"No modification made",addCustomInfo:"Add Custom Info",clearCustomInfo:"Clear Custom Info",modificationDone:"Will submit the following modifications:",numberOnly:"Please input number only",addSuccess:"Product added successfully",updateSuccess:"Product updated successfully",duplicateSuccess:"product duplicated successfully",uploadSuccess:"Upload Success",productScoreError:"no score found"},productScore:{basic:"Basic",potential:"Potential",super:"Super",top:"Top"},common:{yes:"OK",no:"Cancel",success:"Success",netFail:"request failed"}},zhCN:{folder:{currentFolder:"\u8bf7\u9009\u62e9",needFolderName:"\u8bf7\u586b\u5199\u6587\u4ef6\u5939\u540d",addNewFolder:"\u65b0\u5efa\u6587\u4ef6\u5939",folderNull:"\u6587\u4ef6\u5939\u4e0d\u5b58\u5728",dataNull:"\u6570\u636e\u4e0d\u5b58\u5728",folderRequired:"\u8bf7\u9009\u62e9\u6587\u4ef6\u5939"},table:{tableHeader:"\u4ea7\u54c1",categoryName:"\u7c7b\u76ee",productId:"\u4ea7\u54c1 id",subject:"\u6807\u9898",status:"\u5ba1\u6838\u72b6\u6001",display:"\u4e0a\u67b6\u72b6\u6001",id:"id",is_rts:"RTS",is_specific:"\u89c4\u683c\u54c1",owner_member_display_name:"\u8d1f\u8d23\u4eba",product_type:"\u5546\u54c1\u7c7b\u578b",smart_edit:"\u667a\u80fd\u7f16\u8f91",attributes:"\u5c5e\u6027",keywords:"\u5173\u952e\u8bcd",price:"\u4ef7\u683c",payment_methods:"\u652f\u4ed8\u65b9\u5f0f",min_order_quantity:"\u6700\u5c0f\u8d77\u8ba2\u91cf(MOQ)",unit_type:"\u5355\u4f4d",gmt_create:"\u521b\u5efa\u65e5\u671f",gmt_modified:"\u4fee\u6539\u65e5\u671f",score:"\u4ea7\u54c1\u5206",tag:"\u6807\u7b7e",customInfo:"\u5b9a\u5236\u4fe1\u606f"},tableToolbar:{menuHide:"\u9690\u85cf\u83dc\u5355",menuShow:"\u663e\u793a\u83dc\u5355",productScore:"\u4ea7\u54c1\u5206",productDisplayOn:"\u4e0a\u67b6",productDisplayOff:"\u4e0b\u67b6",productUpdate:"\u66f4\u65b0",productEdit:"\u7f16\u8f91",productCopy:"\u590d\u5236"},form:{KeyInformation:"\u57fa\u672c\u4fe1\u606f",ProductAttributes:"\u4ea7\u54c1\u5c5e\u6027",productService:"\u4ea7\u54c1\u670d\u52a1",subject:"128 \u5b57\u7b26\u4ee5\u5185",category:"\u70b9\u51fb\u66f4\u6362\u7c7b\u76ee",keywords:"\u6700\u591a\u4e09\u4e2a\u5173\u952e\u8bcd\uff0c\u7528\u82f1\u6587\u9017\u53f7(,)\u5206\u9694",price:"\u8bbe\u7f6e\u4ef7\u683c(\u533a\u95f4)",payment_methods:"\u652f\u4ed8\u65b9\u5f0f\uff0c\u4f8b\u5982\uff1aT/T\uff0cL/C\uff0c\u7b49",min_order_quantity:"\u9009\u586b",attributes:"\u53ef\u589e\u53ef\u51cf",attributeMissing:"\u5c5e\u6027\u7f3a\u5931",attributeDuplicated:"\u5c5e\u6027\u91cd\u590d",pleaseSelect:"\u8bf7\u9009\u62e9",selectOrInput:"\u9009\u62e9\u6216\u8f93\u5165",pieces:"\u4ef6"},steps:{first:"\u5c5e\u6027\u7f16\u8f91",second:"\u8be6\u60c5\u7f16\u8f91",finally:"\u9884\u89c8&\u53d1\u5e03",previous:"\u4e0a\u4e00\u6b65",next:"\u4e0b\u4e00\u6b65",complete:"\u5b8c\u6210",addProduct:"\u53d1\u5e03\u4ea7\u54c1",uneditable:"\u5f53\u524d\u4ea7\u54c1\u4e0d\u53ef\u7f16\u8f91",productIdError:"\u4ea7\u54c1 id \u9519\u8bef\uff0c\u8bf7\u8fd4\u56de\u91cd\u8bd5",categoryError:"\u7c7b\u76ee\u6709\u8bef\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9",editPrice:"\u7f16\u8f91\u4ef7\u683c",editAll:"\u7f16\u8f91\u5168\u90e8",editDone:"\u7f16\u8f91\u5b8c\u6210",nullNotAllowed:"\u4e0d\u80fd\u4e3a\u7a7a",MOQError:"MOQ\u503c\u987b\u5927\u4e8e\u524d\u4e00\u4e2a\u503c",PriceError:"\u4ef7\u683c\u503c\u987b\u5c0f\u4e8e\u524d\u4e00\u4e2a\u503c",add:"\u6dfb\u52a0",remove:"\u5220\u9664",cloud:"\u56fe\u5e93",selectFromCloud:"\u4ece\u4e91\u7aef\u9009\u62e9",choosePhotos:"\u9009\u62e9\u56fe\u7247",uploadPhotos:"\u4e0a\u4f20\u56fe\u7247",removePhotos:"\u53cc\u51fb\u79fb\u9664\u56fe\u7247",productDescriptionTip:"\u63d0\u793a: \u2460\u82e5\u65e0\u6cd5\u66f4\u65b0\uff0c\u8bf7\u6e05\u9664\u6240\u6709\u8be6\u60c5\u540e\u91cd\u8bd5 \u2461\u539f\u5148\u662f\u667a\u80fd\u7f16\u8f91\u7684\u60c5\u51b5\u4e0b\uff0c\u987b\u70b9\u51fb\u4e0b\u65b9\u7ea2\u8272\u6309\u94ae\u89e3\u9501\u56fe\u7247\u7f29\u653e\ud83d\udc47",mainPhotoRequired:"\u9700\u8981\u4fdd\u7559\u81f3\u5c11\u4e00\u5f20\u4e3b\u56fe",descriptionOverflow:"\u63cf\u8ff0\u957f\u5ea6\u4e0d\u80fd\u8d85\u8fc76\u4e07\u5b57\u7b26",panel1:"\u6807\u9898\uff0c\u5173\u952e\u8bcd\uff0c\u4ef7\u683c\uff0cMOQ...",panel2:"\u5404\u7c7b\u5c5e\u6027...",panel3:"\u9644\u52a0\u4fe1\u606f...",addAttributes:"\u6dfb\u52a0\u5c5e\u6027",clearAttributes:"\u79fb\u9664\u7a7a\u767d\u5c5e\u6027",addCustomInfo:"\u6dfb\u52a0\u81ea\u5b9a\u4e49\u4fe1\u606f",clearCustomInfo:"\u6e05\u7406\u81ea\u5b9a\u4e49\u4fe1\u606f",modificationNull:"\u6ca1\u6709\u4efb\u4f55\u4fee\u6539",modificationDone:"\u5c06\u63d0\u4ea4\u5982\u4e0b\u5185\u5bb9:",numberOnly:"\u8bf7\u8f93\u5165\u6570\u5b57",uploadSuccess:"\u4e0a\u4f20\u6210\u529f",addSuccess:"\u4ea7\u54c1\u6dfb\u52a0\u6210\u529f",updateSuccess:"\u4ea7\u54c1\u66f4\u65b0\u6210\u529f",duplicateSuccess:"\u4ea7\u54c1\u590d\u5236\u6210\u529f",productScoreError:"\u4ea7\u54c1\u5206\u672a\u67e5\u5230"},productScore:{basic:"\u4f4e\u8d28\u54c1",potential:"\u666e\u901a\u54c1",super:"\u5b9e\u529b\u4f18\u54c1",top:"\u7cbe\u54c1"},common:{yes:"\u786e\u5b9a",no:"\u53d6\u6d88",success:"\u64cd\u4f5c\u6210\u529f",netFail:"\u8bf7\u6c42\u5931\u8d25"}}}},322:function(e,t,r){"use strict";var n=r(16),o=r(85),a=r(278),c=r(388),u=r(201),s=r(282),i=r(320),d=r(321),l=r(1);t.a=function(e){var t=e.langPack,r=e.productModified,p=e.modificationSubmission,b=Object(n.f)(),f=Object.keys(r);return Object(l.jsxs)(l.Fragment,{children:[f.length?Object(l.jsxs)(l.Fragment,{children:[Object(l.jsx)(o.a,{variant:"h3",children:t.steps.modificationDone}),Object(l.jsx)(a.a,{children:f.map((function(e){return Object(l.jsxs)(c.a,{children:["--",e]},e)}))})]}):Object(l.jsx)(o.a,{variant:"h3",children:t.steps.modificationNull}),Object(l.jsx)("br",{}),Object(l.jsx)(u.a,{}),Object(l.jsxs)("div",{align:"right",children:[Object(l.jsx)(s.a,{startIcon:Object(l.jsx)(i.a,{}),onClick:p,children:t.common.yes}),Object(l.jsx)(s.a,{startIcon:Object(l.jsx)(d.a,{}),onClick:function(){return b("/product")},children:t.common.no})]})]})}},447:function(e,t,r){"use strict";r.r(t);var n=r(17),o=r(35),a=r.n(o),c=r(106),u=r(54),s=r(12),i=r(0),d=r(22),l=r(16),p=r(85),b=r(201),f=r(87),m=r(312),h=r(268),j=r(355),y=r(141),O=r(389),g=r(421),x=r(382),v=r(6),_=r(53),k=r(420),S=r(1),w=Object(v.a)(h.a)((function(){var e=k.a[100];return{backgroundColor:e,height:40,"&:hover, &:focus":{backgroundColor:Object(_.c)(e,.06)},"&:active":{boxShadow:10,backgroundColor:Object(_.c)(e,.12)}}}));var C=function(e){var t=e.localization,r=e.categories,n=e.menuRef,o=e.menuState,a=e.showMenu,c=e.closeMenu,u=o.menuArr,s=o.anchorEl;return Object(S.jsxs)(S.Fragment,{children:[Object(S.jsx)(j.a,{sx:{display:"inline-flex",paddingTop:"10px"},children:r.map((function(e,r){if(r>0)return Object(S.jsx)(w,{sx:o.menuLevel===r?{display:"none"}:{},component:"a",href:"#",label:"zhCN"!==t.locale?e.name:e.cn_name,icon:1===r?Object(S.jsx)(g.a,{}):void 0,deleteIcon:Object(S.jsx)(x.a,{}),onDelete:function(){return a(r)}},e.category_id)}))}),Object(S.jsx)("span",{ref:n}),Object(S.jsx)("div",{children:Object(S.jsx)(y.a,{anchorEl:s,open:Boolean(s),onClose:function(){return c()},children:u.map((function(e){return Object(S.jsx)(O.a,{onClick:function(){return c(e.category_id)},children:"zhCN"!==t.locale?e.name:e.cn_name},e.category_id)}))})})]})},P=r(322),A={};t.default=function(){console.log("productEdit app running");var e=Object(d.c)((function(e){return e.localization})),t=Object(d.c)((function(e){return e.globalization})),r=Object(i.useState)(m.a[e.locale]),o=Object(s.a)(r,2),h=o[0],j=o[1],y=Object(i.useState)(t.baseData.loginData),O=Object(s.a)(y,1)[0],g=Object(l.f)(),x=Object(i.useState)(0),v=Object(s.a)(x,2),_=(v[0],v[1],Object(i.useState)({panel1:!0,panel2:!1,panel3:!1,panel4:!1})),k=Object(s.a)(_,2),w=(k[0],k[1],location.pathname.replace("/product/draft/","")),E=Object(i.useState)({}),I=Object(s.a)(E,2),N=(I[0],I[1],Object(i.useState)([])),q=Object(s.a)(N,2),R=(q[0],q[1],Object(i.useState)([])),D=Object(s.a)(R,2),F=(D[0],D[1],Object(i.useState)("")),M=Object(s.a)(F,2),T=(M[0],M[1],Object(i.useState)(0)),Q=Object(s.a)(T,2),z=Q[0],L=Q[1],U=Object(i.useState)([]),H=Object(s.a)(U,2),K=(H[0],H[1],Object(i.useState)([])),B=Object(s.a)(K,2),J=B[0],V=B[1],W=[],G=Object(i.useRef)(null),X=Object(i.useState)({menuLevel:void 0,menuValue:void 0,menuArr:[],anchorEl:null}),Y=Object(s.a)(X,2),Z=Y[0],$=Y[1];function ee(e){return te.apply(this,arguments)}function te(){return(te=Object(u.a)(a.a.mark((function t(r){var n,o,c,u,s,i;return a.a.wrap((function(t){for(;;)switch(t.prev=t.next){case 0:return n=ma.productAddDraftQuery(r),t.next=3,fetchAPI(n);case 3:if((o=t.sent).response.status){t.next=6;break}return t.abrupt("return",queryResult(!1,h.common.netFail+"\n"+o.response.result));case 6:if(c=ma.productAddDraftCheck(o),u=c.response,s=u.status,i=u.result,s){t.next=10;break}return t.abrupt("return",queryResult(s,i));case 10:if(i.product_id){t.next=12;break}return t.abrupt("return",queryResult(!1,h.common.netFail));case 12:if("zhCN"===e.locale){t.next=14;break}return t.abrupt("return",queryResult(!0,"saved to draft, editing not yet supported.\ud83e\udd2f Keep in touch..."));case 14:return t.abrupt("return",queryResult(s,"\u5df2\u5b58\u5165\u8349\u7a3f\u7bb1\uff0c\u6682\u4e0d\u652f\u6301\u7f16\u8f91\uff0c\u656c\u8bf7\u671f\u5f85...\ud83e\udd2f"));case 15:case"end":return t.stop()}}),t)})))).apply(this,arguments)}function re(e){return ne.apply(this,arguments)}function ne(){return(ne=Object(u.a)(a.a.mark((function e(t){var r,n,o,c,u,s;return a.a.wrap((function(e){for(;;)switch(e.prev=e.next){case 0:return r=ma.productCategoryQuery(t),e.next=3,fetchAPI(r);case 3:if((n=e.sent).response.status){e.next=6;break}return e.abrupt("return",queryResult(!1,h.common.netFail+"\n"+n.response.result));case 6:if(o=ma.productCategoryCheck(n),c=o.response,u=c.status,s=c.result,u){e.next=10;break}return e.abrupt("return",queryResult(u,s));case 10:return e.abrupt("return",s);case 11:case"end":return e.stop()}}),e)})))).apply(this,arguments)}function oe(){return(oe=Object(u.a)(a.a.mark((function e(t){var r,n,o,c,u,s;return a.a.wrap((function(e){for(;;)switch(e.prev=e.next){case 0:return r=ma.productCategoryAttributeQuery(t),e.next=3,fetchAPI(r);case 3:if((n=e.sent).response.status){e.next=6;break}return e.abrupt("return",queryResult(!1,h.common.netFail+"\n"+n.response.result));case 6:if(o=ma.productCategoryAttributeCheck(n),c=o.response,u=c.status,s=c.result,u){e.next=10;break}return e.abrupt("return",queryResult(u,s));case 10:return console.log(s),e.abrupt("return");case 12:case"end":return e.stop()}}),e)})))).apply(this,arguments)}function ae(e,t){return ce.apply(this,arguments)}function ce(){return(ce=Object(u.a)(a.a.mark((function e(t,r){var o,c,u,s,i,d;return a.a.wrap((function(e){for(;;)switch(e.prev=e.next){case 0:if(r){e.next=11;break}return e.next=3,re({cat_id:t});case 3:if(o=e.sent){e.next=6;break}return e.abrupt("return");case 6:return c=o.level,u=o.parent_ids,W.length||(W=new Array(c)),W[c]=o,c>0&&u&&u.number?ae(u.number[0]):V(W),e.abrupt("return");case 11:if(s=J[r-1].child_ids.number.find((function(e){return e.category_id===t}))){e.next=14;break}return e.abrupt("return");case 14:return i=s.child_ids,(d=Object(n.a)(J))[r]=s,r+1<d.length&&(d.length=r+1),i&&(d.push({category_id:0}),W=d,ue(d.length-1)),e.abrupt("return",V(d));case 20:case"end":return e.stop()}}),e)})))).apply(this,arguments)}Object(i.useEffect)((function(){if(J.length){var e=J[J.length-1].category_id;L(e),e&&(!function(e){oe.apply(this,arguments)}({cat_id:e}),A.category_id=e)}}),[J]),Object(i.useEffect)((function(){j(m.a[e.locale])}),[e.locale]),Object(i.useEffect)((function(){return console.log("I want product drafting"),O?(ae(153710),function(){A={},console.log("I leave product draft")}):g("/")}),[]);var ue=function(){var e=Object(u.a)(a.a.mark((function e(t){var r,n,o,u,s,i,d;return a.a.wrap((function(e){for(;;)switch(e.prev=e.next){case 0:r=W.length?W:J,n=r[t].category_id,o=r[t-1].child_ids.number,u=Object(c.a)(o),e.prev=4,u.s();case 6:if((s=u.n()).done){e.next=16;break}if("object"!==typeof(i=s.value)){e.next=10;break}return e.abrupt("break",16);case 10:return e.next=12,re({cat_id:i});case 12:d=e.sent,o[o.indexOf(i)]=d;case 14:e.next=6;break;case 16:e.next=21;break;case 18:e.prev=18,e.t0=e.catch(4),u.e(e.t0);case 21:return e.prev=21,u.f(),e.finish(21);case 24:$({menuLevel:t,menuValue:n,menuArr:o,anchorEl:G.current});case 25:case"end":return e.stop()}}),e,null,[[4,18,21,24]])})));return function(t){return e.apply(this,arguments)}}(),se=function(){var t=Object(u.a)(a.a.mark((function t(){var r,n,o,c,u,i;return a.a.wrap((function(t){for(;;)switch(t.prev=t.next){case 0:return t.abrupt("return",("zhCN"!==e.locale?queryResult(!0,h.common.success+"\nredirecting..."):queryResult(!0,h.common.success+"\n\u6b63\u5728\u8df3\u8f6c..."),void setTimeout((function(){g("/product/category_id="+z)}),1e3)));case 4:if(J.length&&0!==J[J.length-1].category_id&&!J[J.length-1].child_ids){t.next=6;break}return t.abrupt("return",queryResult(!1,h.steps.categoryError));case 6:for(r={group_id:w,product_type:"sourcing"},n=0,o=Object.entries(A);n<o.length;n++)c=Object(s.a)(o[n],2),u=c[0],i=c[1],r[u]="object"==typeof i?JSON.stringify(i):i;console.log(r),ee(r);case 10:case"end":return t.stop()}}),t)})));return function(){return t.apply(this,arguments)}}();return Object(S.jsxs)(f.a,{title:"Product Draft --\u4ea7\u54c1\u8349\u7a3f",children:[Object(S.jsxs)(p.a,{variant:"h2",children:[Object(S.jsx)("span",{role:"img","aria-label":"hint",children:"\ud83d\udc47"}),h.form.category]}),Object(S.jsx)("br",{}),Object(S.jsx)(C,{localization:e,categories:J,menuRef:G,menuState:Z,showMenu:ue,closeMenu:function(e){var t=Z.menuLevel;$({menuArr:[],anchorEl:null}),console.log(e),void 0!==e&&e!==z&&ae(e,t)}}),Object(S.jsx)(b.a,{sx:{marginBottom:"50px"}}),Object(S.jsx)("br",{}),Object(S.jsx)(P.a,{langPack:h,productModified:A,modificationSubmission:se})]})}}}]);
//# sourceMappingURL=12.06f56975.chunk.js.map