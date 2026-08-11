console.log("my alibaba");

function init() {
    let queryObj = {
        request: { data: {} },
        response: { data: {} },
        info: {
            type: "extension",
            for: "MA就绪",
        },
    };
    bgConnect(queryObj);
}
init();

function handler(msg) {
    //消息处理
    if (!msg) return console.log("where are you from ?");
    // console.log(msg, msg.info.for);
    // if (msg.info.for === "maData") maDataHandler(msg.data);
}
 