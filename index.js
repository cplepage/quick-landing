import { readFileSync, watch, writeFileSync } from "fs";
import http from "http";
import { Parser, parse, parseFragment, serialize } from "parse5";
import { WebSocketServer } from "ws";
import * as sass from "sass";

const parser = new Parser();

const server = http.createServer((req, res) => {
    if(req.method === "POST"){
        readReqBody(req).then(htmlStr => {
            const html = parseFragment(htmlStr);
            unsetContentEditableRecursively(html);
            writeFileSync("index.html", serialize(html).trim());
            res.end();
        });
        return;
    }

    if(req.url.startsWith("/index.css")){
        res.setHeader("content-type", "text/css");
        res.writeHead(200);
        res.end(readFileSync("index.css"));
        return;
    }

    const html = parse(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/index.css">
</head>
<body>
</body>
</html>`);

    const content = readFileSync("index.html").toString() + watchScript;
    const body = getDescendantByTag(html, "body");
    parseFragment(content).childNodes.forEach(node => {
        parser.treeAdapter.appendChild(body, node)
    });

    setContentEditableRecursively(body);

    res.setHeader("content-type", "text/html");
    res.writeHead(200);
    res.end(serialize(html));
})
server.listen(8080);

console.log("Running at http://localhost:8080");

function setContentEditableRecursively(node) {
    node.attrs?.push({
        name: "contenteditable",
        value: "true"
    });
    node.childNodes?.forEach(setContentEditableRecursively);
}
function unsetContentEditableRecursively(node) {
    const indexOfAttribute = node.attrs?.map(({name}) => name).indexOf("contenteditable");
    if(indexOfAttribute >= 0) node.attrs.splice(indexOfAttribute, 1);
    node.childNodes?.forEach(unsetContentEditableRecursively);
}

function getDescendantByTag(node, tag) {
    for (let i = 0; i < node.childNodes?.length; i++) {
        if (node.childNodes[i].tagName === tag) return node.childNodes[i];

        const result = getDescendantByTag(node.childNodes[i], tag);
        if (result) return result;
    }

    return null;
};

function readReqBody(req) {
    return new Promise((resolve) => {
        let data = "";
        req.on('data', chunk => data += chunk.toString());
        req.on('end', () => resolve(data));
    });
}


const clients = new Set();
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
    });
});
wss.on("connection", ws => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
});

const compileStyle = () => {
    let css;
    try{
        css = sass.compile("index.scss").css;
    }catch(e){
        return;
    }
    writeFileSync("index.css", css);
};
compileStyle();
watch("index.scss", compileStyle);
watch("index.css", () => clients.forEach(ws => ws.send("style")));

watch("index.html", () => {
    clients.forEach(ws => ws.send("1"))
})

const watchScript = `
<script>
const parser = new DOMParser();
let timeout;
document.body.addEventListener("input", () => {
    if(timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
        timeout = undefined;
        const html = parser.parseFromString(document.body.innerHTML, "text/html");
        html.querySelectorAll("script").forEach(el => el.remove());
        fetch("/", {
            method: "POST",
            body: html.body.innerHTML
        })
    }, 2000);
})
const ws = new WebSocket(\`ws\$\{ window.location.protocol === "https:" ? "s" : "" \}://\` + window.location.host);
ws.onmessage = (e) => {
    if(e.data === "style"){
        const style = document.querySelector("link");
        style.href = "index.css?t=" + Date.now();
    }else{
        window.location.reload()
    }
}
</script>`;
